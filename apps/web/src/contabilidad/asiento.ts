const centavos = (s: string) => (s.trim() === '' || Number.isNaN(Number(s.replace(',', '.'))) ? 0 : Math.round(Number(s.replace(',', '.')) * 100));

/** Totales de debe y haber de los renglones (en centavos, sin errores de coma flotante). */
export function totalesAsiento(renglones: { debe: string; haber: string }[]): { debe: number; haber: number; diferencia: number } {
  const debe = renglones.reduce((s, r) => s + centavos(r.debe), 0);
  const haber = renglones.reduce((s, r) => s + centavos(r.haber), 0);
  return { debe: debe / 100, haber: haber / 100, diferencia: (debe - haber) / 100 };
}

export const importe = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export const TIPOS_ASIENTO: Record<string, string> = { AUTOMATICO: 'Automático', MANUAL: 'Manual', REFUNDICION: 'Refundición', CIERRE: 'Cierre', APERTURA: 'Apertura' };
export const ORIGENES: { value: string; label: string }[] = [
  { value: 'MANUAL', label: 'Manuales' }, { value: 'COMPRA', label: 'Compras' }, { value: 'PAGO', label: 'Pagos' }, { value: 'INGRESO_VALORES', label: 'Ingresos de valores' },
  { value: 'DEPOSITO', label: 'Depósitos' }, { value: 'MOVIMIENTO_BANCARIO', label: 'Movimientos bancarios' }, { value: 'CIERRE_EJERCICIO', label: 'Cierre de ejercicio' },
];
