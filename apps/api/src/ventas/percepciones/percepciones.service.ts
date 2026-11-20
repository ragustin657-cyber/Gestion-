import { Injectable } from '@nestjs/common';
import { alicuotaIibb, percepcionesIva, percepcionIibb, revertirPercepcion } from '@gestion/shared';
import { Prisma } from '@prisma/client';
import { jurisdiccionDeProvincia } from '../../impuestos/posicion-iibb/provincias';
import { ConfigPagosService } from '../../pagos/config/config-pagos.service';
import { PadronService } from '../../pagos/padron/padron.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

const D = Prisma.Decimal;

export interface DatosPercepcion {
  tipo: 'IIBB' | 'IVA'; jurisdiccion: string | null; regimenCodigo: string | null; tramo: 'GENERAL' | 'REDUCIDA' | null;
  base: string; alicuota: string; importe: string; origenAlicuota: 'PADRON' | 'FICHA' | 'DEFECTO' | 'REGIMEN' | 'ASOCIADA'; exclusionPct: number | null;
}
export interface ComprobantePercepciones {
  tipo: 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO'; letra: string; fecha: Date; terceroId: string; cotizacion: Prisma.Decimal.Value;
  netoGravado: string; noGravado: string; exento: string; ivas: { alicuota: string; base: string }[]; comprobanteAsociadoId: string | null; excluirId?: string;
}

const GENERAL = ['21', '27'];

/** Percepciones practicadas en un comprobante de venta (spec E39 §4 y §5). */
@Injectable()
export class PercepcionesVentaService {
  constructor(private readonly tenant: TenantPrisma, private readonly config: ConfigPagosService, private readonly padron: PadronService) {}

  async calcular(tx: TxEmpresa, c: ComprobantePercepciones): Promise<{ renglones: DatosPercepcion[]; total: string }> {
    const renglones = c.tipo === 'NOTA_CREDITO' ? await this.revertir(tx, c) : await this.nuevas(tx, c);
    return { renglones, total: renglones.reduce((t, r) => t.plus(r.importe), new D(0)).toFixed(2) };
  }

