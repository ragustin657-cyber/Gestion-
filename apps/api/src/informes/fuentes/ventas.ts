import { Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export interface RenglonVendido {
  fecha: Date; mes: string; terceroId: string; cliente: string; articuloId: string | null; codigo: string | null; descripcion: string;
  /** Neto en pesos (NC en negativo). */
  ventas: Dec;
  /** Costo en pesos (NC con devolución en negativo); null = sin costo. */
  costo: Dec | null;
}

/** Renglones de comprobantes de venta autorizados del período, con su costo de stock (spec §2). */
export async function renglonesVendidos(tx: TxEmpresa, desde: Date, hasta: Date): Promise<RenglonVendido[]> {
  const comps = await tx.comprobanteVenta.findMany({
    where: { estado: 'AUTORIZADO', fecha: { gte: desde, lte: hasta } },
    select: { id: true, tipo: true, fecha: true, cotizacion: true, terceroId: true, tercero: { select: { razonSocial: true } }, renglones: { select: { id: true, articuloId: true, descripcion: true, cantidad: true, neto: true, remitoRenglonId: true } } },
  });
  const renglones = comps.flatMap((c) => c.renglones);
  // Costo de facturas directas y devoluciones: movimientos de stock del renglón
  const movs = renglones.length ? await tx.movimientoStock.groupBy({
    by: ['origenRenglonId'], where: { origenTipo: 'VENTA', tipo: { in: ['VENTA', 'DEVOLUCION_VENTA'] }, origenRenglonId: { in: renglones.map((r) => r.id) } }, _sum: { importe: true },
  }) : [];
  const costoDirecto = new Map(movs.map((m) => [m.origenRenglonId!, new D(m._sum.importe ?? 0).neg()]));
  // Costo de renglones de remito: cantidad facturada × costo unitario de la salida del remito
  const rrIds = renglones.map((r) => r.remitoRenglonId).filter((x): x is string => !!x);
  const salidasRemito = rrIds.length ? await tx.movimientoStock.findMany({ where: { origenTipo: 'REMITO', tipo: 'VENTA', anulaAId: null, origenRenglonId: { in: rrIds } }, select: { origenRenglonId: true, costoUnitario: true } }) : [];
  const costoUnitRemito = new Map(salidasRemito.map((m) => [m.origenRenglonId!, new D(m.costoUnitario)]));
  const arts = new Map((await tx.articulo.findMany({ where: { id: { in: [...new Set(renglones.map((r) => r.articuloId).filter((x): x is string => !!x))] } }, select: { id: true, codigo: true } })).map((a) => [a.id, a.codigo]));
  const r: RenglonVendido[] = [];
  for (const c of comps) {
    const signo = c.tipo === 'NOTA_CREDITO' ? -1 : 1;
    for (const ren of c.renglones) {
      const ventas = new D(ren.neto).times(c.cotizacion).toDecimalPlaces(2).times(signo);
      let costo: Dec | null = null;
      if (ren.remitoRenglonId && costoUnitRemito.has(ren.remitoRenglonId)) costo = new D(ren.cantidad).times(costoUnitRemito.get(ren.remitoRenglonId)!).toDecimalPlaces(2).times(signo);
      else if (costoDirecto.has(ren.id)) costo = costoDirecto.get(ren.id)!;
      r.push({
        fecha: c.fecha, mes: c.fecha.toISOString().slice(0, 7), terceroId: c.terceroId, cliente: c.tercero.razonSocial,
        articuloId: ren.articuloId, codigo: ren.articuloId ? (arts.get(ren.articuloId) ?? null) : null, descripcion: ren.descripcion, ventas, costo,
      });
    }
  }
  return r;
}
