import type { Campo } from './campos';

/* Diseños copiados de docs/superpowers/specs/referencias/entrega-7/. */

const imp = (nombre: string, largo = 15): Campo => ({ nombre, largo, tipo: 'IMPORTE', separador: '' });

/** Libro IVA Digital — Ventas cabecera (266). */
export const LIVA_VENTAS_CBTE: Campo[] = [
  { nombre: 'fecha', largo: 8, tipo: 'FECHA', formato: 'AAAAMMDD' },
  { nombre: 'tipoComprobante', largo: 3, tipo: 'NUM' },
  { nombre: 'puntoVenta', largo: 5, tipo: 'NUM' },
  { nombre: 'numero', largo: 20, tipo: 'NUM' },
  { nombre: 'numeroHasta', largo: 20, tipo: 'NUM' },
  { nombre: 'codigoDocumento', largo: 2, tipo: 'NUM' },
  { nombre: 'numeroDocumento', largo: 20, tipo: 'NUM' },
  { nombre: 'denominacion', largo: 30, tipo: 'TXT' },
  imp('importeTotal'), imp('noGravado'), imp('percepcionNoCategorizados'), imp('exento'), imp('percepcionesNacionales'),
  imp('percepcionesIibb'), imp('percepcionesMunicipales'), imp('impuestosInternos'),
  { nombre: 'moneda', largo: 3, tipo: 'TXT' },
  { nombre: 'tipoCambio', largo: 10, tipo: 'IMPORTE', decimales: 6, separador: '' },
  { nombre: 'cantidadAlicuotas', largo: 1, tipo: 'NUM' },
  { nombre: 'codigoOperacion', largo: 1, tipo: 'TXT' },
  imp('otrosTributos'),
  { nombre: 'fechaVencimientoPago', largo: 8, tipo: 'FECHA', formato: 'AAAAMMDD' },
];

/** Libro IVA Digital — Ventas alícuotas (62). */
export const LIVA_VENTAS_ALICUOTAS: Campo[] = [
  { nombre: 'tipoComprobante', largo: 3, tipo: 'NUM' },
  { nombre: 'puntoVenta', largo: 5, tipo: 'NUM' },
  { nombre: 'numero', largo: 20, tipo: 'NUM' },
  imp('netoGravado'),
  { nombre: 'alicuota', largo: 4, tipo: 'NUM' },
  imp('impuesto'),
];

/** Libro IVA Digital — Compras cabecera (325). */
export const LIVA_COMPRAS_CBTE: Campo[] = [
  { nombre: 'fecha', largo: 8, tipo: 'FECHA', formato: 'AAAAMMDD' },
  { nombre: 'tipoComprobante', largo: 3, tipo: 'NUM' },
  { nombre: 'puntoVenta', largo: 5, tipo: 'NUM' },
  { nombre: 'numero', largo: 20, tipo: 'NUM' },
  { nombre: 'despacho', largo: 16, tipo: 'TXT' },
  { nombre: 'codigoDocumento', largo: 2, tipo: 'NUM' },
  { nombre: 'numeroDocumento', largo: 20, tipo: 'NUM' },
  { nombre: 'denominacion', largo: 30, tipo: 'TXT' },
  imp('importeTotal'), imp('noGravado'), imp('exento'), imp('percepcionesIva'), imp('percepcionesNacionales'),
  imp('percepcionesIibb'), imp('percepcionesMunicipales'), imp('impuestosInternos'),
  { nombre: 'moneda', largo: 3, tipo: 'TXT' },
  { nombre: 'tipoCambio', largo: 10, tipo: 'IMPORTE', decimales: 6, separador: '' },
  { nombre: 'cantidadAlicuotas', largo: 1, tipo: 'NUM' },
  { nombre: 'codigoOperacion', largo: 1, tipo: 'TXT' },
  imp('creditoFiscalComputable'), imp('otrosTributos'),
  { nombre: 'cuitCorredor', largo: 11, tipo: 'NUM' },
  { nombre: 'denominacionCorredor', largo: 30, tipo: 'TXT' },
  imp('ivaComision'),
];

/** Libro IVA Digital — Compras alícuotas (84). */
/** Libro IVA Digital — Compras importaciones (50, E41): alícuotas de los despachos, por número de despacho (diseño a verificar). */
export const LIVA_COMPRAS_IMPORTACIONES: Campo[] = [
  { nombre: 'despacho', largo: 16, tipo: 'TXT' },
  imp('netoGravado'),
  { nombre: 'alicuota', largo: 4, tipo: 'NUM' },
  imp('impuesto'),
];

