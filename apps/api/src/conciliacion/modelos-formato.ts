import type { FormatoParseo } from './interprete';

/**
 * Modelos de formato por banco. Son una estimación del archivo que entrega cada homebanking:
 * hay que verificarlos con un extracto real y ajustarlos.
 */
export const MODELOS_FORMATO: Record<string, FormatoParseo & { nombre: string }> = {
  NACION: {
    nombre: 'Banco de la Nación Argentina', tipoArchivo: 'CSV', separador: ';', hoja: null, filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
    columnaFecha: '1', columnaReferencia: '2', columnaConcepto: '3', modoImporte: 'IMPORTE_CON_SIGNO', columnaImporte: '4', columnaDebito: null, columnaCredito: null, columnaSaldo: '5',
  },
  GALICIA: {
    nombre: 'Banco Galicia', tipoArchivo: 'CSV', separador: ';', hoja: null, filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
    columnaFecha: '1', columnaConcepto: '2', columnaReferencia: '3', modoImporte: 'DEBITO_CREDITO', columnaImporte: null, columnaDebito: '4', columnaCredito: '5', columnaSaldo: '6',
  },
  SANTANDER: {
    nombre: 'Banco Santander', tipoArchivo: 'XLSX', separador: null, hoja: '1', filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
    columnaFecha: 'A', columnaReferencia: 'B', columnaConcepto: 'C', modoImporte: 'IMPORTE_CON_SIGNO', columnaImporte: 'D', columnaDebito: null, columnaCredito: null, columnaSaldo: 'E',
  },
  MACRO: {
    nombre: 'Banco Macro', tipoArchivo: 'CSV', separador: ';', hoja: null, filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
    columnaFecha: '1', columnaConcepto: '2', columnaReferencia: '3', modoImporte: 'DEBITO_CREDITO', columnaImporte: null, columnaDebito: '4', columnaCredito: '5', columnaSaldo: '6',
  },
  BBVA: {
    nombre: 'BBVA', tipoArchivo: 'XLSX', separador: null, hoja: '1', filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
    columnaFecha: 'A', columnaConcepto: 'B', columnaReferencia: null, modoImporte: 'IMPORTE_CON_SIGNO', columnaImporte: 'C', columnaDebito: null, columnaCredito: null, columnaSaldo: 'D',
  },
  GENERICO: {
    nombre: 'Genérico (fecha; concepto; referencia; importe)', tipoArchivo: 'CSV', separador: ';', hoja: null, filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
    columnaFecha: '1', columnaConcepto: '2', columnaReferencia: '3', modoImporte: 'IMPORTE_CON_SIGNO', columnaImporte: '4', columnaDebito: null, columnaCredito: null, columnaSaldo: null,
  },
};
