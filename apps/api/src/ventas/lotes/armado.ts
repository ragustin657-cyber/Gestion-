import { letraVenta } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cotizacion, D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import type { PreciosService } from '../precios/precios.service';
import { bonificacionPorCantidad } from '../precios/escalas';
import { numeroRemito } from '../remitos/remitos.service';

/** E55: renglón de remito pendiente de facturar, con el precio que llevará la factura del lote. */
export interface RenglonLote {
  remitoRenglonId: string;
  pedidoRenglonId: string | null;
  numero: string;
  articuloId: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string | null;
  bonificacionPct: string;
  alicuota: string;
  importe: string | null;
}

/** E55: una factura del lote: un cliente en una moneda. */
export interface GrupoLote {
  terceroId: string;
  razonSocial: string;
  cuit: string;
  letra: string;
  monedaCodigo: 'ARS' | 'USD';
  cotizacion: string | null;
  remitos: string[];
  renglones: RenglonLote[];
  total: string;
  problemas: string[];
  avisos: string[];
}

const etiquetaComprobante = (c: { letra: string; puntoVenta: number; numero: number | null }) =>
  c.numero === null ? 'borrador' : `${c.letra} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;

/**
 * Remitos de entrega confirmados hasta `hasta` con pendiente de facturar (cantidad − facturada − devuelta), agrupados por
 * cliente y moneda (la del pedido; sin pedido, ARS), con el precio del pedido o el sugerido de la lista del cliente (spec §1-§3).
 */
export async function armarLote(tx: TxEmpresa, precios: PreciosService, f: { empresaId: string; hasta: Date; fecha: Date; terceroIds?: string[] }): Promise<GrupoLote[]> {
  const rs = await tx.remitoRenglon.findMany({
    where: { remito: { tipo: 'ENTREGA', estado: 'CONFIRMADO', fecha: { lte: f.hasta }, ...(f.terceroIds?.length ? { terceroId: { in: f.terceroIds } } : {}) } },
    include: { remito: true },
    orderBy: [{ remito: { numero: 'asc' } }, { orden: 'asc' }],
  });
  const pendientes = rs.filter((r) => new D(r.cantidad).minus(r.cantidadFacturada).minus(r.cantidadDevuelta).gt(0));
  if (!pendientes.length) return [];
  // Renglones que ya están en un comprobante sin autorizar: afuera, con aviso
  const enCurso = await tx.comprobanteVentaRenglon.findMany({
    where: { remitoRenglonId: { in: pendientes.map((r) => r.id) }, comprobante: { estado: { not: 'AUTORIZADO' } } },
    include: { comprobante: { select: { letra: true, puntoVenta: true, numero: true } } },
  });
  const pedidoRs = new Map((await tx.pedidoVentaRenglon.findMany({ where: { id: { in: pendientes.map((r) => r.pedidoRenglonId).filter((x): x is string => !!x) } }, include: { pedido: true } })).map((p) => [p.id, p]));
  const arts = new Map((await tx.articulo.findMany({ where: { id: { in: pendientes.map((r) => r.articuloId).filter((x): x is string => !!x) } } })).map((a) => [a.id, a]));
  const terceros = new Map((await tx.tercero.findMany({ where: { id: { in: [...new Set(pendientes.map((r) => r.remito.terceroId))] } } })).map((t) => [t.id, t]));
  const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: f.empresaId } });
  let cotUsd: Dec | null | undefined;
  const usd = async () => {
    if (cotUsd === undefined) cotUsd = await cotizacion(tx, 'USD', f.fecha).catch(() => null);
    return cotUsd;
  };

  const grupos = new Map<string, GrupoLote & { _total: Dec }>();
  const grupo = (terceroId: string, monedaCodigo: 'ARS' | 'USD') => {
    const clave = `${terceroId}|${monedaCodigo}`;
    let g = grupos.get(clave);
    if (!g) {
      const t = terceros.get(terceroId)!;
      g = { terceroId, razonSocial: t.razonSocial, cuit: t.cuit, letra: letraVenta(empresa.condicionIva, t.condicionIva), monedaCodigo, cotizacion: null, remitos: [], renglones: [], total: '0', problemas: [], avisos: [], _total: new D(0) };
      grupos.set(clave, g);
    }
    return g;
  };

  for (const r of pendientes) {
    const pr = r.pedidoRenglonId ? pedidoRs.get(r.pedidoRenglonId) : undefined;
    const moneda = (pr?.pedido.monedaCodigo === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD';
    const g = grupo(r.remito.terceroId, moneda);
    const numero = numeroRemito(r.remito.puntoVenta, r.remito.numero);
    const ocupado = enCurso.find((c) => c.remitoRenglonId === r.id);
    if (ocupado) {
      const aviso = `Ya está en la factura ${etiquetaComprobante(ocupado.comprobante)} sin autorizar`;
      if (!g.avisos.includes(aviso)) g.avisos.push(aviso);
      continue;
    }
    const cantidad = new D(r.cantidad).minus(r.cantidadFacturada).minus(r.cantidadDevuelta);
    let precio: Dec | null = null;
    let bonificacion = new D(0);
    let alicuota: string;
    let sinCotizacion = false;
    const art = r.articuloId ? arts.get(r.articuloId) : undefined;
    if (pr) {
      precio = new D(pr.precioUnitario);
      bonificacion = new D(pr.bonificacionPct);
      alicuota = String(pr.alicuota);
    } else {
      alicuota = art ? String(Number(art.alicuotaIva)) : '21';
      if (art) {
        // E59: una lista en otra moneda se convierte con la cotización de la fecha de emisión
        const t = terceros.get(r.remito.terceroId);
        const lista = (t?.listaPreciosId ? await tx.listaPrecios.findFirst({ where: { id: t.listaPreciosId, activa: true } }) : null) ?? await tx.listaPrecios.findFirst({ where: { porDefecto: true, activa: true } });
        const cot = lista && lista.monedaCodigo !== moneda ? await usd() : null;
        if (lista && lista.monedaCodigo !== moneda && !cot) {
          if (!g.problemas.includes('No hay cotización de USD para la fecha')) g.problemas.push('No hay cotización de USD para la fecha');
          sinCotizacion = true;
        } else {
          const s = await precios.sugerido(tx, { terceroId: r.remito.terceroId, articuloId: art.id, monedaCodigo: moneda, cotizacion: cot ? Number(cot) : null }).catch(() => ({ precio: null }));
          if (s.precio !== null) precio = new D(s.precio);
        }
        // E56: descuento por cantidad de la escala del artículo o su rubro
        const b = await bonificacionPorCantidad(tx, art.id, cantidad);
        if (b.bonificacionPct) bonificacion = new D(b.bonificacionPct);
      }
    }
    if (!sinCotizacion && (precio === null || precio.lte(0))) g.problemas.push(`Sin precio: ${r.descripcion} (remito ${numero})`);
    const importe = precio ? cantidad.times(precio).times(new D(1).minus(bonificacion.div(100))).toDecimalPlaces(2) : null;
    if (importe) g._total = g._total.plus(importe);
    if (!g.remitos.includes(numero)) g.remitos.push(numero);
    g.renglones.push({
      remitoRenglonId: r.id, pedidoRenglonId: r.pedidoRenglonId, numero, articuloId: r.articuloId, descripcion: r.descripcion, cantidad: cantidad.toString(),
      precioUnitario: precio ? precio.toString() : null, bonificacionPct: bonificacion.toString(), alicuota, importe: importe ? importe.toFixed(2) : null,
    });
  }

  const salida: GrupoLote[] = [];
  for (const { _total, ...g } of grupos.values()) {
    if (!g.renglones.length && !g.avisos.length) continue;
    // E58: la exportación (letra E) lleva datos propios: se factura de a una
    if (terceros.get(g.terceroId)?.residenteExterior) g.problemas.unshift('El cliente es del exterior: facture la exportación de a una');
    if (g.monedaCodigo === 'USD' && g.renglones.length) {
      const c = await usd();
      if (c) g.cotizacion = c.toString();
      else g.problemas.push('No hay cotización de USD para la fecha');
    }
    salida.push({ ...g, total: _total.toFixed(2) });
  }
  return salida.sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es') || a.monedaCodigo.localeCompare(b.monedaCodigo));
}