export const LIVA_COMPRAS_ALICUOTAS: Campo[] = [
  { nombre: 'tipoComprobante', largo: 3, tipo: 'NUM' },
  { nombre: 'puntoVenta', largo: 5, tipo: 'NUM' },
  { nombre: 'numero', largo: 20, tipo: 'NUM' },
  { nombre: 'codigoDocumento', largo: 2, tipo: 'NUM' },
  { nombre: 'numeroDocumento', largo: 20, tipo: 'NUM' },
  imp('netoGravado'),
  { nombre: 'alicuota', largo: 4, tipo: 'NUM' },
  imp('impuesto'),
];

/** SICORE — formato estándar de importación de retenciones (145). Pos. 45-145 según el estándar de mercado: verificar en el aplicativo. */
export const SICORE: Campo[] = [
  { nombre: 'codigoComprobante', largo: 2, tipo: 'NUM' },
  { nombre: 'fechaComprobante', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'numeroComprobante', largo: 16, tipo: 'NUM' },
  { nombre: 'importeComprobante', largo: 16, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'codigoImpuesto', largo: 4, tipo: 'NUM' },
  { nombre: 'codigoRegimen', largo: 3, tipo: 'NUM' },
  { nombre: 'codigoOperacion', largo: 1, tipo: 'NUM' },
  { nombre: 'baseCalculo', largo: 14, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'fechaRetencion', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'codigoCondicion', largo: 2, tipo: 'NUM' },
  { nombre: 'suspendidos', largo: 1, tipo: 'NUM' },
  { nombre: 'importeRetencion', largo: 14, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'porcentajeExclusion', largo: 6, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'fechaBoletin', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'tipoDocumento', largo: 2, tipo: 'NUM' },
  { nombre: 'numeroDocumento', largo: 20, tipo: 'TXT' },
  { nombre: 'certificadoOriginal', largo: 14, tipo: 'NUM' },
];

/** ARBA A-122R — alta de retenciones (67). */
export const ARBA_ALTA: Campo[] = [
  { nombre: 'numeroTransaccion', largo: 20, tipo: 'NUM' },
  { nombre: 'cuit', largo: 11, tipo: 'NUM' },
  { nombre: 'sucursal', largo: 5, tipo: 'NUM' },
  { nombre: 'fecha', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'alicuota', largo: 5, tipo: 'IMPORTE', separador: '.' },
  { nombre: 'base', largo: 16, tipo: 'IMPORTE', separador: '.' },
];

/** ARBA — percepciones practicadas (61, E39; diseño a verificar con el instructivo de ARBA). */
export const ARBA_PERCEPCION: Campo[] = [
  { nombre: 'cuit', largo: 13, tipo: 'TXT' },
  { nombre: 'fecha', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'tipoComprobante', largo: 1, tipo: 'TXT' },
  { nombre: 'letra', largo: 1, tipo: 'TXT' },
  { nombre: 'puntoVenta', largo: 4, tipo: 'NUM' },
  { nombre: 'numero', largo: 8, tipo: 'NUM' },
  { nombre: 'base', largo: 12, tipo: 'IMPORTE', separador: '.', signo: true },
  { nombre: 'importe', largo: 11, tipo: 'IMPORTE', separador: '.', signo: true },
  { nombre: 'tipoOperacion', largo: 1, tipo: 'TXT' },
];

/** AGIP e-ARCIBA — retenciones/percepciones (215). */
export const AGIP_RETENCION: Campo[] = [
  { nombre: 'tipoOperacion', largo: 1, tipo: 'NUM' },
  { nombre: 'codigoNorma', largo: 3, tipo: 'NUM' },
  { nombre: 'fechaRetencion', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'tipoComprobante', largo: 2, tipo: 'NUM' },
  { nombre: 'letra', largo: 1, tipo: 'TXT' },
  { nombre: 'numeroComprobante', largo: 16, tipo: 'NUM' },
  { nombre: 'fechaComprobante', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'montoComprobante', largo: 16, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'certificadoPropio', largo: 16, tipo: 'TXT' },
  { nombre: 'tipoDocumento', largo: 1, tipo: 'NUM' },
  { nombre: 'numeroDocumento', largo: 11, tipo: 'NUM' },
  { nombre: 'situacionIibb', largo: 1, tipo: 'NUM' },
  { nombre: 'numeroIibb', largo: 11, tipo: 'NUM' },
  { nombre: 'situacionIva', largo: 1, tipo: 'NUM' },
  { nombre: 'razonSocial', largo: 30, tipo: 'TXT' },
  { nombre: 'importeOtrosConceptos', largo: 16, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'importeIva', largo: 16, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'montoSujeto', largo: 16, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'alicuota', largo: 5, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'retencion', largo: 16, tipo: 'IMPORTE', separador: ',' },
  { nombre: 'montoTotal', largo: 16, tipo: 'IMPORTE', separador: ',' },
];

