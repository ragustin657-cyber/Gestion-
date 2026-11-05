export interface RetencionOP {
  id: string; impuesto: 'GANANCIAS' | 'IIBB'; jurisdiccion: string | null; regimen: string | null; base: string; alicuota: string;
  importe: string; detalle: Record<string, string>; certificadoNumero: number | null; anulada: boolean;
}
export interface OrdenPago {
  id: string; numero: number | null; estado: string; version: number; terceroId: string; fecha: string; cotizacion: string; observaciones: string | null;
  totalCancelarPesos: string; totalRetenciones: string; netoPagar: string; fechaPago: string | null; creadoPor: string; aprobadoPor: string | null;
  motivoRechazo: string | null; motivoAnulacion: string | null; asientoId: string | null;
  tercero: { id: string; razonSocial: string; cuit: string };
  imputaciones: { id: string; movimientoId: string; importe: string; importePesos: string; comprobante: string; monedaCodigo: string; fechaVencimiento: string }[];
  anticipo: { monedaCodigo: string; importe: string } | null;
  retenciones: RetencionOP[];
  medios: { id: string; tipo: string; monedaCodigo: string; importe: string; importePesos: string; chequeNumero: string | null; chequeFechaPago: string | null; referencia: string | null }[];
}

export const ESTADOS_OP: Record<string, { etiqueta: string; color: string }> = {
  BORRADOR: { etiqueta: 'Borrador', color: 'gray' },
  PENDIENTE_APROBACION: { etiqueta: 'Pendiente de aprobación', color: 'yellow' },
  APROBADA: { etiqueta: 'Aprobada', color: 'blue' },
  PAGADA: { etiqueta: 'Pagada', color: 'green' },
  ANULADA: { etiqueta: 'Anulada', color: 'red' },
};

export const numeroOP = (n: number | null) => (n ? `0001-${String(n).padStart(8, '0')}` : '—');
const JUR: Record<string, string> = { '901': 'CABA', '902': 'Buenos Aires' };
export const descripcionRetencion = (r: Pick<RetencionOP, 'impuesto' | 'jurisdiccion' | 'regimen'>) =>
  r.impuesto === 'GANANCIAS' ? `Ganancias (régimen ${r.regimen})` : `IIBB ${JUR[r.jurisdiccion ?? ''] ?? r.jurisdiccion}`;
export const numeroCertificado = (r: Pick<RetencionOP, 'impuesto' | 'jurisdiccion' | 'certificadoNumero'>) =>
  r.certificadoNumero ? `${r.impuesto === 'GANANCIAS' ? 'RET-GAN' : `RET-IIBB-${r.jurisdiccion}`} ${String(r.certificadoNumero).padStart(8, '0')}` : '';
