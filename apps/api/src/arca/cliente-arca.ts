/** Interfaz con el web service de factura electrónica de ARCA (WSFEv1). La implementación depende del ambiente. */
export interface ClienteArca {
  ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number>;
  consultar(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteArca | null>;
  solicitarCae(d: DatosCae): Promise<ResultadoCae>;
  probar(): Promise<{ ok: boolean; detalle: string }>;
}

export interface DatosCae {
  ptoVta: number;
  cbteTipo: number;
  numero: number;
  concepto: 1 | 2 | 3;
  docTipo: number;
  docNro: string;
  condicionIvaReceptor: number;
  /** YYYYMMDD */
  fecha: string;
  impTotal: string;
  impTotConc: string;
  impNeto: string;
  impOpEx: string;
  impIva: string;
  monId: 'PES' | 'DOL';
  monCotiz: string;
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  iva: { id: number; baseImp: string; importe: string }[];
  asociados: { tipo: number; ptoVta: number; nro: number; cuit: string; fecha: string }[];
}

/** Cada texto de errores y observaciones tiene la forma "(código) mensaje". Las fechas son YYYY-MM-DD. */
export type ResultadoCae =
  | { resultado: 'A'; cae: string; caeVencimiento: string; observaciones: string[] }
  | { resultado: 'R'; errores: string[] };

export interface ComprobanteArca {
  numero: number;
  docNro: string;
  /** YYYY-MM-DD */
  fecha: string;
  impTotal: string;
  monId: string;
  cae: string;
  caeVencimiento: string;
}

/** ARCA no respondió, respondió algo ilegible o rechazó el acceso: el comprobante queda pendiente y se puede reintentar. */
export class ErrorConexionArca extends Error {
  readonly tokenInvalido: boolean;
  constructor(mensaje: string, o: { tokenInvalido?: boolean } = {}) {
    super(mensaje);
    this.name = 'ErrorConexionArca';
    this.tokenInvalido = o.tokenInvalido ?? false;
  }
}
