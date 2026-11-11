import { leerMisComprobantes } from './lector-mis-comprobantes';

const ENC = 'Fecha;Tipo;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;IVA;Imp. Total';
const FILA = '05/11/2026;1 - Factura A;2;1532;1532;76451234567890;80;30711223343;Papelera;1;$;650.000,00;0;0;136.500,00;786.500,00';
const esperado = { fecha: '2026-11-05', tipo: 1, puntoVenta: 2, numero: 1532, documento: '30711223343', netoGravado: '650000.00', iva: '136500.00', total: '786500.00' };

describe('lector de Mis Comprobantes', () => {
  it('formato con punto y coma y coma decimal', () => {
    expect(leerMisComprobantes(Buffer.from(`${ENC}\r\n${FILA}\r\n`, 'utf8')).filas).toEqual([expect.objectContaining(esperado)]);
  });
  it('con BOM, coma como separador, comillas y columnas en otro orden', () => {
    const csv = '﻿"Imp. Total","Fecha de Emisión","Tipo de Comprobante","Punto de Venta","Número Desde","Nro. Doc. Emisor","Imp. Neto Gravado","IVA"\n"786500.00","2026-11-05","1","2","1532","30711223343","650000","136500"\n';
    expect(leerMisComprobantes(Buffer.from(csv, 'utf8')).filas).toEqual([expect.objectContaining(esperado)]);
  });
  it('en latin1', () => {
    expect(leerMisComprobantes(Buffer.from(`${ENC}\n${FILA}\n`, 'latin1')).filas).toHaveLength(1);
  });
  it('una fila de totales o con importes no numéricos se omite, y "U$S 100,00" se lee', () => {
    const csv = `${ENC}\n${FILA}\nTotales;;;;;;;;;;;;;;;786.500,00\n05/11/2026;1;2;1533;1533;1;80;30711223343;X;1;USD;U$S 100,00;0;0;0;U$S 100,00\n05/11/2026;1;2;1534;1534;1;80;30711223343;X;1;$;abc;0;0;0;abc\n`;
    const r = leerMisComprobantes(Buffer.from(csv));
    expect(r.filas.map((f) => [f.numero, f.total])).toEqual([[1532, '786500.00'], [1533, '100.00']]);
  });
  it('un CSV de otra cosa dice qué columnas faltan', () => {
    expect(() => leerMisComprobantes(Buffer.from('a;b;c\n1;2;3\n'))).toThrow('Al CSV le faltan las columnas: Fecha, Tipo, Punto de Venta, Número Desde, Nro. Doc., Imp. Total');
  });
});
