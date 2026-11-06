export interface Linea {
  id: string; fecha: string; concepto: string; referencia: string | null; importe: string; estado: 'PENDIENTE' | 'CONCILIADA' | 'IGNORADA'; motivoIgnorada?: string | null;
  reglaSugerida?: { id: string; cuentaContableId: string; cuenta: string; concepto: string } | null;
}
export interface Movimiento { id: string; fecha: string; tipo: string; origenTipo: string; descripcion: string; referencia: string | null; importe: string }
export interface Resumen { saldoSistema: string; pendientesSistema: string; pendientesExtracto: string; diferencia: string; lineasPendientes: number; advertencia: string | null }
export interface Conciliacion {
  id: string; cuentaBancariaId: string; desde: string; hasta: string; saldoInicial: string; saldoFinal: string; estado: 'ABIERTA' | 'CERRADA'; version: number;
  cerradaEn?: string | null; motivoReapertura?: string | null;
}
export interface DetalleConciliacion extends Conciliacion {
  resumen: Resumen; lineas: Linea[]; movimientos: Movimiento[]; primera?: boolean;
  vinculos: { id: string; tipo: string; lineas: Linea[]; movimientos: Movimiento[] }[];
}
export interface Sugerencia { lineas: string[]; movimientos: string[]; nivel: 'EXACTA' | 'PROBABLE' | 'AGRUPADA'; preseleccionada: boolean }
