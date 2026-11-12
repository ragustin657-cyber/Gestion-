import { api } from '../api/cliente';

export type Redondeo = '0.01' | '1' | '10' | '100';
export const REDONDEOS: { value: Redondeo; label: string }[] = [
  { value: '0.01', label: 'Centavos' }, { value: '1', label: 'A $ 1' }, { value: '10', label: 'A $ 10' }, { value: '100', label: 'A $ 100' },
];

/** Misma regla que el servidor: al múltiplo más cercano (mitad hacia arriba), nunca menos que un múltiplo. */
export function aumentar(precio: number, porcentaje: number, redondeo: Redondeo): string {
  const paso = Number(redondeo);
  const n = Math.max(Math.round(precio * (1 + porcentaje / 100) / paso + 1e-9), 1);
  return String(Number((n * paso).toFixed(2)));
}

/** Primeros cinco precios antes y después del aumento. */
export function vistaPreviaAumento(precios: { codigo: string; precio: string }[], porcentaje: number, redondeo: Redondeo) {
  return precios.slice(0, 5).map((p) => ({ codigo: p.codigo, antes: String(Number(p.precio)), despues: aumentar(Number(p.precio), porcentaje, redondeo) }));
}

/** Precio sugerido por la lista del cliente, en la moneda del comprobante (null si no hay). */
export async function precioSugerido(q: { terceroId: string | null; articuloId: string; monedaCodigo: string; cotizacion?: string }): Promise<string | null> {
  if (!q.terceroId) return null;
  try {
    const r = await api<{ precio: string | null }>('/ventas/precio', { query: { terceroId: q.terceroId, articuloId: q.articuloId, monedaCodigo: q.monedaCodigo, cotizacion: q.cotizacion || undefined } });
    return r.precio;
  } catch {
    return null;
  }
}

/** Precio de un pedido en la moneda de la factura: con la cotización de la factura, o la del pedido si no hay. */
export function convertirPrecio(precio: string, de: string, a: string, cotizacionFactura: string, cotizacionPedido: string): string {
  const p = Number(precio);
  if (de === a) return String(p);
  const cot = Number(String(cotizacionFactura).replace(',', '.')) || Number(cotizacionPedido) || 1;
  const r = de === 'USD' ? p * cot : p / cot;
  return String(Number(r.toFixed(2)));
}

/** Cuerpo del aumento: toda la lista o solo los artículos que muestra el filtro. */
export function cuerpoAumento(porcentaje: number, redondeo: Redondeo, alcance: 'todos' | 'filtrados', filtrados: string[]) {
  return alcance === 'filtrados' ? { porcentaje, redondeo, articuloIds: filtrados } : { porcentaje, redondeo };
}
