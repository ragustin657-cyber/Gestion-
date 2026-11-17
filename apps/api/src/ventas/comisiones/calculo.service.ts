import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

export type TipoRenglon = 'COBRO' | 'ANULACION' | 'RECHAZO';
export interface RenglonComision {
  vendedorId: string; tipo: TipoRenglon; aplicacionId: string; comprobanteId: string; chequeId: string | null;
  fecha: string; cliente: string; comprobante: string; cobro: string; cobrado: Dec; neto: Dec; porcentaje: Dec; comision: Dec;
}

/** Fin del mes (fecha UTC). */
export function finDeMes(anio: number, mes: number) {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12 || anio < 2000) throw new BadRequestException('Indique el mes (año y mes)');
  return new Date(Date.UTC(anio, mes, 0));
}

/**
 * Comisiones pendientes hasta el fin de un mes (spec E24 §5). Se calculan desde las aplicaciones de cobro, sin tocar
 * recibos ni aplicaciones: cobros sobre comprobantes con vendedor, ajustes por aplicaciones liquidadas que se anularon
 * y ajustes por cheques rechazados.
 */
@Injectable()
export class ComisionesCalculoService {
  constructor(private readonly tenant: TenantPrisma) {}

  async pendientes(tx: TxEmpresa, anio: number, mes: number): Promise<RenglonComision[]> {
    const fin = finDeMes(anio, mes);
    const empresaId = this.tenant.empresaId;
    // Candidatas, acotadas en SQL (no se recorre toda la historia): (a) cobros no anulados sin renglón COBRO vigente,
    // (b) aplicaciones anuladas con COBRO vigente y sin ANULACION, (c) cobros de ingresos con un cheque rechazado
    // hasta el fin de mes. Siempre sobre comprobantes con vendedor y créditos que son cobros (recibos o ingresos).
    const candidatas = await tx.$queryRawUnsafe<{ id: string }[]>(`
      SELECT a.id FROM "AplicacionCobro" a
      JOIN "MovimientoCuentaCorriente" d ON d.id = a."debitoMovId" AND d."origenTipo" = 'VENTA'
      JOIN "ComprobanteVenta" c ON c.id = d."origenId" AND c."vendedorId" IS NOT NULL AND c.estado = 'AUTORIZADO' AND c.tipo <> 'NOTA_CREDITO'
      JOIN "MovimientoCuentaCorriente" cr ON cr.id = a."creditoMovId" AND cr."origenTipo" IN ('RECIBO', 'COBRO')
      LEFT JOIN "Recibo" r ON cr."origenTipo" = 'RECIBO' AND r.id = cr."origenId"
      WHERE a."empresaId" = $1::uuid AND (
        (NOT a.anulada AND a.fecha <= $2::date AND NOT EXISTS (SELECT 1 FROM "LiquidacionComisionesRenglon" x WHERE x."aplicacionId" = a.id AND x.tipo = 'COBRO' AND NOT x.anulado))
        OR (a.anulada AND EXISTS (SELECT 1 FROM "LiquidacionComisionesRenglon" x WHERE x."aplicacionId" = a.id AND x.tipo = 'COBRO' AND NOT x.anulado)
          AND NOT EXISTS (SELECT 1 FROM "LiquidacionComisionesRenglon" x WHERE x."aplicacionId" = a.id AND x.tipo = 'ANULACION' AND NOT x.anulado))
        OR (NOT a.anulada AND EXISTS (SELECT 1 FROM "ChequeTercero" ch WHERE ch."empresaId" = $1::uuid AND ch."fechaRechazo" IS NOT NULL AND ch."fechaRechazo" <= $2::date
          AND ch."ingresoId" = CASE WHEN cr."origenTipo" = 'COBRO' THEN cr."origenId" ELSE r."ingresoId" END))
      )`, empresaId, fin);
    if (!candidatas.length) return [];
    const aplicaciones = await tx.aplicacionCobro.findMany({ where: { id: { in: candidatas.map((x) => x.id) } }, orderBy: [{ fecha: 'asc' }, { numero: 'asc' }, { id: 'asc' }] });
    const movs = new Map((await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: [...new Set(aplicaciones.flatMap((a) => [a.debitoMovId, a.creditoMovId]))] } }, select: { id: true, origenTipo: true, origenId: true } })).map((m) => [m.id, m]));
    const comprobantes = new Map((await tx.comprobanteVenta.findMany({ where: { id: { in: [...new Set(aplicaciones.map((a) => movs.get(a.debitoMovId)!.origenId))] } } })).map((c) => [c.id, c]));
    const compDe = (a: (typeof aplicaciones)[number]) => comprobantes.get(movs.get(a.debitoMovId)!.origenId)!;
    // Renglones vigentes de estas aplicaciones, indexados por tipo, aplicación y cheque
    const vigentes = await tx.liquidacionComisionesRenglon.findMany({ where: { anulado: false, aplicacionId: { in: aplicaciones.map((a) => a.id) } } });
    const indice = new Map<string, (typeof vigentes)[number][]>();
    for (const r of vigentes) {
      for (const k of [`${r.tipo}|${r.aplicacionId}`, `${r.tipo}|${r.aplicacionId}|${r.chequeId ?? ''}`]) indice.set(k, [...(indice.get(k) ?? []), r]);
    }
    const ya = (tipo: TipoRenglon, aplicacionId: string, chequeId: string | null = null) => indice.has(tipo === 'RECHAZO' ? `${tipo}|${aplicacionId}|${chequeId ?? ''}` : `${tipo}|${aplicacionId}`);

    const clientes = new Map((await tx.tercero.findMany({ where: { id: { in: [...new Set([...comprobantes.values()].map((c) => c.terceroId))] } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
    const reciboIds = aplicaciones.flatMap((a) => { const m = movs.get(a.creditoMovId)!; return m.origenTipo === 'RECIBO' ? [m.origenId] : []; });
    const recibos = new Map((reciboIds.length ? await tx.recibo.findMany({ where: { id: { in: [...new Set(reciboIds)] } } }) : []).map((r) => [r.id, r]));
    const nombreComp = (c: { tipo: string; letra: string; puntoVenta: number; numero: number | null }) => `${c.tipo === 'FACTURA' ? 'FC' : 'ND'} ${c.letra} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero ?? 0).padStart(8, '0')}`;
    const nombreCobro = (creditoMovId: string) => {
      const m = movs.get(creditoMovId)!;
      const r = m.origenTipo === 'RECIBO' ? recibos.get(m.origenId) : null;
      return r ? `Recibo ${String(r.puntoVenta).padStart(4, '0')}-${String(r.numero).padStart(8, '0')}` : 'Cobro de Tesorería';
    };
    /** Comisión de una aplicación: neto proporcional a lo cobrado (en pesos) por el porcentaje copiado. */
    const calcular = (a: (typeof aplicaciones)[number]) => {
      const c = compDe(a);
      const netoComp = c.netoGravado.plus(c.noGravado).plus(c.exento);
      const neto = c.total.isZero() ? new D(0) : r2(a.importePesosDebito.times(netoComp).div(c.total));
      const pct = c.comisionPct ?? new D(0);
      return { c, cobrado: a.importePesosDebito, neto, pct, comision: r2(neto.times(pct).div(100)) };
    };
    const renglon = (a: (typeof aplicaciones)[number], tipo: TipoRenglon, comision: Dec, chequeId: string | null = null, fecha = a.fecha): RenglonComision => {
      const k = calcular(a);
      return {
        vendedorId: k.c.vendedorId!, tipo, aplicacionId: a.id, comprobanteId: k.c.id, chequeId, fecha: fecha.toISOString().slice(0, 10), cliente: clientes.get(k.c.terceroId) ?? '',
        comprobante: nombreComp(k.c), cobro: nombreCobro(a.creditoMovId), cobrado: tipo === 'COBRO' ? k.cobrado : k.cobrado.neg(), neto: tipo === 'COBRO' ? k.neto : k.neto.neg(), porcentaje: k.pct, comision,
      };
    };

    const salida: RenglonComision[] = [];
    for (const a of aplicaciones) if (!a.anulada && a.fecha <= fin && !ya('COBRO', a.id)) salida.push(renglon(a, 'COBRO', calcular(a).comision));
    // Aplicaciones liquidadas que después se anularon: se descuenta lo que quedó pagado neto (el cobro menos los
    // rechazos ya descontados), para no descontar dos veces
    for (const a of aplicaciones) {
      const pagado = indice.get(`COBRO|${a.id}`)?.[0];
      if (!a.anulada || !pagado || ya('ANULACION', a.id)) continue;
      const rechazos = (indice.get(`RECHAZO|${a.id}`) ?? []).reduce((s2, r) => s2.plus(r.comision), new D(0));
      salida.push({ ...renglon(a, 'ANULACION', pagado.comision.plus(rechazos).neg()), cobrado: pagado.cobrado.neg(), neto: pagado.neto.neg(), porcentaje: pagado.porcentaje });
    }
    // Cheques rechazados: la parte proporcional de la comisión del cobro que los recibió
    const ingresoDe = (creditoMovId: string) => {
      const m = movs.get(creditoMovId)!;
      return m.origenTipo === 'COBRO' ? m.origenId : recibos.get(m.origenId)?.ingresoId ?? null;
    };
    const porIngreso = new Map<string, (typeof aplicaciones)[number][]>();
    for (const a of aplicaciones) {
      const ing = a.anulada ? null : ingresoDe(a.creditoMovId);
      if (ing) porIngreso.set(ing, [...(porIngreso.get(ing) ?? []), a]);
    }
    const ingresoIds = [...porIngreso.keys()];
    const rechazados = ingresoIds.length ? await tx.chequeTercero.findMany({ where: { ingresoId: { in: ingresoIds }, fechaRechazo: { not: null, lte: fin } } }) : [];
    if (rechazados.length) {
      const ids = [...new Set(rechazados.map((c) => c.ingresoId))];
      const [efectivo, cheques, transf, cupones] = await Promise.all([
        tx.ingresoValoresEfectivo.findMany({ where: { ingresoId: { in: ids } } }), tx.chequeTercero.findMany({ where: { ingresoId: { in: ids } } }),
        tx.transferenciaRecibida.findMany({ where: { ingresoId: { in: ids } } }), tx.cuponTarjeta.findMany({ where: { ingresoId: { in: ids } } }),
      ]);
      const totales = new Map<string, Dec>();
      for (const x of [...efectivo, ...cheques, ...transf, ...cupones]) totales.set(x.ingresoId, (totales.get(x.ingresoId) ?? new D(0)).plus(x.importe));
      for (const ch of rechazados) {
        const tot = totales.get(ch.ingresoId) ?? new D(0);
        if (tot.isZero()) continue;
        for (const a of porIngreso.get(ch.ingresoId) ?? []) {
          if (ya('RECHAZO', a.id, ch.id)) continue;
          const k = calcular(a);
          salida.push({ ...renglon(a, 'RECHAZO', r2(k.comision.times(ch.importe).div(tot)).neg(), ch.id, ch.fechaRechazo!), cobrado: ch.importe.neg(), neto: r2(k.neto.times(ch.importe).div(tot)).neg() });
        }
      }
    }
    return salida;
  }

  /** Consulta del mes (GET): pendientes agrupados por vendedor. */
  async consulta(anio: number, mes: number) {
    const rs = await this.pendientes(this.tenant.db, anio, mes);
    const vendedores = await this.tenant.db.vendedor.findMany({ where: { id: { in: [...new Set(rs.map((r) => r.vendedorId))] } } });
    const f = (x: Dec) => x.toFixed(2);
    return {
      anio, mes,
      vendedores: vendedores.map((v) => {
        const propios = rs.filter((r) => r.vendedorId === v.id);
        const comision = propios.reduce((s, r) => s.plus(r.comision), new D(0));
        return {
          vendedorId: v.id, nombre: v.nombre, tipo: v.tipo, renglones: propios.length, neto: f(propios.reduce((s, r) => s.plus(r.neto), new D(0))), comision: f(comision), liquidable: comision.gt(0),
          detalle: propios.map((r) => ({ ...r, cobrado: f(r.cobrado), neto: f(r.neto), porcentaje: f(r.porcentaje), comision: f(r.comision) })),
        };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    };
  }
}
