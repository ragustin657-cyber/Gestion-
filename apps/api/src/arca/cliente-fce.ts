/** Registro de Facturas de Crédito Electrónica MiPyME (web service `wsfecred`, E50). Diseño a verificar con ARCA. */
export interface ObligacionFce { obligado: boolean; montoMinimo: string | null }
export type EstadoFce = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'ACEPTADA_TACITA';
export interface FceArca {
  cuitEmisor: string;
  cuitReceptor: string;
  cbteTipo: number;
  ptoVta: number;
  numero: number;
  /** YYYY-MM-DD */
  fecha: string;
  importe: string;
  moneda: string;
  fechaVencimientoPago: string | null;
  estado: EstadoFce;
  fechaRecepcion: string | null;
  fechaLimite: string | null;
  motivosRechazo: string[];
}
export type ClaveFce = Pick<FceArca, 'cuitEmisor' | 'cbteTipo' | 'ptoVta' | 'numero'>;

export interface ClienteFce {
  /** Fecha YYYYMMDD. */
  consultarObligacion(cuit: string, fecha: string): Promise<ObligacionFce>;
  /** Fechas YYYYMMDD. */
  consultarComprobantes(rol: 'EMISOR' | 'RECEPTOR', desde: string, hasta: string): Promise<FceArca[]>;
  aceptar(f: ClaveFce & { importe: string }): Promise<void>;
  rechazar(f: ClaveFce, motivos: string[], texto: string): Promise<void>;
  motivosRechazo(): Promise<{ codigo: string; descripcion: string }[]>;
}
