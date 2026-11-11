import { BadRequestException, Injectable } from '@nestjs/common';
import type { MovimientoStock } from '@prisma/client';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { D, Dec, ejercicioDe, saldosPorCuenta } from '../../contabilidad/consultas/saldos';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

const cero = new D(0);
const ETIQUETA_VENTA: Record<string, string> = { FACTURA: 'Factura', NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito' };
const ETIQUETA_COMPRA: Record<string, string> = { FACTURA: 'Factura de compra', NOTA_CREDITO: 'NC de compra', NOTA_DEBITO: 'ND de compra', TICKET: 'Ticket de compra' };
const ETIQUETA_DOC: Record<string, string> = { TRANSFERENCIA: 'Transferencia', INVENTARIO: 'Inventario físico', INICIAL: 'Inventario inicial', SALIDA: 'Salida manual' };
const nro = (pv: number, n: number | null) => `${String(pv).padStart(5, '0')}-${String(n ?? 0).padStart(8, '0')}`;

@Injectable()
export class ConsultasStockService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly conceptos: ConfigComprasService,
  ) {}

  async existencias(q: { depositoId?: string; articuloId?: string; soloConStock?: string }) {
    const db = this.tenant.db;
    const articulos = await db.articulo.findMany({ where: { controlaStock: true, id: q.articuloId || undefined }, orderBy: { codigo: 'asc' } });
    const saldos = await db.saldoStock.findMany({ where: { articuloId: { in: articulos.map((a) => a.id) }, depositoId: q.depositoId || undefined } });
    const depositos = new Map((await db.deposito.findMany()).map((d) => [d.id, d]));
    const filas = articulos.map((a) => ({
      articuloId: a.id, codigo: a.codigo, descripcion: a.descripcion, unidad: a.unidad,
      depositos: saldos.filter((s) => s.articuloId === a.id && !new D(s.cantidad).isZero())
        .map((s) => ({ depositoId: s.depositoId, nombre: depositos.get(s.depositoId)?.nombre ?? '', cantidad: new D(s.cantidad).toString() }))
        .sort((x, y) => x.nombre.localeCompare(y.nombre)),
      cantidad: new D(a.stockCantidad).toString(), costoPromedio: new D(a.costoPromedio).toString(), valor: new D(a.stockValor).toFixed(2),
    })).filter((f) => q.soloConStock !== 'true' || f.depositos.length > 0);
    return { filas, total: filas.reduce((s, f) => s.plus(f.valor), cero).toFixed(2) };
  }

  /** Texto legible del documento que originó cada movimiento. */
  private async documentos(tx: TxEmpresa, movs: MovimientoStock[]) {
    const ids = (tipo: string) => [...new Set(movs.filter((m) => m.origenTipo === tipo).map((m) => m.origenId))];
    const [irs, compras, ventas, docs] = await Promise.all([
      tx.informeRecepcion.findMany({ where: { id: { in: ids('RECEPCION') } } }),
      tx.comprobanteCompra.findMany({ where: { id: { in: ids('COMPRA') } } }),
      tx.comprobanteVenta.findMany({ where: { id: { in: ids('VENTA') } } }),
      tx.documentoStock.findMany({ where: { id: { in: ids('DOC_STOCK') } } }),
    ]);
    const r = new Map<string, string>();
    irs.forEach((x) => r.set(x.id, `Recepción N° ${x.numero}`));
    compras.forEach((x) => r.set(x.id, `${ETIQUETA_COMPRA[x.tipo]} ${x.letra} ${nro(x.puntoVenta, x.numero)}`.replace(/\s+/g, ' ')));
    ventas.forEach((x) => r.set(x.id, `${ETIQUETA_VENTA[x.tipo]} ${x.letra} ${nro(x.puntoVenta, x.numero)}`));
    docs.forEach((x) => r.set(x.id, `${ETIQUETA_DOC[x.tipo]} N° ${x.numero}`));
    return r;
  }

  async kardex(q: { articuloId?: string; depositoId?: string; desde?: string; hasta?: string }) {
    if (!q.articuloId) throw new BadRequestException('Indique el artículo');
    const db = this.tenant.db;
    const articulo = await db.articulo.findUnique({ where: { id: q.articuloId } });
    if (!articulo) throw new BadRequestException('Artículo inexistente');
    const desde = fechaQuery(q.desde);
    const hasta = fechaQuery(q.hasta);
    const depositoId = q.depositoId || undefined;
    // Con filtro de depósito, los movimientos de solo importe no cuentan
    const where = { articuloId: q.articuloId, ...(depositoId ? { depositoId } : {}) };
    const previo = desde ? await db.movimientoStock.aggregate({ where: { ...where, fecha: { lt: desde } }, _sum: { cantidad: true, importe: true } }) : null;
    const movs = await db.movimientoStock.findMany({ where: { ...where, fecha: { gte: desde, lte: hasta } }, orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }] });
    const docs = await this.documentos(db, movs);
    let cantidad: Dec = new D(previo?._sum.cantidad ?? 0);
    let valor: Dec = new D(previo?._sum.importe ?? 0);
    const saldoInicial = { cantidad: cantidad.toString(), valor: valor.toFixed(2) };
    return {
      articulo: { id: articulo.id, codigo: articulo.codigo, descripcion: articulo.descripcion, unidad: articulo.unidad },
      saldoInicial: depositoId ? { cantidad: saldoInicial.cantidad, valor: null } : saldoInicial,
      movimientos: movs.map((m) => {
        const q0 = new D(m.cantidad);
        cantidad = cantidad.plus(q0);
        valor = valor.plus(m.importe);
        return {
          id: m.id, fecha: m.fecha.toISOString().slice(0, 10), tipo: m.tipo, documento: docs.get(m.origenId) ?? m.origenTipo, anulacion: !!m.anulaAId,
          entrada: q0.gt(0) ? q0.toString() : null, salida: q0.lt(0) ? q0.neg().toString() : null, saldoCantidad: cantidad.toString(),
          costoUnitario: new D(m.costoUnitario).toString(), importe: new D(m.importe).toFixed(2), saldoValor: depositoId ? null : valor.toFixed(2),
        };
      }),
    };
  }

  async valuacion(q: { fecha?: string }) {
    const db = this.tenant.db;
    const fecha = fechaQuery(q.fecha, true)!;
    const g = await db.movimientoStock.groupBy({ by: ['articuloId'], where: { fecha: { lte: fecha } }, _sum: { cantidad: true, importe: true } });
    const articulos = new Map((await db.articulo.findMany({ where: { id: { in: g.map((x) => x.articuloId) } } })).map((a) => [a.id, a]));
    const filas = g.map((x) => ({ articuloId: x.articuloId, codigo: articulos.get(x.articuloId)!.codigo, descripcion: articulos.get(x.articuloId)!.descripcion, cantidad: new D(x._sum.cantidad ?? 0).toString(), valor: new D(x._sum.importe ?? 0).toFixed(2) }))
      .filter((f) => !new D(f.cantidad).isZero() || !new D(f.valor).isZero())
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    const total = filas.reduce((s, f) => s.plus(f.valor), cero);
    let mayor = cero;
    try {
      const ej = await ejercicioDe(db, fecha);
      const merc = await this.conceptos.cuenta(db, 'MERCADERIAS');
      const s = (await saldosPorCuenta(db, { ejercicioId: ej.id, hasta: fecha, excluirTipos: ['CIERRE'] })).get(merc);
      mayor = s ? s.debe.minus(s.haber) : cero;
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
    }
    return { fecha: fecha.toISOString().slice(0, 10), filas, total: total.toFixed(2), mayor: mayor.toFixed(2), control: total.minus(mayor).toFixed(2) };
  }
}
