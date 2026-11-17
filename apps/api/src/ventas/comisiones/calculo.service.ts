import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);
const ORIGENES_COBRO = ['RECIBO', 'COBRO'];

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
    const comprobantes = await tx.comprobanteVenta.findMany({ where: { vendedorId: { not: null }, estado: 'AUTORIZADO', tipo: { not: 'NOTA_CREDITO' } } });
    if (!comprobantes.length) return [];
    const porId = new Map(comprobantes.map((c) => [c.id, c]));
    const debitos = await tx.movimientoCuentaCorriente.findMany({ where: { origenTipo: 'VENTA', origenId: { in: comprobantes.map((c) => c.id) } }, select: { id: true, origenId: true } });
    const compDeDebito = new Map(debitos.map((m) => [m.id, porId.get(m.origenId)!]));
    const aplicaciones = await tx.aplicacionCobro.findMany({ where: { debitoMovId: { in: debitos.map((m) => m.id) } }, orderBy: [{ fecha: 'asc' }, { numero: 'asc' }, { id: 'asc' }] });
    const creditos = new Map((await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: [...new Set(aplicaciones.map((a) => a.creditoMovId))] } }, select: { id: true, origenTipo: true, origenId: true } })).map((m) => [m.id, m]));
    // Solo comisionan los cobros (recibos e ingresos de valores), no las NC ni los cheques rechazados
    const comisionables = aplicaciones.filter((a) => ORIGENES_COBRO.includes(creditos.get(a.creditoMovId)?.origenTipo ?? ''));
    const vigentes = await tx.liquidacionComisionesRenglon.findMany({ where: { anulado: false, aplicacionId: { in: comisionables.map((a) => a.id) } } });
    const ya = (tipo: TipoRenglon, aplicacionId: string, chequeId: string | null = null) => vigentes.some((r) => r.tipo === tipo && r.aplicacionId === aplicacionId && (tipo !== 'RECHAZO' || r.chequeId === chequeId));

    const clientes = new Map((await tx.tercero.findMany({ where: { id: { in: [...new Set(comprobantes.map((c) => c.terceroId))] } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
    const recibos = new Map((await tx.recibo.findMany({ where: { id: { in: comisionables.flatMap((a) => (creditos.get(a.creditoMovId)!.origenTipo === 'RECIBO' ? [creditos.get(a.creditoMovId)!.origenId] : [])) } } })).map((r) => [r.id, r]));
    const nombreComp = (c: (typeof comprobantes)[number]) => `${c.tipo === 'FACTURA' ? 'FC' : 'ND'} ${c.letra} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero ?? 0).padStart(8, '0')}`;
    const nombreCobro = (creditoMovId: string) => {
      const m = creditos.get(creditoMovId)!;
      const r = m.origenTipo === 'RECIBO' ? recibos.get(m.origenId) : null;
      return r ? `Recibo ${String(r.puntoVenta).padStart(4, '0')}-${String(r.numero).padStart(8, '0')}` : 'Cobro de Tesorería';
    };
    /** Comisión de una aplicación: neto proporcional a lo cobrado (en pesos) por el porcentaje copiado. */
    const calcular = (a: (typeof aplicaciones)[number]) => {
      const c = compDeDebito.get(a.debitoMovId)!;
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
    // Cobros pendientes
    for (const a of comisionables) if (!a.anulada && a.fecha <= fin && !ya('COBRO', a.id)) salida.push(renglon(a, 'COBRO', calcular(a).comision));
    // Aplicaciones liquidadas que después se anularon: se descuenta lo que se pagó
    for (const a of comisionables) {
      const pagado = vigentes.find((r) => r.tipo === 'COBRO' && r.aplicacionId === a.id);
      if (a.anulada && pagado && !ya('ANULACION', a.id)) salida.push({ ...renglon(a, 'ANULACION', pagado.comision.neg()), cobrado: pagado.cobrado.neg(), neto: pagado.neto.neg(), porcentaje: pagado.porcentaje });
    }
    // Cheques rechazados: la parte proporcional de la comisión del cobro que los recibió
    const ingresoDe = (creditoMovId: string) => {
      const m = creditos.get(creditoMovId)!;
      return m.origenTipo === 'COBRO' ? m.origenId : recibos.get(m.origenId)?.ingresoId ?? null;
    };
    const ingresoIds = [...new Set(comisionables.map((a) => ingresoDe(a.creditoMovId)).filter((x): x is string => !!x))];
    const rechazados = ingresoIds.length ? await tx.chequeTercero.findMany({ where: { ingresoId: { in: ingresoIds }, fechaRechazo: { not: null, lte: fin } } }) : [];
    if (rechazados.length) {
      const ids = [...new Set(rechazados.map((c) => c.ingresoId))];
      const [efectivo, cheques, transf, cupones] = await Promise.all([
        tx.ingresoValoresEfectivo.findMany({ where: { ingresoId: { in: ids } } }), tx.chequeTercero.findMany({ where: { ingresoId: { in: ids } } }),
        tx.transferenciaRecibida.findMany({ where: { ingresoId: { in: ids } } }), tx.cuponTarjeta.findMany({ where: { ingresoId: { in: ids } } }),
      ]);
      const total = (id: string) => [...efectivo, ...cheques, ...transf, ...cupones].filter((x) => x.ingresoId === id).reduce((s, x) => s.plus(x.importe), new D(0));
      for (const ch of rechazados) {
        const tot = total(ch.ingresoId);
        if (tot.isZero()) continue;
        for (const a of comisionables.filter((x) => !x.anulada && ingresoDe(x.creditoMovId) === ch.ingresoId)) {
          if (ya('RECHAZO', a.id, ch.id)) continue;
          const comision = r2(calcular(a).comision.times(ch.importe).div(tot)).neg();
          salida.push({ ...renglon(a, 'RECHAZO', comision, ch.id, ch.fechaRechazo!), cobrado: ch.importe.neg(), neto: r2(calcular(a).neto.times(ch.importe).div(tot)).neg() });
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