  private async nuevas(tx: TxEmpresa, c: ComprobantePercepciones): Promise<DatosPercepcion[]> {
    if (c.letra !== 'A' && c.letra !== 'B') return [];
    const t = await tx.tercero.findUniqueOrThrow({ where: { id: c.terceroId }, include: { iibb: true } });
    if (t.condicionIva === 'CONSUMIDOR_FINAL') return [];
    const out: DatosPercepcion[] = [];
    const cot = new D(c.cotizacion).toString();
    // IIBB
    const baseIibb = new D(c.netoGravado).plus(c.noGravado).plus(c.exento).toFixed(2);
    const provincia = jurisdiccionDeProvincia(t.provincia);
    for (const j of await this.config.jurisdiccionesPercepcion(tx)) {
      const ficha = t.iibb.find((x) => x.jurisdiccion === j.jurisdiccion);
      const padron = j.usaPadron && t.tipoDocumento === 'CUIT' ? await this.padron.alicuotaPercepcion(j.jurisdiccion, t.cuit, c.fecha) : null;
      const fichaAlic = ficha?.alicuotaPercepcion != null ? ficha.alicuotaPercepcion.toString() : null;
      // La alícuota por defecto solo a clientes vinculados a la jurisdicción (ficha o provincia)
      const vinculado = !!ficha || provincia === j.jurisdiccion;
      const alicuota = alicuotaIibb({
        exento: !!ficha?.exento, padron, ficha: fichaAlic, usaPadron: j.usaPadron,
        sinPadron: vinculado ? j.sinPadronPercepcion : 'NO_RETENER', alicuotaDefecto: j.alicuotaPercepcionDefecto.toString(),
      });
      const importe = percepcionIibb({ base: baseIibb, alicuota, minimoPesos: j.minimoPercepcion.toString(), cotizacion: cot });
      if (new D(importe).gt(0))
        out.push({
          tipo: 'IIBB', jurisdiccion: j.jurisdiccion, regimenCodigo: null, tramo: null, base: baseIibb, alicuota: new D(alicuota!).toString(), importe,
          origenAlicuota: padron !== null && j.usaPadron ? 'PADRON' : fichaAlic !== null ? 'FICHA' : 'DEFECTO', exclusionPct: null,
        });
    }
    // IVA
    const emp = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId }, select: { agentePercepcionIva: true } });
    const regimen = emp.agentePercepcionIva ? await this.config.regimenPercepcionIvaActivo(tx) : null;
    if (regimen && t.condicionIva === 'RESPONSABLE_INSCRIPTO') {
      const excl = t.exclusionIvaPorcentaje && t.exclusionIvaHasta && t.exclusionIvaHasta >= c.fecha ? t.exclusionIvaPorcentaje : null;
      const neto: Record<string, string> = {};
      for (const i of c.ivas) neto[new D(i.alicuota).toString()] = new D(neto[new D(i.alicuota).toString()] ?? 0).plus(i.base).toFixed(2);
      for (const p of percepcionesIva({ netoPorAlicuota: neto, alicuotaGeneral: regimen.alicuotaGeneral.toString(), alicuotaReducida: regimen.alicuotaReducida.toString(), minimoNetoPesos: regimen.minimoNeto.toString(), cotizacion: cot, exclusionPct: excl }))
        out.push({ tipo: 'IVA', jurisdiccion: null, regimenCodigo: regimen.codigo, tramo: p.tramo, base: p.base, alicuota: p.alicuota, importe: p.importe, origenAlicuota: 'REGIMEN', exclusionPct: excl });
    }
    return out;
  }

  /** NC: cada percepción de la asociada, en proporción a la base de la NC y con tope en lo aún no revertido. */
  private async revertir(tx: TxEmpresa, c: ComprobantePercepciones): Promise<DatosPercepcion[]> {
    if (!c.comprobanteAsociadoId) return [];
    const originales = await tx.comprobanteVentaPercepcion.findMany({ where: { comprobanteId: c.comprobanteAsociadoId } });
    if (!originales.length) return [];
    const previas = await tx.comprobanteVentaPercepcion.findMany({
      where: { comprobante: { comprobanteAsociadoId: c.comprobanteAsociadoId, tipo: 'NOTA_CREDITO', estado: 'AUTORIZADO', ...(c.excluirId ? { id: { not: c.excluirId } } : {}) } },
    });
    const clave = (p: { tipo: string; jurisdiccion: string | null; tramo: string | null }) => `${p.tipo}|${p.jurisdiccion ?? ''}|${p.tramo ?? ''}`;
    const baseIibb = new D(c.netoGravado).plus(c.noGravado).plus(c.exento);
    const netoTramo = (tramo: string | null) => c.ivas.filter((i) => (tramo === 'GENERAL') === GENERAL.includes(new D(i.alicuota).toString()) && !new D(i.alicuota).isZero())
      .reduce((t, i) => t.plus(i.base), new D(0));
    const out: DatosPercepcion[] = [];
    for (const o of originales) {
      const base = o.tipo === 'IIBB' ? baseIibb : netoTramo(o.tramo);
      const yaRevertido = previas.filter((p) => clave(p) === clave(o)).reduce((t, p) => t.plus(p.importe), new D(0));
      const importe = revertirPercepcion({ baseNc: base.toFixed(2), alicuota: o.alicuota.toString(), exclusionPct: o.exclusionPct, percibido: o.importe.toString(), yaRevertido: yaRevertido.toFixed(2) });
      if (new D(importe).gt(0))
        out.push({
          tipo: o.tipo as 'IIBB' | 'IVA', jurisdiccion: o.jurisdiccion, regimenCodigo: o.regimenCodigo, tramo: o.tramo as 'GENERAL' | 'REDUCIDA' | null,
          base: base.toFixed(2), alicuota: o.alicuota.toString(), importe, origenAlicuota: 'ASOCIADA', exclusionPct: o.exclusionPct,
        });
    }
    return out;
  }
}
