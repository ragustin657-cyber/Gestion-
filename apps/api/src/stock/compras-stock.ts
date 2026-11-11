import { BadRequestException, Injectable } from '@nestjs/common';
import type { Articulo } from '@prisma/client';
import { bloquear } from '../compras/comun';
import { ConfigComprasService } from '../compras/config/config-compras.service';
import { AsientosService } from '../contabilidad/asientos/asientos.service';
import { D, Dec } from '../contabilidad/consultas/saldos';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { contabilizarRegularizacion, Partida, revertirOrigen } from './documentos/documentos.service';
import { MotorStock, Resultado } from './motor';

export const ORIGEN_RECEPCION = 'RECEPCION';
export const ORIGEN_COMPRA = 'COMPRA';
export const ORIGEN_STOCK_COMPRA = 'STOCK_COMPRA';
export const SIN_DEPOSITO = 'Indique el depósito: hay artículos que controlan stock';
const cero = new D(0);

interface RenglonIr { id: string; cantidad: Dec; ordenCompraRenglon: { articuloId: string | null; precioUnitario: Dec; bonificacionPct: Dec; ordenCompra: { cotizacion: Dec } } }
interface RenglonFactura { id: string; orden: number; origen: string; articuloId: string | null; cantidad: Dec; importe: Dec; informeRecepcionRenglonId: string | null }

