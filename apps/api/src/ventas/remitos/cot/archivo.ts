/**
 * E57: archivo del COT de ARBA (presentación de remitos, `TB_…txt`): registros separados por `|`, líneas con CRLF.
 * Diseño de registro según el instructivo del COT de ARBA (campos a validar contra el instructivo vigente; ver docs/pendientes.md):
 *   01|CUIT_EMPRESA
 *   02|FECHA_EMISION|CODIGO_UNICO|FECHA_SALIDA_TRANSPORTE|HORA_SALIDA_TRANSPORTE|SUJETO_GENERADOR|DESTINATARIO_CONSUMIDOR_FINAL|
 *      DESTINATARIO_TIPO_DOCUMENTO|DESTINATARIO_DOCUMENTO|DESTINATARIO_CUIT|DESTINATARIO_RAZON_SOCIAL|DESTINATARIO_TENEDOR|
 *      DESTINO_DOMICILIO_CALLE|DESTINO_DOMICILIO_NUMERO|DESTINO_DOMICILIO_COMPLE|DESTINO_DOMICILIO_PISO|DESTINO_DOMICILIO_DTO|
 *      DESTINO_DOMICILIO_BARRIO|DESTINO_DOMICILIO_CODIGOPOSTAL|DESTINO_DOMICILIO_LOCALIDAD|DESTINO_DOMICILIO_PROVINCIA|
 *      PROPIO_DESTINO_DOMICILIO_CODIGO|ENTREGA_DOMICILIO_ORIGEN|ORIGEN_CUIT|ORIGEN_RAZON_SOCIAL|EMISOR_TENEDOR|
 *      ORIGEN_DOMICILIO_CALLE|ORIGEN_DOMICILIO_NUMERO|ORIGEN_DOMICILIO_COMPLE|ORIGEN_DOMICILIO_PISO|ORIGEN_DOMICILIO_DTO|
 *      ORIGEN_DOMICILIO_BARRIO|ORIGEN_DOMICILIO_CODIGOPOSTAL|ORIGEN_DOMICILIO_LOCALIDAD|ORIGEN_DOMICILIO_PROVINCIA|
 *      TRANSPORTISTA_CUIT|TIPO_RECORRIDO|RECORRIDO_LOCALIDAD|RECORRIDO_CALLE|RECORRIDO_RUTA|PATENTE_VEHICULO|PATENTE_ACOPLADO|
 *      PRODUCTO_NO_TERM_DEV|IMPORTE
 *   03|CODIGO_UNIDAD_MEDIDA|CANTIDAD|UNIDAD_MEDIDA_PROPIA|CANTIDAD_PROPIA|DESCRIPCION_PRODUCTO|DESCRIPCION_UNIDAD_PROPIA|CODIGO_PRODUCTO
 *   04|CANTIDAD_TOTAL_REMITOS
 */

export interface DomicilioCot { calle: string; numero: string; codigoPostal: string; localidad: string; provincia: string }
export interface DatosArchivoCot {
  cuitEmpresa: string;
  razonSocialEmpresa: string;
  remito: { tipo: 'ENTREGA' | 'DEVOLUCION'; puntoVenta: number; numero: number; fecha: Date; fechaSalida: Date; horaSalida: string; importe: string };
  /** Quien recibe: el cliente en la entrega; la empresa en la devolución. */
  destinatario: { tipoDocumento: 'CUIT' | 'DNI' | 'OTRO'; documento: string; razonSocial: string; consumidorFinal: boolean };
  deposito: DomicilioCot;
  /** Domicilio del traslado: destino en la entrega, origen en la devolución. */
  traslado: DomicilioCot;
  /** Null = transporte propio (CUIT de la empresa). */
  transportistaCuit: string | null;
  patente: string;
  patenteAcoplado: string | null;
  renglones: { unidad: string; cantidad: string; nomenclador: string; descripcion: string }[];
}

const fecha = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const limpio = (s: string) => s.replace(/[|\r\n]/g, ' ').trim();
const soloDigitos = (s: string) => s.replace(/\D/g, '');
/** Códigos de tipo de documento del COT (a verificar): CUIT 80, DNI 96. */
const TIPO_DOC = { CUIT: '80', DNI: '96', OTRO: '99' } as const;

export const codigoUnicoCot = (puntoVenta: number, numero: number) => `R${String(puntoVenta).padStart(4, '0')}${String(numero).padStart(8, '0')}`;

export function nombreArchivoCot(cuit: string, planta: number, puerta: number, f: Date, secuencia: number): string {
  return `TB_${soloDigitos(cuit)}_${String(planta).padStart(6, '0')}${String(puerta).padStart(3, '0')}_${fecha(f)}_${String(secuencia).padStart(6, '0')}.txt`;
}

const domicilio = (d: DomicilioCot) => [limpio(d.calle), limpio(d.numero), '', '', '', '', limpio(d.codigoPostal), limpio(d.localidad), d.provincia];

export function archivoCot(d: DatosArchivoCot): string {
  const devolucion = d.remito.tipo === 'DEVOLUCION';
  const destino = devolucion ? d.deposito : d.traslado;
  const origen = devolucion ? d.traslado : d.deposito;
  const dest = d.destinatario;
  const r02 = [
    '02', fecha(d.remito.fecha), codigoUnicoCot(d.remito.puntoVenta, d.remito.numero), fecha(d.remito.fechaSalida), d.remito.horaSalida, 'E',
    dest.consumidorFinal ? '1' : '0', TIPO_DOC[dest.tipoDocumento], dest.tipoDocumento === 'CUIT' ? '' : soloDigitos(dest.documento),
    dest.tipoDocumento === 'CUIT' ? soloDigitos(dest.documento) : '', limpio(dest.razonSocial), '0',
    ...domicilio(destino), '', 'NO', soloDigitos(d.cuitEmpresa), limpio(d.razonSocialEmpresa), '0',
    ...domicilio(origen), soloDigitos(d.transportistaCuit ?? d.cuitEmpresa), '', '', '', '', d.patente, d.patenteAcoplado ?? '', '0',
    Number(d.remito.importe).toFixed(2),
  ];
  const lineas = [
    `01|${soloDigitos(d.cuitEmpresa)}`,
    r02.join('|'),
    ...d.renglones.map((x) => ['03', x.unidad, Number(x.cantidad).toFixed(2), x.unidad, Number(x.cantidad).toFixed(2), limpio(x.descripcion), '', x.nomenclador].join('|')),
    '04|1',
  ];
  return `${lineas.join('\r\n')}\r\n`;
}
