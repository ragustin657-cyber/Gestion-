import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigComprasService } from '../compras/config/config-compras.service';
import { AsientosService } from '../contabilidad/asientos/asientos.service';
import { D, Dec } from '../contabilidad/consultas/saldos';
import { TxEmpresa } from '../prisma/tenant-prisma.service';
import { SIN_DEPOSITO } from './compras-stock';
import { ConfigStockService } from './config-stock.service';
import { Partida } from './documentos/documentos.service';
import { MotorStock } from './motor';

export const ORIGEN_VENTA = 'VENTA';
export const ORIGEN_COSTO_VENTA = 'COSTO_VENTA';
const cero = new D(0);

interface DatosStockVenta {
  id?: string;
  tipo: 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO';
  depositoId: string | null;
  devuelveMercaderia: boolean;
  comprobanteAsociadoId: string | null;
  renglones: { id?: string; articuloId: string | null; cantidad: Dec | number }[];
}

/** Stock de los comprobantes de venta (spec §5). */
@Injectable()
export class VentasStock {
  constructor(
    private readonly motor: MotorStock,
    private readonly config: ConfigStockService,
    private readonly asientos: AsientosService,
    private readonly conceptos: ConfigComprasService,
  ) {}

  /** ¿Este comprobante mueve stock? */
  private mueve(c: Pick<DatosStockVenta, 'tipo' | 'devuelveMercaderia'>) {
    return c.tipo === 'FACTURA' || (c.tipo === 'NOTA_CREDITO' && c.devuelveMercaderia);
  }

  /** Cantidades por artículo que controla stock. */
  private async porArticulo(tx: TxEmpresa, renglones: DatosStockVenta['renglones']) {
    const ids = [...new Set(renglones.map((r) => r.articuloId).filter((x): x is string => !!x))];
    const arts = ids.length ? await tx.articulo.findMany({ where: { id: { in: ids }, controlaStock: true } }) : [];
    const cant = new Map<string, Dec>();
    for (const r of renglones) if (r.articuloId && arts.some((a) => a.id === r.articuloId)) cant.set(r.articuloId, (cant.get(r.articuloId) ?? cero).plus(r.cantidad));
    return { arts: new Map(arts.map((a) => [a.id, a])), cant };
  }

  /** Vendido menos devuelto por artículo en un comprobante, sin contar la NC `excluir`. */
  private async vendido(tx: TxEmpresa, asociadoId: string, excluir?: string) {
    const ventas = await tx.movimientoStock.findMany({ where: { origenTipo: ORIGEN_VENTA, origenId: asociadoId, tipo: 'VENTA', anulaAId: null } });
    const ncs = await tx.comprobanteVenta.findMany({ where: { comprobanteAsociadoId: asociadoId, tipo: 'NOTA_CREDITO', devuelveMercaderia: true, id: excluir ? { not: excluir } : undefined }, include: { renglones: true } });
    const r = new Map<string, { cantidad: Dec; importe: Dec }>();
    for (const m of ventas) {
      const x = r.get(m.articuloId) ?? { cantidad: cero, importe: cero };
      r.set(m.articuloId, { cantidad: x.cantidad.plus(new D(m.cantidad).neg()), importe: x.importe.plus(new D(m.importe).neg()) });
    }
    const devuelto = new Map<string, Dec>();
    for (const nc of ncs) for (const ren of nc.renglones) if (ren.articuloId) devuelto.set(ren.articuloId, (devuelto.get(ren.articuloId) ?? cero).plus(ren.cantidad));
    return { vendido: r, devuelto };
  }

