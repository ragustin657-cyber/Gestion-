import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Tercero } from '@prisma/client';
import { alicuotaIibb, baseSujeta, netearNotasCredito, retencionGanancias, retencionIibb, retencionIva, retencionSuss } from '@gestion/shared';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ConfigPagosService } from '../config/config-pagos.service';
import { PadronService } from '../padron/padron.service';

const D = Prisma.Decimal;

/** Imputación de la OP a un comprobante de compra (E35): importes en pesos a la cotización de la OP. */
export interface ImputacionComprobante {
  comprobanteCompraId: string; tipo: string; letra: string; asociadaId: string | null; puntoVenta: number; numero: number; fecha: Date;
  ivaPesos: string; totalPesos: string; imputadoPesos: string;
  sinIva: { netoGravado: string; noGravado: string; exento: string; total: string };
}

export interface RetencionCalculada {
  impuesto: 'GANANCIAS' | 'IIBB' | 'IVA' | 'SUSS';
  /** Factura retenida (IVA y SUSS, E35) */
  comprobanteCompraId?: string;
  jurisdiccion: string | null;
  regimen: string | null;
  base: string;
  alicuota: string;
  importe: string;
  detalle: Record<string, string>;
}

export interface AcumuladoMes { base: string; retenido: string }

/** Reúne los datos de un pago (proveedor, acumulados, padrón, ficha) y aplica el motor de retenciones. */
@Injectable()
export class RetencionesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly config: ConfigPagosService,
    private readonly padron: PadronService,
  ) {}

  /**
   * Base y retenciones de Ganancias ya practicadas en el mes por el mismo proveedor y régimen (OP pagadas).
   * Se completa con los modelos de órdenes de pago.
   */
  async acumuladoGanancias(tx: TxEmpresa, terceroId: string, regimen: string, desde: Date, hasta: Date, excluirOrdenPagoId?: string): Promise<AcumuladoMes> {
    const filas = await tx.ordenPagoRetencion.findMany({
      where: {
        impuesto: 'GANANCIAS', regimen, anulada: false,
        ordenPago: { terceroId, estado: 'PAGADA', fechaPago: { gte: desde, lte: hasta }, id: excluirOrdenPagoId ? { not: excluirOrdenPagoId } : undefined },
      },
    });
    let base = new D(0), retenido = new D(0);
    for (const f of filas) {
      base = base.plus((f.detalle as Record<string, string>).basePago ?? f.base);
      retenido = retenido.plus(f.importe);
    }
    return { base: base.toString(), retenido: retenido.toString() };
  }

  async calcular(tx: TxEmpresa, e: { terceroId: string; fechaPago: Date; bases: string[]; imputaciones?: ImputacionComprobante[]; excluirOrdenPagoId?: string; tope?: string }): Promise<RetencionCalculada[]> {
    const tercero = await tx.tercero.findUnique({ where: { id: e.terceroId }, include: { iibb: true } });
    if (!tercero) throw new BadRequestException('Proveedor no encontrado');
    const basePago = e.bases.reduce((s, b) => s.plus(b), new D(0));
    const r: RetencionCalculada[] = [];
    if (basePago.lte(0)) return r;
    const base = basePago.toFixed(2);

    // Ganancias
    const regimen = tercero.regimenGanancias ? await this.config.regimen(tx, tercero.regimenGanancias) : null;
    const exento = tercero.exentoGanancias && (!tercero.exencionHasta || tercero.exencionHasta >= e.fechaPago);
    const sujeto = !!regimen?.activo && tercero.condicionIva !== 'MONOTRIBUTO' && !exento;
    if (sujeto && regimen) {
      const desde = new Date(Date.UTC(e.fechaPago.getUTCFullYear(), e.fechaPago.getUTCMonth(), 1));
      const hasta = new Date(Date.UTC(e.fechaPago.getUTCFullYear(), e.fechaPago.getUTCMonth() + 1, 0));
      const previo = await this.acumuladoGanancias(tx, tercero.id, regimen.codigo, desde, hasta, e.excluirOrdenPagoId);
      const escala = await this.config.escala(tx);
      const g = retencionGanancias({
        sujeto, inscripto: tercero.inscriptoGanancias,
        regimen: {
          minimoNoSujeto: regimen.minimoNoSujeto.toString(), alicuotaInscripto: regimen.alicuotaInscripto.toString(),
          alicuotaNoInscripto: regimen.alicuotaNoInscripto.toString(), usaEscala: regimen.usaEscala, minimoRetencion: regimen.minimoRetencion.toString(),
        },
        escala: escala.map((t) => ({ desde: t.desde.toString(), hasta: t.hasta?.toString() ?? null, fijo: t.fijo.toString(), porcentaje: t.porcentaje.toString() })),
        baseAcumuladaPrevia: previo.base, basePago: base, retenidoPrevio: previo.retenido,
      });
      // Se informa aunque sea 0: la base queda registrada para el acumulado mensual
      r.push({
          impuesto: 'GANANCIAS', jurisdiccion: null, regimen: regimen.codigo, base,
          alicuota: regimen.usaEscala && tercero.inscriptoGanancias ? 'escala' : (tercero.inscriptoGanancias ? regimen.alicuotaInscripto : regimen.alicuotaNoInscripto).toString(),
          importe: g.importe,
          detalle: {
            basePago: base, acumuladoPrevio: new D(previo.base).toFixed(2), acumulado: g.acumulado, minimoNoSujeto: regimen.minimoNoSujeto.toFixed(2),
            sujetoRetencion: g.sujetoRetencion, impuestoDeterminado: g.impuestoDeterminado, retenidoPrevio: new D(previo.retenido).toFixed(2),
          },
        });
    }

    // IIBB
    for (const j of await this.config.jurisdicciones(tx)) {
      const ficha = tercero.iibb.find((x) => x.jurisdiccion === j.jurisdiccion);
      const padron = j.usaPadron ? await this.padron.alicuotaRetencion(j.jurisdiccion, tercero.cuit, e.fechaPago) : null;
      const alicuota = alicuotaIibb({
        exento: !!ficha?.exento, padron, ficha: ficha ? ficha.alicuotaRetencion.toString() : null,
        usaPadron: j.usaPadron, sinPadron: j.sinPadron, alicuotaDefecto: j.alicuotaDefecto.toString(),
      });
      if (alicuota === null) continue;
      const importe = retencionIibb(base, alicuota, j.minimoRetencion.toString());
      if (new D(importe).gt(0))
        r.push({
          impuesto: 'IIBB', jurisdiccion: j.jurisdiccion, regimen: null, base, alicuota: new D(alicuota).toString(), importe,
          detalle: { basePago: base, origenAlicuota: padron !== null && j.usaPadron ? 'PADRON' : ficha ? 'FICHA' : 'DEFECTO' },
        });
    }

    r.push(...(await this.ivaYSuss(tx, tercero, e.fechaPago, e.imputaciones ?? [])));

    const total = r.reduce((s, x) => s.plus(x.importe), new D(0));
    // Lo retenido nunca puede igualar ni superar lo que se paga (el neto debe ser positivo)
    if (total.gt(0) && total.gte(e.tope ?? basePago)) throw new BadRequestException('Las retenciones superan el importe a pagar');
    return r;
  }

  /**
   * Retenciones de IVA y SUSS por factura (spec E35 §5): solo facturas y notas de débito (los tickets no discriminan IVA);
   * las notas de crédito de la misma OP reducen lo pagado de su factura asociada o, si no está, en proporción.
   */
  private async ivaYSuss(tx: TxEmpresa, t: Tercero, fechaPago: Date, imputaciones: ImputacionComprobante[]): Promise<RetencionCalculada[]> {
    const emp = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId }, select: { agenteRetencionIva: true, agenteRetencionSuss: true } });
    const regIva = emp.agenteRetencionIva && t.regimenIvaId ? await tx.regimenIva.findUnique({ where: { id: t.regimenIvaId } }) : null;
    const regSuss = emp.agenteRetencionSuss && t.regimenSussId ? await tx.regimenSuss.findUnique({ where: { id: t.regimenSussId } }) : null;
    const sujetoIva = !!regIva?.activo && t.condicionIva === 'RESPONSABLE_INSCRIPTO' && !t.exentoIva;
    const sujetoSuss = !!regSuss?.activo && t.condicionIva !== 'MONOTRIBUTO';
    if (!sujetoIva && !sujetoSuss) return [];
    const facturas = imputaciones.filter((x) => x.tipo === 'FACTURA' || x.tipo === 'NOTA_DEBITO');
    const notas = imputaciones.filter((x) => x.tipo === 'NOTA_CREDITO');
    const pagado = new Map(netearNotasCredito(facturas.map((f) => ({ id: f.comprobanteCompraId, imputado: f.imputadoPesos })), notas.map((n) => ({ asociadaId: n.asociadaId, imputado: n.imputadoPesos }))).map((x) => [x.id, x.imputado]));
    const vigente = t.exclusionIvaPorcentaje && (!t.exclusionIvaHasta || t.exclusionIvaHasta >= fechaPago);
    const exclusion = (vigente ? t.exclusionIvaPorcentaje : 0) as 0 | 50 | 100;
    const r: RetencionCalculada[] = [];
    for (const f of facturas) {
      const imputado = pagado.get(f.comprobanteCompraId) ?? '0';
      const factura = { tipo: f.tipo, letra: f.letra, puntoVenta: String(f.puntoVenta), numero: String(f.numero), fecha: f.fecha.toISOString().slice(0, 10), total: f.totalPesos };
      if (sujetoIva && regIva) {
        const x = retencionIva({ ivaFactura: f.ivaPesos, totalFactura: f.totalPesos, imputado, porcentaje: regIva.porcentaje.toString(), minimoComprobante: regIva.minimoComprobante.toString(), minimoRetencion: regIva.minimoRetencion.toString(), exclusion });
        if (new D(x.importe).gt(0))
          r.push({ impuesto: 'IVA', jurisdiccion: null, regimen: regIva.id, base: x.base, alicuota: regIva.porcentaje.toString(), importe: x.importe, comprobanteCompraId: f.comprobanteCompraId,
            detalle: { ...factura, pagado: imputado, exclusion: String(exclusion), exclusionPublicacion: vigente && t.exclusionIvaPublicacion ? t.exclusionIvaPublicacion.toISOString().slice(0, 10) : '' } });
      }
      if (sujetoSuss && regSuss) {
        const base = baseSujeta(imputado, f.sinIva);
        const x = retencionSuss({ base, porcentaje: regSuss.porcentaje.toString(), minimoNoSujeto: regSuss.minimoNoSujeto.toString(), minimoRetencion: regSuss.minimoRetencion.toString() });
        if (new D(x.importe).gt(0))
          r.push({ impuesto: 'SUSS', jurisdiccion: null, regimen: regSuss.id, base, alicuota: regSuss.porcentaje.toString(), importe: x.importe, comprobanteCompraId: f.comprobanteCompraId, detalle: { ...factura, pagado: imputado } });
      }
    }
    return r;
  }
}
