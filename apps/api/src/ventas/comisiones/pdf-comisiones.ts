import PDFDocument from 'pdfkit';
import { importeAR } from '../pdf/pdf-venta';

export interface DatosPdfComisiones {
  empresa: { razonSocial: string; cuit: string };
  vendedor: string;
  periodo: string;
  numero: number;
  renglones: { fecha: string; cliente: string; comprobante: string; cobro: string; neto: string; porcentaje: string; comision: string }[];
  total: string;
}

/** Liquidación de comisiones de un vendedor externo, para que facture (spec E24 §6). */
export function pdfComisiones(d: DatosPdfComisiones): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, compress: process.env.NODE_ENV !== 'test', info: { Title: `Liquidación de comisiones ${d.periodo} - ${d.vendedor}` } });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const encabezado = () => {
      doc.font('Helvetica-Bold').fontSize(14).text(d.empresa.razonSocial, 40, 40);
      doc.font('Helvetica').fontSize(9).text(`CUIT ${d.empresa.cuit}`);
      doc.font('Helvetica-Bold').fontSize(12).text(`Liquidación de comisiones N° ${d.numero}`, 300, 40, { align: 'right' });
      doc.font('Helvetica').fontSize(9).text(`Período ${d.periodo}`, 300, 58, { align: 'right' });
      doc.moveTo(40, 80).lineTo(555, 80).stroke();
      doc.fontSize(10).text(`Vendedor: ${d.vendedor}`, 40, 88);
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('Fecha', 40, 110).text('Cliente', 90, 110).text('Comprobante', 230, 110).text('Cobro', 330, 110)
        .text('Neto', 420, 110, { width: 55, align: 'right' }).text('%', 475, 110, { width: 25, align: 'right' }).text('Comisión', 500, 110, { width: 55, align: 'right' });
      doc.font('Helvetica');
    };
    encabezado();
    let y = 110;
    for (const r of d.renglones) {
      y += 14;
      if (y > 760) { doc.addPage(); encabezado(); y = 124; }
      doc.fontSize(8).text(r.fecha, 40, y).text(r.cliente, 90, y, { width: 135, lineBreak: false }).text(r.comprobante, 230, y).text(r.cobro, 330, y, { width: 88, lineBreak: false })
        .text(importeAR(r.neto), 420, y, { width: 55, align: 'right' }).text(r.porcentaje, 475, y, { width: 25, align: 'right' }).text(importeAR(r.comision), 500, y, { width: 55, align: 'right' });
    }
    doc.font('Helvetica-Bold').fontSize(10).text(`Total a facturar: $ ${importeAR(d.total)}`, 300, y + 24, { width: 255, align: 'right' });
    doc.end();
  });
}