/** Stock de recepciones y facturas de compra (spec §4). */
@Injectable()
export class ComprasStock {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly motor: MotorStock,
    private readonly asientos: AsientosService,
    private readonly conceptos: ConfigComprasService,
  ) {}

  /** Bloquea los artículos que controlan stock antes de generar asientos (orden de bloqueo: artículos, luego período y numeración). */
  async bloquearArticulos(tx: TxEmpresa, ids: (string | null | undefined)[]) {
    const stock = await this.conStock(tx, ids);
    if (stock.size) await bloquear(tx, 'Articulo', this.tenant.empresaId, [...stock.keys()]);
  }

  /** ¿La recepción de este renglón movió stock? (no, si se recibió antes de que el artículo controlara stock) */
  async recepcionConStock(tx: TxEmpresa, informeRecepcionRenglonId: string): Promise<boolean> {
    return !!(await tx.movimientoStock.count({ where: { origenTipo: ORIGEN_RECEPCION, origenRenglonId: informeRecepcionRenglonId, anulaAId: null } }));
  }

  /** Artículos que controlan stock, por id. */
  async conStock(tx: TxEmpresa, ids: (string | null | undefined)[]): Promise<Map<string, Articulo>> {
    const lista = ids.filter((x): x is string => !!x);
    if (!lista.length) return new Map();
    return new Map((await tx.articulo.findMany({ where: { id: { in: lista }, controlaStock: true } })).map((a) => [a.id, a]));
  }

  /** Recepción: entrada al precio de la OC y asiento Mercaderías / Mercadería recibida a facturar. Devuelve el asiento. */
  async alRecibir(tx: TxEmpresa, ir: { id: string; numero: number; fecha: Date; depositoId: string | null; proveedor: string; renglones: RenglonIr[] }): Promise<string | null> {
    const stock = await this.conStock(tx, ir.renglones.map((r) => r.ordenCompraRenglon.articuloId));
    const renglones = ir.renglones.filter((r) => r.ordenCompraRenglon.articuloId && stock.has(r.ordenCompraRenglon.articuloId));
    if (!renglones.length) return null;
    if (!ir.depositoId) throw new BadRequestException(SIN_DEPOSITO);
    const res = await this.motor.moverVarios(tx, renglones.map((r) => {
      const oc = r.ordenCompraRenglon;
      const costo = new D(oc.precioUnitario).times(new D(1).minus(new D(oc.bonificacionPct).div(100))).times(oc.ordenCompra.cotizacion).toDecimalPlaces(6);
      return { fecha: ir.fecha, articuloId: oc.articuloId!, depositoId: ir.depositoId, cantidad: new D(r.cantidad), costoUnitario: costo, tipo: 'RECEPCION' as const, origenTipo: ORIGEN_RECEPCION, origenId: ir.id, origenRenglonId: r.id };
    }));
    const p = new Partida();
    const [merc, aFacturar] = await Promise.all([this.conceptos.cuenta(tx, 'MERCADERIAS'), this.conceptos.cuenta(tx, 'MERCADERIA_A_FACTURAR')]);
    for (const r of res) {
      p.agregar(merc, r.importe);
      p.agregar(aFacturar, r.importe.neg());
    }
    await this.regularizar(tx, p, res, merc);
    return (await this.asientos.generar(tx, { fecha: ir.fecha, descripcion: `Recepción N° ${ir.numero} - ${ir.proveedor}`, origenTipo: ORIGEN_RECEPCION, origenId: ir.id, renglones: p.renglones() })).id;
  }

  /** Anulación de la recepción: salida al costo de entrada y contraasiento. */
  async alAnularRecepcion(tx: TxEmpresa, ir: { id: string; asientoId: string | null }, fecha: Date, motivo: string): Promise<string | null> {
    const res = await revertirOrigen(tx, this.motor, ORIGEN_RECEPCION, ir.id, fecha);
    const contra = ir.asientoId ? (await this.asientos.contraasiento(tx, ir.asientoId, fecha, `Anulación: ${motivo}`)).id : null;
    await contabilizarRegularizacion(tx, this.asientos, this.conceptos, res, { fecha, descripcion: 'Regularización de stock - anulación de recepción', origenTipo: ORIGEN_RECEPCION, origenId: ir.id });
    return contra;
  }

  /** Cuenta del renglón de factura para un artículo que controla stock. */
  async cuentaRenglon(tx: TxEmpresa, origen: string): Promise<string> {
    return this.conceptos.cuenta(tx, origen === 'RECEPCION' ? 'MERCADERIA_A_FACTURAR' : 'MERCADERIAS');
  }

  /** Reparte una diferencia de costo entre el stock que queda y el costo de lo vendido. */
  async repartir(tx: TxEmpresa, articuloId: string, cantidad: Dec, diferencia: Dec): Promise<{ aStock: Dec; aCosto: Dec }> {
    await bloquear(tx, 'Articulo', this.tenant.empresaId, [articuloId]);
    const a = await tx.articulo.findUniqueOrThrow({ where: { id: articuloId } });
    const stock = D.max(new D(a.stockCantidad), cero);
    const aStock = diferencia.times(D.min(stock, cantidad)).div(cantidad).toDecimalPlaces(2);
    return { aStock, aCosto: diferencia.minus(aStock) };
  }

  /** Factura, NC o ND de compra ya registrada: mueve stock y genera el asiento STOCK_COMPRA si hace falta. */
  async alFacturar(tx: TxEmpresa, c: { id: string; tipo: string; fecha: Date; depositoId: string | null; cotizacion: Dec; descripcion: string; renglones: RenglonFactura[]; pesos?: Map<number, Dec> }) {
    const stock = await this.conStock(tx, c.renglones.map((r) => r.articuloId));
    const renglones = c.renglones.filter((r) => r.articuloId && stock.has(r.articuloId)).sort((a, b) => a.articuloId!.localeCompare(b.articuloId!));
    if (!renglones.length) return;
    const [merc, aFacturar, cmv] = await Promise.all(['MERCADERIAS', 'MERCADERIA_A_FACTURAR', 'COSTO_MERCADERIAS_VENDIDAS'].map((x) => this.conceptos.cuenta(tx, x as 'MERCADERIAS')));
    const p = new Partida();
    const esNotaCD = c.tipo === 'NOTA_CREDITO' || c.tipo === 'NOTA_DEBITO';
    const base = { fecha: c.fecha, origenTipo: ORIGEN_COMPRA, origenId: c.id };
    for (const r of renglones) {
      // El importe en pesos es el del asiento de la factura (el redondeo en moneda extranjera ya repartido)
      const pesos = c.pesos?.get(r.orden) ?? new D(r.importe).times(c.cotizacion).toDecimalPlaces(2);
      const cantidad = new D(r.cantidad);
      const recibido = r.origen === 'RECEPCION'
        ? await tx.movimientoStock.findFirst({ where: { origenTipo: ORIGEN_RECEPCION, origenRenglonId: r.informeRecepcionRenglonId, anulaAId: null } })
        : null;
      if (r.origen === 'RECEPCION' && recibido) {
        const valorRecibido = cantidad.times(recibido.costoUnitario).toDecimalPlaces(2);
        const d = pesos.minus(valorRecibido);
        if (d.isZero()) continue;
        const { aStock, aCosto } = await this.repartir(tx, r.articuloId!, cantidad, d);
        if (!aStock.isZero()) await this.regularizar(tx, p, [await this.motor.mover(tx, { ...base, articuloId: r.articuloId!, depositoId: null, cantidad: cero, importe: aStock, tipo: 'AJUSTE_COSTO', origenRenglonId: r.id })], merc);
        p.agregar(merc, aStock);
        p.agregar(cmv, aCosto);
        p.agregar(aFacturar, d.neg());
      } else if (esNotaCD) {
        const d = c.tipo === 'NOTA_CREDITO' ? pesos.neg() : pesos;
        const { aStock, aCosto } = await this.repartir(tx, r.articuloId!, cantidad, d);
        if (!aStock.isZero()) await this.regularizar(tx, p, [await this.motor.mover(tx, { ...base, articuloId: r.articuloId!, depositoId: null, cantidad: cero, importe: aStock, tipo: 'AJUSTE_COSTO', origenRenglonId: r.id })], merc);
        // El renglón de la NC/ND ya va a Mercaderías: la parte que corresponde a lo vendido pasa al costo
        p.agregar(cmv, aCosto);
        p.agregar(merc, aCosto.neg());
      } else {
        // Compra directa, o recepción hecha antes de que el artículo controlara stock: entra al depósito de la recepción o de la factura
        const ir = r.origen === 'RECEPCION' && r.informeRecepcionRenglonId
          ? await tx.informeRecepcionRenglon.findUnique({ where: { id: r.informeRecepcionRenglonId }, include: { informeRecepcion: true } })
          : null;
        const depositoId = ir?.informeRecepcion.depositoId ?? c.depositoId;
        if (!depositoId) throw new BadRequestException(SIN_DEPOSITO);
        const res = await this.motor.mover(tx, { ...base, articuloId: r.articuloId!, depositoId, cantidad, costoUnitario: pesos.div(cantidad).toDecimalPlaces(6), importe: pesos, tipo: 'COMPRA', origenRenglonId: r.id });
        await this.regularizar(tx, p, [res], merc);
      }
    }
    const rs = p.renglones();
    if (rs.length) await this.asientos.generar(tx, { fecha: c.fecha, descripcion: `Costo de mercaderías - ${c.descripcion}`, origenTipo: ORIGEN_STOCK_COMPRA, origenId: c.id, renglones: rs });
  }

  /** Anulación de la factura: movimientos inversos y contraasiento del asiento STOCK_COMPRA. */
  async alAnularFactura(tx: TxEmpresa, comprobanteId: string, fecha: Date, motivo: string) {
    const res = await revertirOrigen(tx, this.motor, ORIGEN_COMPRA, comprobanteId, fecha);
    const a = await tx.asiento.findFirst({ where: { origenTipo: ORIGEN_STOCK_COMPRA, origenId: comprobanteId, anulaAId: null } });
    if (a && !(await tx.asiento.count({ where: { anulaAId: a.id } }))) await this.asientos.contraasiento(tx, a.id, fecha, `Anulación: ${motivo}`);
    await contabilizarRegularizacion(tx, this.asientos, this.conceptos, res, { fecha, descripcion: 'Regularización de stock - anulación de factura de compra', origenTipo: ORIGEN_STOCK_COMPRA, origenId: comprobanteId });
  }

  /** Regularizaciones de stock negativo: van al costo de lo vendido. */
  private async regularizar(tx: TxEmpresa, p: Partida, res: Resultado[], merc: string) {
    const total = res.reduce((s, r) => s.plus(r.regularizacion), cero);
    if (total.isZero()) return;
    p.agregar(merc, total);
    p.agregar(await this.conceptos.cuenta(tx, 'COSTO_MERCADERIAS_VENDIDAS'), total.neg());
  }
}
