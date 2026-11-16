import { BadRequestException, Injectable } from '@nestjs/common';
import { Liquidacion, Prisma } from '@prisma/client';
import { AsientosService, RenglonAsiento } from '../contabilidad/asientos/asientos.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { calcularContribuciones, ContribucionResultado } from './calculo';
import { ContribucionesService } from './contribuciones.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
export const ORIGEN_LIQUIDACION = 'LIQUIDACION_SUELDO';
const finDeMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0));

/** Contribuciones patronales y asiento contable de una liquidación (spec E19 §2-§3). */
@Injectable()
export class ContabilizacionService {
  constructor(private readonly tenant: TenantPrisma, private readonly asientos: AsientosService, private readonly contribuciones: ContribucionesService) {}

  /** Contribuciones de cada recibo de la liquidación, calculadas sin grabar. */
  async calcular(tx: TxEmpresa, l: Liquidacion): Promise<Map<string, ContribucionResultado[]>> {
    const [vigentes, param, recibos] = await Promise.all([
      this.contribuciones.vigentes(tx, l.anio, l.mes), this.contribuciones.parametros(tx, l.anio, l.mes),
      tx.reciboSueldo.findMany({ where: { liquidacionId: l.id } }),
    ]);
    return new Map(recibos.map((r) => [r.id, calcularContribuciones(r.totalRemunerativo, r.diasTrabajados, l.tipo, vigentes, param.detraccion)]));
  }

  /** Resumen para la consulta: grabadas si está contabilizada, si no calculadas. */
  async resumen(tx: TxEmpresa, l: Liquidacion) {
    let porRecibo: Map<string, { destino: string; importe: Dec }[]>;
    if (l.asientoId) {
      const cs = await tx.reciboSueldoContribucion.findMany({ where: { recibo: { liquidacionId: l.id } } });
      porRecibo = new Map();
      for (const c of cs) porRecibo.set(c.reciboId, [...(porRecibo.get(c.reciboId) ?? []), c]);
    } else porRecibo = await this.calcular(tx, l);
    const porDestino: Record<string, Dec> = { SEGURIDAD_SOCIAL: new D(0), OBRA_SOCIAL: new D(0), ART: new D(0), SEGURO_VIDA: new D(0) };
    const porRecibo2: Record<string, string> = {};
    let total = new D(0);
    for (const [reciboId, cs] of porRecibo) {
      const t = cs.reduce((s, c) => s.plus(c.importe), new D(0));
      porRecibo2[reciboId] = t.toFixed(2);
      for (const c of cs) porDestino[c.destino] = porDestino[c.destino].plus(c.importe);
      total = total.plus(t);
    }
    return { porRecibo: porRecibo2, porDestino: Object.fromEntries(Object.entries(porDestino).map(([k, v]) => [k, v.toFixed(2)])), total: total.toFixed(2) };
  }

  /** Graba las contribuciones y genera el asiento de la liquidación cerrada. */
  async contabilizar(tx: TxEmpresa, l: Liquidacion): Promise<{ id: string; numero: number }> {
    if (l.asientoId) throw new BadRequestException('La liquidación ya está contabilizada');
    const cfg = await this.contribuciones.configuracion(tx);
    const calculadas = await this.calcular(tx, l);
    const recibos = await tx.reciboSueldo.findMany({ where: { liquidacionId: l.id }, include: { renglones: true } });
    const conceptos = new Map((await tx.concepto.findMany({ where: { id: { in: recibos.flatMap((r) => r.renglones.map((x) => x.conceptoId).filter((x): x is string => !!x)) } } })).map((c) => [c.id, c]));
    const saldos = new Map<string, Dec>(); // clave cuenta|centro → debe − haber
    const sumar = (cuenta: string, centro: string | null, importe: Dec) => { const k = `${cuenta}|${centro ?? ''}`; saldos.set(k, (saldos.get(k) ?? new D(0)).plus(importe)); };
    await tx.reciboSueldoContribucion.deleteMany({ where: { recibo: { liquidacionId: l.id } } });
    for (const r of recibos) {
      sumar(cfg.cuentaSueldosId, r.centroCostoId, new D(r.totalRemunerativo).plus(r.totalNoRemunerativo));
      sumar(cfg.cuentaSueldosAPagarId, null, new D(r.neto).neg());
      for (const x of r.renglones.filter((y) => y.clase === 'DESCUENTO')) {
        const c = x.conceptoId ? conceptos.get(x.conceptoId) : undefined;
        sumar(c?.cuentaContableId ?? (c?.destino === 'SINDICAL' ? cfg.cuentaRetencionesSindicalesId : cfg.cuentaCargasSocialesId), null, new D(x.importe).neg());
      }
      const cs = calculadas.get(r.id) ?? [];
      for (const c of cs) {
        sumar(cfg.cuentaContribucionesId, r.centroCostoId, c.importe);
        sumar(c.cuentaContableId, null, c.importe.neg());
      }
      if (cs.length) await tx.reciboSueldoContribucion.createMany({ data: cs.map((c) => ({ empresaId: this.tenant.empresaId, reciboId: r.id, codigo: c.codigo, nombre: c.nombre, destino: c.destino, base: c.base, alicuota: c.alicuota, importe: c.importe, cuentaContableId: c.cuentaContableId })) });
    }
    const renglones: RenglonAsiento[] = [...saldos.entries()].filter(([, v]) => !v.isZero()).map(([k, v]) => {
      const [cuentaContableId, centro] = k.split('|');
      return { cuentaContableId, centroCostoId: centro || null, ...(v.gt(0) ? { debe: v.toFixed(2) } : { haber: v.neg().toFixed(2) }) };
    });
    const fecha = l.tipo === 'SAC' ? finDeMes(l.anio, l.mes <= 6 ? 6 : 12) : finDeMes(l.anio, l.mes);
    const descripcion = l.tipo === 'SAC' ? `SAC ${l.mes <= 6 ? '1.er' : '2.º'} semestre ${l.anio}` : `Liquidación de sueldos ${String(l.mes).padStart(2, '0')}/${l.anio}`;
    const a = await this.asientos.generar(tx, { fecha, descripcion, origenTipo: ORIGEN_LIQUIDACION, origenId: l.id, renglones });
    await tx.liquidacion.update({ where: { id: l.id }, data: { asientoId: a.id } });
    return a;
  }

  /** Anula el asiento (contraasiento con su misma fecha) y borra las contribuciones grabadas. */
  async anular(tx: TxEmpresa, l: Liquidacion): Promise<void> {
    if (!l.asientoId) return;
    const a = await tx.asiento.findUniqueOrThrow({ where: { id: l.asientoId } });
    await this.asientos.contraasiento(tx, a.id, a.fecha, `Anulación - ${a.descripcion}`);
    await tx.reciboSueldoContribucion.deleteMany({ where: { recibo: { liquidacionId: l.id } } });
    await tx.liquidacion.update({ where: { id: l.id }, data: { asientoId: null } });
  }
}