/* SIRE (E35): docs/referencias/arca-SIRE-emision-por-lote.txt. Decimales con punto; opcionales vacíos en espacios (los arma el generador). */
const impSire = (nombre: string): Campo => ({ nombre, largo: 14, tipo: 'IMPORTE', separador: '.' });
const txt = (nombre: string, largo: number): Campo => ({ nombre, largo, tipo: 'TXT' });

/** SIRE F.2005 — certificados de retención impositiva (IVA, impuesto 216), §5.1 (305). */
export const SIRE_F2005: Campo[] = [
  { nombre: 'version', largo: 4, tipo: 'FIJO', valor: '0100' }, txt('trazabilidad', 36), { nombre: 'impuesto', largo: 3, tipo: 'FIJO', valor: '216' },
  { nombre: 'regimen', largo: 3, tipo: 'NUM' }, { nombre: 'fechaRetencion', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  txt('condicion', 2), { nombre: 'imposibilidad', largo: 1, tipo: 'FIJO', valor: '0' }, txt('motivoNoRetencion', 30),
  impSire('importeRetencion'), impSire('baseCalculo'), { nombre: 'regimenExclusion', largo: 1, tipo: 'NUM' }, txt('porcentajeExclusion', 6),
  { nombre: 'fechaPublicacion', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' }, { nombre: 'tipoComprobante', largo: 2, tipo: 'NUM' },
  { nombre: 'fechaComprobante', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' }, txt('numeroComprobante', 16), txt('coe', 12), txt('coeOriginal', 12), txt('cae', 14),
  impSire('importeComprobante'), txt('motivoNotaCredito', 30), { nombre: 'retenidoClave', largo: 11, tipo: 'NUM' }, txt('certificadoOriginal', 25),
  { nombre: 'certificadoOriginalFecha', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' }, txt('certificadoOriginalImporte', 14), txt('motivoAnulacion', 1),
];

/** SIRE F.2004 — certificados de seguridad social (SUSS, impuesto 353), §4.1 (191). */
export const SIRE_F2004: Campo[] = [
  { nombre: 'formulario', largo: 4, tipo: 'FIJO', valor: '2004' }, { nombre: 'version', largo: 4, tipo: 'FIJO', valor: '0100' }, txt('trazabilidad', 10),
  { nombre: 'cuitAgente', largo: 11, tipo: 'NUM' }, { nombre: 'impuesto', largo: 3, tipo: 'FIJO', valor: '353' }, { nombre: 'regimen', largo: 3, tipo: 'NUM' },
  { nombre: 'cuitRetenido', largo: 11, tipo: 'NUM' }, { nombre: 'fechaRetencion', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  { nombre: 'tipoComprobante', largo: 2, tipo: 'NUM' }, { nombre: 'fechaComprobante', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' }, txt('numeroComprobante', 16),
  impSire('importeComprobante'), impSire('importeRetencion'), txt('certificadoOriginal', 25), { nombre: 'certificadoOriginalFecha', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' },
  txt('certificadoOriginalImporte', 14), txt('otrosDatos', 30),
];

/** SIRE F.2005 — anulación por lote (E43): solo versión, trazabilidad, impuesto, certificado original y motivo; el resto en blanco. */
export const SIRE_F2005_ANULACION: Campo[] = [
  { nombre: 'version', largo: 4, tipo: 'FIJO', valor: '0100' }, { nombre: 'trazabilidad', largo: 36, tipo: 'TXT' }, { nombre: 'impuesto', largo: 3, tipo: 'FIJO', valor: '216' },
  { nombre: 'blanco1', largo: 212, tipo: 'FIJO', valor: '' }, { nombre: 'certificadoOriginal', largo: 25, tipo: 'TXT' }, { nombre: 'blanco2', largo: 24, tipo: 'FIJO', valor: '' },
  { nombre: 'motivo', largo: 1, tipo: 'NUM' },
];
