import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { bloquear } from '../../compras/comun';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';

export interface RenglonOrigen { origen?: 'DIRECTO' | 'REMITO' | 'PEDIDO'; remitoRenglonId?: string | null; pedidoRenglonId?: string | null; articuloId?: string | null; descripcion: string; cantidad: number | Dec }

/** Renglones de factura que vienen de remitos o de pedidos (spec §5). */
@Injectable()
export class OrigenesVenta {
  constructor(private readonly tenant: TenantPrisma) {}

  /**
   * Valida topes y completa artículo, descripción y vínculos. `excluir`: comprobante cuyos renglones no se cuentan
   * (las cantidades facturadas solo cuentan al autorizar, así que basta con lo registrado).
   */
  async resolver(tx: TxEmpresa, c: { tipo: string; terceroId: string; renglones: RenglonOrigen[] }) {
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
        const pendiente = new D(rr.cantidad).minus(rr.cantidadFacturada);
        const cant = sumas.get(`R:${rr.id}`)!;
        if (cant.gt(pendiente)) throw new BadRequestException(`La cantidad a facturar (${cant.toString()}) supera lo pendiente del remito (${pendiente.toString()})`);
        if (rr.pedidoRenglonId) {
          const pr = pedidosDeRemitos.find((x) => x.id === rr.pedidoRenglonId)!;
          sumas.set(`P:${pr.id}`, (sumas.get(`P:${pr.id}`) ?? new D(0)).plus(r.cantidad));
          const pendP = new D(pr.cantidad).minus(pr.cantidadFacturada);
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
        const pendiente = new D(pr.cantidad).minus(pr.cantidadFacturada);
        const cant = sumas.get(`P:${pr.id}`)!;
        if (cant.gt(pendiente)) throw new BadRequestException(`La cantidad a facturar (${cant.toString()}) supera lo pendiente del pedido (${pendiente.toString()})`);
        return { articuloId: pr.articuloId, descripcion: pr.descripcion, remitoRenglonId: null, pedidoRenglonId: pr.id };
      }
      return { articuloId: r.articuloId ?? null, descripcion: r.descripcion, remitoRenglonId: null, pedidoRenglonId: null };
    });
    return out;
  }

  /** Al autorizar: suma lo facturado a remitos y pedidos. Nunca bloquea (el comprobante ya está autorizado). */
  async registrar(tx: TxEmpresa, renglones: { cantidad: Dec; remitoRenglonId: string | null; pedidoRenglonId: string | null }[]): Promise<string[]> {
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
