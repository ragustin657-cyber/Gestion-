import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { bloquear } from '../../compras/comun';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';

export interface RenglonOrigen { origen?: 'DIRECTO' | 'REMITO' | 'PEDIDO' | 'DEVOLUCION'; remitoRenglonId?: string | null; pedidoRenglonId?: string | null; devolucionRenglonId?: string | null; articuloId?: string | null; descripcion: string; cantidad: number | Dec }
export interface OrigenResuelto { articuloId: string | null; descripcion: string; remitoRenglonId: string | null; pedidoRenglonId: string | null; devolucionRenglonId?: string | null }
const numeroFactura = (pv: number, n: number | null) => `${String(pv).padStart(4, '0')}-${String(n ?? 0).padStart(8, '0')}`;

/** Renglones de factura que vienen de remitos o de pedidos (spec §5). */
@Injectable()
export class OrigenesVenta {
  constructor(private readonly tenant: TenantPrisma) {}

  /**
   * Valida topes y completa artículo, descripción y vínculos. `excluir`: comprobante cuyos renglones no se cuentan
   * (las cantidades facturadas solo cuentan al autorizar, así que basta con lo registrado).
   */
  async resolver(tx: TxEmpresa, c: { tipo: string; terceroId: string; renglones: RenglonOrigen[]; comprobanteAsociadoId?: string | null; excluirId?: string }): Promise<OrigenResuelto[]> {
    if (c.renglones.some((r) => r.origen === 'DEVOLUCION' || r.devolucionRenglonId)) return this.resolverDevoluciones(tx, c);
    const conOrigen = c.renglones.some((r) => r.origen === 'REMITO' || r.origen === 'PEDIDO' || r.remitoRenglonId || (r.pedidoRenglonId && !r.remitoRenglonId));
    if (!conOrigen) return c.renglones.map((r) => ({ articuloId: r.articuloId ?? null, descripcion: r.descripcion, remitoRenglonId: null, pedidoRenglonId: null }));
    if (c.tipo !== 'FACTURA') throw new BadRequestException('Las notas de crédito y débito solo admiten renglones directos');
    const rrIds = c.renglones.map((r) => (r.origen === 'REMITO' || r.remitoRenglonId ? r.remitoRenglonId : null)).filter((x): x is string => !!x);
    const prIds = c.renglones.map((r) => (r.origen === 'PEDIDO' || (!r.remitoRenglonId && r.pedidoRenglonId) ? r.pedidoRenglonId : null)).filter((x): x is string => !!x);
    const rrs = await tx.remitoRenglon.findMany({ where: { id: { in: rrIds } }, include: { remito: true } });
    const prs = await tx.pedidoVentaRenglon.findMany({ where: { id: { in: prIds } }, include: { pedido: true } });
    const pedidosDeRemitos = await tx.pedidoVentaRenglon.findMany({ where: { id: { in: rrs.map((x) => x.pedidoRenglonId).filter((x): x is string => !!x) } } });
    const conStock = new Set((await tx.articulo.findMany({ where: { id: { in: prs.map((p) => p.articuloId).filter((x): x is string => !!x) }, controlaStock: true } })).map((a) => a.id));
    const sumas = new Map<string, Dec>();
    const out = c.renglones.map((r) => {
      if (r.origen === 'REMITO' || r.remitoRenglonId) {
        const rr = rrs.find((x) => x.id === r.remitoRenglonId);
        if (!rr) throw new NotFoundException('Renglón de remito no encontrado');
        if (rr.remito.terceroId !== c.terceroId) throw new BadRequestException('Todos los renglones deben ser del cliente indicado');
        if (rr.remito.estado !== 'CONFIRMADO') throw new BadRequestException('El remito está anulado');
        sumas.set(`R:${rr.id}`, (sumas.get(`R:${rr.id}`) ?? new D(0)).plus(r.cantidad));
        const pendiente = new D(rr.cantidad).minus(rr.cantidadFacturada).minus(rr.cantidadDevuelta);
        const cant = sumas.get(`R:${rr.id}`)!;
        if (cant.gt(pendiente)) throw new BadRequestException(`La cantidad a facturar (${cant.toString()}) supera lo pendiente del remito (${pendiente.toString()})`);
        if (rr.pedidoRenglonId) {
          const pr = pedidosDeRemitos.find((x) => x.id === rr.pedidoRenglonId)!;
          sumas.set(`P:${pr.id}`, (sumas.get(`P:${pr.id}`) ?? new D(0)).plus(r.cantidad));
          const pendP = new D(pr.cantidad).minus(pr.cantidadFacturada).minus(pr.cantidadDevuelta);
          const cantP = sumas.get(`P:${pr.id}`)!;
          if (cantP.gt(pendP)) throw new BadRequestException(`La cantidad a facturar (${cantP.toString()}) supera lo pendiente del pedido (${pendP.toString()})`);
        }
        return { articuloId: rr.articuloId, descripcion: rr.descripcion, remitoRenglonId: rr.id, pedidoRenglonId: rr.pedidoRenglonId };
      }
      if (r.origen === 'PEDIDO' || r.pedidoRenglonId) {
        const pr = prs.find((x) => x.id === r.pedidoRenglonId);
        if (!pr) throw new NotFoundException('Renglón de pedido no encontrado');
        if (pr.pedido.terceroId !== c.terceroId) throw new BadRequestException('Todos los renglones deben ser del cliente indicado');
        if (!['CONFIRMADO', 'PARCIALMENTE_ENTREGADO', 'ENTREGADO'].includes(pr.pedido.estado)) throw new BadRequestException('El pedido no está confirmado');
        if (pr.articuloId && conStock.has(pr.articuloId)) throw new BadRequestException('Los artículos que controlan stock se facturan desde un remito o como venta directa');
        sumas.set(`P:${pr.id}`, (sumas.get(`P:${pr.id}`) ?? new D(0)).plus(r.cantidad));
        const pendiente = new D(pr.cantidad).minus(pr.cantidadFacturada).minus(pr.cantidadDevuelta);
        const cant = sumas.get(`P:${pr.id}`)!;
        if (cant.gt(pendiente)) throw new BadRequestException(`La cantidad a facturar (${cant.toString()}) supera lo pendiente del pedido (${pendiente.toString()})`);
        return { articuloId: pr.articuloId, descripcion: pr.descripcion, remitoRenglonId: null, pedidoRenglonId: pr.id };
      }
      return { articuloId: r.articuloId ?? null, descripcion: r.descripcion, remitoRenglonId: null, pedidoRenglonId: null };
    });
    return out;
  }

