import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MovimientoCuentaCorriente } from '@prisma/client';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { ORIGENES_CLIENTE } from '../../compras/comun';
import { paginacion } from '../../comun/paginado';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { INCLUIR_VENTA, numeroVenta } from '../comprobantes/comprobantes.service';

const DIA = 86400000;
const f2 = (d: Dec) => d.toFixed(2);
const NOMBRE = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito' } as const;

export interface FiltroVentas { terceroId?: string; desde?: string; hasta?: string; tipo?: string; estado?: string; puntoVentaId?: string; pagina?: string; porPagina?: string }

@Injectable()
export class ConsultasVentasService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Saldo de la cuenta corriente de cada comprobante autorizado (en su moneda). */
  private async saldos(ids: string[]) {
    const movs = await this.tenant.db.movimientoCuentaCorriente.findMany({ where: { origenTipo: 'VENTA', origenId: { in: ids }, anulado: false } });
    return new Map(movs.map((m) => [m.origenId, f2(m.saldo.abs())]));
  }

  async comprobantes(f: FiltroVentas) {
    const where: Prisma.ComprobanteVentaWhereInput = {
      terceroId: f.terceroId || undefined, puntoVentaId: f.puntoVentaId || undefined,
      tipo: f.tipo ? (f.tipo as Prisma.ComprobanteVentaWhereInput['tipo']) : undefined,
      estado: f.estado ? (f.estado as Prisma.ComprobanteVentaWhereInput['estado']) : undefined,
      fecha: { gte: fechaQuery(f.desde), lte: fechaQuery(f.hasta) },
    };
    const db = this.tenant.db;
    const [items, total] = await Promise.all([
      db.comprobanteVenta.findMany({ where, include: { tercero: { select: { razonSocial: true, cuit: true } } }, orderBy: [{ fecha: 'desc' }, { numeroInterno: 'desc' }], ...paginacion(f) }),
      db.comprobanteVenta.count({ where }),
    ]);
    const saldos = await this.saldos(items.map((c) => c.id));
    return { items: items.map((c) => ({ ...c, saldo: saldos.get(c.id) ?? null })), total };
  }

  async comprobante(id: string) {
    const c = await this.tenant.db.comprobanteVenta.findUnique({ where: { id }, include: INCLUIR_VENTA });
    if (!c) throw new NotFoundException('Comprobante no encontrado');
    const asociado = c.comprobanteAsociadoId ? await this.tenant.db.comprobanteVenta.findUnique({ where: { id: c.comprobanteAsociadoId } }) : null;
    return { ...c, saldo: (await this.saldos([id])).get(id) ?? null, asociado };
  }

  async recibos(f: FiltroVentas) {
    const where: Prisma.ReciboWhereInput = {
      terceroId: f.terceroId || undefined, estado: f.estado ? (f.estado as Prisma.ReciboWhereInput['estado']) : undefined,
      fecha: { gte: fechaQuery(f.desde), lte: fechaQuery(f.hasta) },
    };
    const db = this.tenant.db;
    const [items, total] = await Promise.all([
      db.recibo.findMany({ where, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(f) }),
      db.recibo.count({ where }),
    ]);
    const terceros = await db.tercero.findMany({ where: { id: { in: [...new Set(items.map((r) => r.terceroId))] } }, select: { id: true, razonSocial: true } });
    return { items: items.map((r) => ({ ...r, razonSocial: terceros.find((t) => t.id === r.terceroId)?.razonSocial ?? '' })), total };
  }

  /** Descripción de cada movimiento: comprobante, recibo o cobro de Tesorería. */
  private async describir(movs: MovimientoCuentaCorriente[]) {
    const db = this.tenant.db;
    const ids = movs.map((m) => m.origenId);
    const ventas = await db.comprobanteVenta.findMany({ where: { id: { in: ids } } });
    const recibos = await db.recibo.findMany({ where: { id: { in: ids } } });
    const ingresos = await db.ingresoValores.findMany({ where: { id: { in: ids } } });
    return (m: MovimientoCuentaCorriente) => {
      const v = ventas.find((x) => x.id === m.origenId);
      if (v) return `${NOMBRE[v.tipo]} ${v.letra} ${numeroVenta(v.puntoVenta, v.numero)}`;
      const r = recibos.find((x) => x.id === m.origenId);
      if (r) return `Recibo ${numeroVenta(r.puntoVenta, r.numero)}`;
      const i = ingresos.find((x) => x.id === m.origenId);
      if (i) return `Cobro de Tesorería ${i.numero}`;
      return m.origenTipo;
    };
  }

  /** Cuenta corriente en pesos: saldo anterior, movimientos con saldo acumulado y comprobantes pendientes. */
  async cuentaCorriente(terceroId: string, desde?: string, hasta?: string) {
    const db = this.tenant.db;
    const tercero = await db.tercero.findUnique({ where: { id: terceroId }, select: { id: true, razonSocial: true, cuit: true, tipoDocumento: true } });
    if (!tercero) throw new NotFoundException('Cliente no encontrado');
    const base = { terceroId, anulado: false, origenTipo: { in: ORIGENES_CLIENTE } };
    const d = fechaQuery(desde), h = fechaQuery(hasta);
    const anterior = d ? await db.movimientoCuentaCorriente.aggregate({ where: { ...base, fecha: { lt: d } }, _sum: { importePesos: true } }) : null;
    const movs = await db.movimientoCuentaCorriente.findMany({ where: { ...base, fecha: { gte: d, lte: h } }, orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }] });
    const describir = await this.describir(movs);
    let saldo = new D(anterior?._sum.importePesos ?? 0);
    const saldoAnterior = f2(saldo);
    const movimientos = movs.map((m) => {
      saldo = saldo.plus(m.importePesos);
      return {
        id: m.id, origenTipo: m.origenTipo, origenId: m.origenId, fecha: m.fecha, comprobante: describir(m), monedaCodigo: m.monedaCodigo, importe: f2(m.importe),
        debe: m.importePesos.gt(0) ? f2(m.importePesos) : '0.00', haber: m.importePesos.lt(0) ? f2(m.importePesos.neg()) : '0.00', saldo: f2(saldo),
      };
    });
    const corte = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
    const abiertos = await db.movimientoCuentaCorriente.findMany({ where: { ...base, saldo: { gt: 0 } }, orderBy: { fechaVencimiento: 'asc' } });
    const describirAbiertos = await this.describir(abiertos);
    const pendientes = abiertos.map((m) => ({
      id: m.id, origenId: m.origenId, comprobante: describirAbiertos(m), fecha: m.fecha, vence: m.fechaVencimiento, monedaCodigo: m.monedaCodigo,
      diasVencido: Math.max(0, Math.round((corte.getTime() - m.fechaVencimiento.getTime()) / DIA)), saldo: f2(m.saldo), saldoPesos: f2(m.saldoPesos),
    }));
    return { tercero, saldoAnterior, movimientos, saldoFinal: f2(saldo), pendientes };
  }

  /** Saldo de cada cliente (en pesos) por antigüedad de vencimiento al corte. Los saldos a favor van en "no vencido". */
  async saldosClientes(fecha?: string) {
    const db = this.tenant.db;
    const corte = fechaQuery(fecha) ?? new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
    const movs = await db.movimientoCuentaCorriente.findMany({ where: { anulado: false, origenTipo: { in: ORIGENES_CLIENTE }, NOT: { saldoPesos: 0 } } });
    const terceros = await db.tercero.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.terceroId))] } }, select: { id: true, razonSocial: true } });
    type Tramos = { noVencido: Dec; d1a30: Dec; d31a60: Dec; d61a90: Dec; mas90: Dec };
    const filas = new Map<string, Tramos>();
    for (const m of movs) {
      const f = filas.get(m.terceroId) ?? { noVencido: new D(0), d1a30: new D(0), d31a60: new D(0), d61a90: new D(0), mas90: new D(0) };
      const dias = Math.round((corte.getTime() - m.fechaVencimiento.getTime()) / DIA);
      const tramo: keyof Tramos = m.saldoPesos.lt(0) || dias <= 0 ? 'noVencido' : dias <= 30 ? 'd1a30' : dias <= 60 ? 'd31a60' : dias <= 90 ? 'd61a90' : 'mas90';
      f[tramo] = f[tramo].plus(m.saldoPesos);
      filas.set(m.terceroId, f);
    }
    return {
      filas: [...filas.entries()]
        .map(([terceroId, f]) => ({ terceroId, razonSocial: terceros.find((t) => t.id === terceroId)?.razonSocial ?? '', total: f.noVencido.plus(f.d1a30).plus(f.d31a60).plus(f.d61a90).plus(f.mas90), f }))
        .filter((x) => !x.total.isZero())
        .sort((a, b) => b.total.cmp(a.total))
        .map((x) => ({ terceroId: x.terceroId, razonSocial: x.razonSocial, saldo: f2(x.total), noVencido: f2(x.f.noVencido), d1a30: f2(x.f.d1a30), d31a60: f2(x.f.d31a60), d61a90: f2(x.f.d61a90), mas90: f2(x.f.mas90) })),
    };
  }
}
