/** Formato estándar de comprobante: 0001-00000042 */
export function formatearNumero(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, '0')}-${String(numero).padStart(8, '0')}`;
}