  /**
   * E54: renglones de nota de crédito desde remitos de devolución (spec §4): pendiente a acreditar, la factura asociada facturó
   * el renglón de origen, y lo acreditado contra esa factura no supera lo que facturó de ese renglón.
   */
  private async resolverDevoluciones(tx: TxEmpresa, c: { tipo: string; terceroId: string; renglones: RenglonOrigen[]; comprobanteAsociadoId?: string | null; excluirId?: string }): Promise<OrigenResuelto[]> {
    if (c.tipo !== 'NOTA_CREDITO') throw new BadRequestException('Las devoluciones se acreditan con una nota de crédito');
    if (c.renglones.some((r) => !(r.origen === 'DEVOLUCION' || r.devolucionRenglonId) && (r.remitoRenglonId || r.pedidoRenglonId || r.origen === 'REMITO' || r.origen === 'PEDIDO')))
      throw new BadRequestException('Las notas de crédito y débito solo admiten renglones directos');
    const ids = [...new Set(c.renglones.map((r) => r.devolucionRenglonId).filter((x): x is string => !!x))];
    await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, ids);
    const devs = await tx.remitoRenglon.findMany({ where: { id: { in: ids } }, include: { remito: true } });
    const factura = c.comprobanteAsociadoId ? await tx.comprobanteVenta.findUnique({ where: { id: c.comprobanteAsociadoId } }) : null;
    const sumas = new Map<string, Dec>();
    const porOrigen = new Map<string, Dec>();
    return Promise.all(c.renglones.map(async (r) => {
      if (!(r.origen === 'DEVOLUCION' || r.devolucionRenglonId)) return { articuloId: r.articuloId ?? null, descripcion: r.descripcion, remitoRenglonId: null, pedidoRenglonId: null, devolucionRenglonId: null };
      const dr = devs.find((x) => x.id === r.devolucionRenglonId);
      if (!dr || dr.remito.tipo !== 'DEVOLUCION') throw new NotFoundException('Renglón de devolución no encontrado');
      if (dr.remito.terceroId !== c.terceroId) throw new BadRequestException('Todos los renglones deben ser del cliente indicado');
      if (dr.remito.estado !== 'CONFIRMADO') throw new BadRequestException('La devolución está anulada');
      const cant = (sumas.get(dr.id) ?? new D(0)).plus(r.cantidad);
      sumas.set(dr.id, cant);
      const pendiente = new D(dr.cantidadAAcreditar).minus(dr.cantidadAcreditada);
      if (cant.gt(pendiente)) throw new BadRequestException(`La cantidad a acreditar (${cant.toString()}) supera lo pendiente de la devolución (${pendiente.toString()})`);
      if (!factura || !dr.remitoRenglonOrigenId) throw new BadRequestException('La devolución no corresponde a la factura asociada');
      const facturado = (await tx.comprobanteVentaRenglon.aggregate({ where: { comprobanteId: factura.id, remitoRenglonId: dr.remitoRenglonOrigenId }, _sum: { cantidad: true } }))._sum.cantidad;
      if (!facturado || new D(facturado).isZero()) throw new BadRequestException('La devolución no corresponde a la factura asociada');
      // Lo ya acreditado contra esta factura por devoluciones del mismo renglón de origen
      const delOrigen = (await tx.remitoRenglon.findMany({ where: { remitoRenglonOrigenId: dr.remitoRenglonOrigenId }, select: { id: true } })).map((x) => x.id);
      const previo = (await tx.comprobanteVentaRenglon.aggregate({
        where: { devolucionRenglonId: { in: delOrigen }, comprobante: { comprobanteAsociadoId: factura.id, tipo: 'NOTA_CREDITO', OR: [{ estado: 'AUTORIZADO' }, { numeroReservado: { not: null } }], ...(c.excluirId ? { id: { not: c.excluirId } } : {}) } },
        _sum: { cantidad: true },
      }))._sum.cantidad ?? new D(0);
      const enEsta = (porOrigen.get(dr.remitoRenglonOrigenId) ?? new D(0)).plus(r.cantidad);
      porOrigen.set(dr.remitoRenglonOrigenId, enEsta);
      if (enEsta.plus(previo).gt(facturado)) throw new BadRequestException(`La factura ${factura.letra} ${numeroFactura(factura.puntoVenta, factura.numero)} facturó ${new D(facturado).toString()} de ${dr.descripcion}`);
      return { articuloId: dr.articuloId, descripcion: dr.descripcion, remitoRenglonId: null, pedidoRenglonId: null, devolucionRenglonId: dr.id };
    }));
  }

  /** Al autorizar: suma lo facturado a remitos y pedidos. Nunca bloquea (el comprobante ya está autorizado). */
  async registrar(tx: TxEmpresa, renglones: { cantidad: Dec; remitoRenglonId: string | null; pedidoRenglonId: string | null; devolucionRenglonId?: string | null }[]): Promise<string[]> {
    // E54: lo acreditado de los remitos de devolución
    const dr = renglones.filter((r) => r.devolucionRenglonId);
    if (dr.length) {
      await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, dr.map((r) => r.devolucionRenglonId!));
      for (const r of dr) await tx.remitoRenglon.update({ where: { id: r.devolucionRenglonId! }, data: { cantidadAcreditada: { increment: r.cantidad } } });
    }
    const rr = renglones.filter((r) => r.remitoRenglonId);
    const pr = renglones.filter((r) => r.pedidoRenglonId);
    if (!rr.length && !pr.length) return [];
    // Orden de bloqueo: renglones de remito, luego de pedido (igual que la anulación de remitos)
    await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, rr.map((r) => r.remitoRenglonId!));
    await bloquear(tx, 'PedidoVentaRenglon', this.tenant.empresaId, pr.map((r) => r.pedidoRenglonId!));
    const avisos: string[] = [];
    for (const r of rr) {
      const x = await tx.remitoRenglon.update({ where: { id: r.remitoRenglonId! }, data: { cantidadFacturada: { increment: r.cantidad } } });
      if (new D(x.cantidadFacturada).gt(x.cantidad)) avisos.push(`Se facturó más de lo entregado en el remito (${x.descripcion})`);
    }
    for (const r of pr) await tx.pedidoVentaRenglon.update({ where: { id: r.pedidoRenglonId! }, data: { cantidadFacturada: { increment: r.cantidad } } });
    return avisos;
  }
}
