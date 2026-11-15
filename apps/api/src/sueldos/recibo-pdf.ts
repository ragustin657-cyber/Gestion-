import PDFDocument from 'pdfkit';
import { formatearCuit, montoEnLetras } from '@gestion/shared';
import { importeAR } from '../ventas/pdf/pdf-venta';

export interface RenglonRecibo { codigo: string; nombre: string; clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO'; cantidad: string | null; base: string | null; porcentaje: string | null; importe: string }
export interface DatosRecibo {
  empresa: { razonSocial: string; cuit: string; domicilio: string | null };
  empleado: { legajo: number; apellido: string; nombre: string; cuil: string; categoria: string; fechaIngreso: string; antiguedadAnios: number; basico: string; formaPago: string };
  periodo: string;
  numero: number | null;
  renglones: RenglonRecibo[];
  totales: { remunerativo: string; noRemunerativo: string; descuentos: string; neto: string };
  deposito: { fecha: string | null; banco: string | null; periodo: string | null };
  fechaPago: string;
  borrador: boolean;
}

const ddmmaaaa = (f: string) => f.split('-').reverse().join('/');

/** Un recibo (art. 140 LCT) con original y duplicado en la misma hoja; una hoja por empleado. */
export function pdfRecibos(recibos: DatosRecibo[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 30, autoFirstPage: false, compress: process.env.NODE_ENV !== 'test' });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    for (const r of recibos) {
      doc.addPage();
      copia(doc, r, 'ORIGINAL', 25);
      doc.save().dash(4, { space: 4 }).moveTo(30, 421).lineTo(565, 421).stroke().undash().restore();
      copia(doc, r, 'DUPLICADO', 431);
      if (r.borrador) {
        doc.save().rotate(-35, { origin: [297, 421] }).fontSize(72).fillColor('#cccccc').fillOpacity(0.5).font('Helvetica-Bold')
          .text('BORRADOR', 120, 385, { lineBreak: false }).restore();
        doc.fillColor('black').fillOpacity(1);
      }
    }
    if (!recibos.length) doc.addPage().fontSize(10).text('La liquidación no tiene recibos');
    doc.end();
  });
}

function copia(doc: PDFKit.PDFDocument, r: DatosRecibo, rotulo: string, y0: number) {
  const ancho = 535;
  doc.fillColor('black').font('Helvetica-Bold').fontSize(7).text(rotulo, 30, y0, { width: ancho, align: 'right' });
  doc.fontSize(11).text(r.empresa.razonSocial, 30, y0 + 8, { width: 330 });
  doc.font('Helvetica').fontSize(7.5).text(`CUIT ${formatearCuit(r.empresa.cuit)}${r.empresa.domicilio ? ` · ${r.empresa.domicilio}` : ''}`, 30, y0 + 22, { width: 330 });
  doc.font('Helvetica-Bold').fontSize(10).text('RECIBO DE HABERES', 360, y0 + 8, { width: 205, align: 'right' });
  doc.font('Helvetica').fontSize(7.5).text(`${r.numero ? `N° ${r.numero} · ` : ''}Período: ${r.periodo}`, 360, y0 + 22, { width: 205, align: 'right' });
  doc.moveTo(30, y0 + 34).lineTo(565, y0 + 34).stroke();
  const e = r.empleado;
  doc.fontSize(7.5)
    .text(`Legajo ${e.legajo} · ${e.apellido}, ${e.nombre} · CUIL ${formatearCuit(e.cuil)}`, 30, y0 + 38, { width: ancho })
    .text(`Categoría: ${e.categoria} · Ingreso: ${ddmmaaaa(e.fechaIngreso)} · Antigüedad: ${e.antiguedadAnios} años · Básico: ${importeAR(e.basico)}`, 30, y0 + 48, { width: ancho });
  // Tabla de conceptos
  const cols = [30, 70, 250, 325, 405, 485];
  const anchos = [40, 180, 75, 80, 80, 80];
  let y = y0 + 62;
  doc.font('Helvetica-Bold');
  ['Cód.', 'Concepto', 'Cant./Base', 'Remunerativo', 'No remunerativo', 'Descuentos'].forEach((t, i) => doc.text(t, cols[i], y, { width: anchos[i], align: i >= 2 ? 'right' : 'left' }));
  doc.moveTo(30, y + 10).lineTo(565, y + 10).stroke();
  doc.font('Helvetica');
  y += 13;
  for (const x of r.renglones) {
    const cant = x.porcentaje !== null && x.base !== null ? `${importeAR(x.base)} × ${Number(x.porcentaje).toLocaleString('es-AR')} %` : x.cantidad !== null ? Number(x.cantidad).toLocaleString('es-AR') : '';
    const col = x.clase === 'REMUNERATIVO' ? 3 : x.clase === 'NO_REMUNERATIVO' ? 4 : 5;
    doc.text(x.codigo, cols[0], y, { width: anchos[0] }).text(x.nombre, cols[1], y, { width: anchos[1], lineBreak: false, ellipsis: true })
      .text(cant, cols[2], y, { width: anchos[2], align: 'right', lineBreak: false }).text(importeAR(x.importe), cols[col], y, { width: anchos[col], align: 'right' });
    y += 10;
  }
  doc.moveTo(30, y + 1).lineTo(565, y + 1).stroke();
  y += 4;
  doc.font('Helvetica-Bold').text('Totales', cols[1], y)
    .text(importeAR(r.totales.remunerativo), cols[3], y, { width: anchos[3], align: 'right' })
    .text(importeAR(r.totales.noRemunerativo), cols[4], y, { width: anchos[4], align: 'right' })
    .text(importeAR(r.totales.descuentos), cols[5], y, { width: anchos[5], align: 'right' });
  y += 14;
  doc.fontSize(9).text(`Neto a cobrar: $ ${importeAR(r.totales.neto)}`, 30, y, { width: ancho, align: 'right' });
  y += 12;
  doc.font('Helvetica').fontSize(7.5).text(`Son ${montoEnLetras(r.totales.neto)}`, 30, y, { width: ancho });
  y += 14;
  const d = r.deposito;
  doc.text(`Último depósito de aportes: ${d.fecha ? `${ddmmaaaa(d.fecha)} · ${d.banco ?? ''} · período ${d.periodo ?? ''}` : 'sin informar'}`, 30, y, { width: ancho });
  y += 10;
  doc.text(`Lugar y fecha de pago: ${r.empresa.domicilio ?? ''}${r.empresa.domicilio ? ', ' : ''}${ddmmaaaa(r.fechaPago)} · Forma de pago: ${r.empleado.formaPago === 'EFECTIVO' ? 'Efectivo' : 'Transferencia bancaria'}`, 30, y, { width: ancho });
  const yf = Math.max(y + 30, y0 + 360);
  doc.moveTo(395, yf).lineTo(565, yf).stroke();
  doc.text('Firma del empleado', 395, yf + 3, { width: 170, align: 'center' });
}