  /** Control al crear o modificar: devuelve advertencias (con AVISAR) o lanza. */
  async controlar(tx: TxEmpresa, c: DatosStockVenta): Promise<string[]> {
    if (c.devuelveMercaderia && c.tipo !== 'NOTA_CREDITO') throw new BadRequestException('Solo las notas de crédito devuelven mercadería');
    if (!this.mueve(c)) return [];
    const { arts, cant } = await this.porArticulo(tx, c.renglones);
    if (!cant.size) return [];
    if (!c.depositoId) throw new BadRequestException(SIN_DEPOSITO);
    if (c.tipo === 'NOTA_CREDITO') {
      await this.limiteDevolucion(tx, c, arts, cant);
      return [];
    }
    const dep = await tx.deposito.findUnique({ where: { id: c.depositoId } });
    if (!dep) throw new BadRequestException('Depósito inexistente');
    const modo = await this.config.modo(tx);
    const avisos: string[] = [];
    for (const [articuloId, q] of cant) {
      const saldo = new D((await tx.saldoStock.findFirst({ where: { articuloId, depositoId: c.depositoId } }))?.cantidad ?? 0);
      if (saldo.lt(q)) {
        const msj = `Stock insuficiente de ${arts.get(articuloId)!.codigo} en ${dep.nombre}: hay ${saldo.toString()}, se piden ${q.toString()}`;
        if (modo === 'BLOQUEAR') throw new BadRequestException(msj);
        avisos.push(msj);
      }
    }
    return avisos;
  }

  private async limiteDevolucion(tx: TxEmpresa, c: DatosStockVenta, arts: Map<string, { codigo: string }>, cant: Map<string, Dec>) {
    if (!c.comprobanteAsociadoId) return;
    const { vendido, devuelto } = await this.vendido(tx, c.comprobanteAsociadoId, c.id);
    for (const [articuloId, q] of cant) {
      const disponible = (vendido.get(articuloId)?.cantidad ?? cero).minus(devuelto.get(articuloId) ?? cero);
      if (q.gt(disponible)) throw new BadRequestException(`No se puede devolver más de lo vendido de ${arts.get(articuloId)!.codigo}`);
    }
  }

  /** Al emitir: salidas (factura) o devoluciones (NC) y asiento de costo. Devuelve advertencias. */
  async alEmitir(tx: TxEmpresa, c: DatosStockVenta & { id: string }, fecha: Date, descripcion: string): Promise<string[]> {
    if (!this.mueve(c)) return [];
    const { arts, cant } = await this.porArticulo(tx, c.renglones);
    if (!cant.size) return [];
    if (!c.depositoId) throw new BadRequestException(SIN_DEPOSITO);
    const base = { fecha, origenTipo: ORIGEN_VENTA, origenId: c.id };
    const renglones = c.renglones.filter((r) => r.articuloId && cant.has(r.articuloId));
    let res;
    if (c.tipo === 'FACTURA') {
      res = await this.motor.moverVarios(tx, renglones.map((r) => ({ ...base, articuloId: r.articuloId!, depositoId: c.depositoId, cantidad: new D(r.cantidad).neg(), tipo: 'VENTA' as const, origenRenglonId: r.id })));
    } else {
      await this.limiteDevolucion(tx, c, arts, cant);
      const { vendido } = c.comprobanteAsociadoId ? await this.vendido(tx, c.comprobanteAsociadoId, c.id) : { vendido: new Map() };
      res = await this.motor.moverVarios(tx, renglones.map((r) => {
        const v = vendido.get(r.articuloId!) as { cantidad: Dec; importe: Dec } | undefined;
        const costoUnitario = v && v.cantidad.gt(0) ? v.importe.div(v.cantidad).toDecimalPlaces(6) : undefined;
        return { ...base, articuloId: r.articuloId!, depositoId: c.depositoId, cantidad: new D(r.cantidad), costoUnitario, tipo: 'DEVOLUCION_VENTA' as const, origenRenglonId: r.id };
      }));
    }
    const [merc, cmv] = await Promise.all([this.conceptos.cuenta(tx, 'MERCADERIAS'), this.conceptos.cuenta(tx, 'COSTO_MERCADERIAS_VENDIDAS')]);
    const p = new Partida();
    for (const r of res) {
      p.agregar(merc, r.importe.plus(r.regularizacion));
      p.agregar(cmv, r.importe.plus(r.regularizacion).neg());
    }
    const rs = p.renglones();
    if (rs.length) await this.asientos.generar(tx, { fecha, descripcion: `Costo de ventas - ${descripcion}`, origenTipo: ORIGEN_COSTO_VENTA, origenId: c.id, renglones: rs });
    return res.map((r) => r.advertencia).filter((x): x is string => !!x);
  }
}
