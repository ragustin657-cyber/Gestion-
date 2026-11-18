import PDFDocument from 'pdfkit';
import { importeAR } from '../pdf/pdf-venta';

export interface DatosPdfResumen {
  empresa: { razonSocial: string; cuit: string };
  cliente: { razonSocial: string; cuit: string };
  fecha: string;
  comprobantes: { descripcion: string; fecha: string; fechaVencimiento: string; dias: number; importe: string; saldo: string; vencido: boolean }[];
  vencido: string; porVencer: string; aFavor: string;
}

const dma = (iso: string) => iso.split('-').reverse().join('/');

/** Resumen de cuenta del cliente para mandarle por mail (spec E28 §4). */
export function pdfResumen(d: DatosPdfResumen): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, compress: process.env.NODE_ENV !== 'test', info: { Title: `Resumen de cuenta - ${d.cliente.razonSocial}` } });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const encabezado = () => {
      doc.fillColor('black').font('Helvetica-Bold').fontSize(14).text(d.empresa.razonSocial, 40, 40);
      doc.font('Helvetica').fontSize(9).text(`CUIT ${d.empresa.cuit}`);
      doc.font('Helvetica-Bold').fontSize(12).text('Resumen de cuenta', 300, 40, { align: 'right' });
      doc.font('Helvetica').fontSize(9).text(`Emitido el ${dma(d.fecha)}`, 300, 58, { align: 'right' });
      doc.moveTo(40, 80).lineTo(555, 80).stroke();
      doc.fontSize(10).text(`Cliente: ${d.cliente.razonSocial} · CUIT ${d.cliente.cuit}`, 40, 88);
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('Comprobante', 40, 112).text('Fecha', 220, 112).text('Vence', 280, 112).text('Días', 340, 112, { width: 40, align: 'right' })
        .text('Importe', 390, 112, { width: 80, align: 'right' }).text('Saldo', 475, 112, { width: 80, align: 'right' });
      doc.font('Helvetica');
    };
    encabezado();
    let y = 112;
    for (const c of d.comprobantes) {
      y += 14;
      if (y > 740) { doc.addPage(); encabezado(); y = 126; }
      doc.fillColor(c.vencido ? '#b00020' : 'black').fontSize(8)
        .text(c.descripcion, 40, y, { width: 175, lineBreak: false }).text(dma(c.fecha), 220, y).text(dma(c.fechaVencimiento), 280, y)
        .text(String(c.dias), 340, y, { width: 40, align: 'right' }).text(importeAR(c.importe), 390, y, { width: 80, align: 'right' }).text(importeAR(c.saldo), 475, y, { width: 80, align: 'right' });
    }
    doc.fillColor('black').font('Helvetica-Bold').fontSize(10);
    y += 28;
    doc.text(`Vencido: $ ${importeAR(d.vencido)}`, 300, y, { width: 255, align: 'right' });
    doc.text(`Por vencer: $ ${importeAR(d.porVencer)}`, 300, y + 14, { width: 255, align: 'right' });
    if (Number(d.aFavor) < 0) doc.font('Helvetica').text(`Saldo a favor sin aplicar: $ ${importeAR(-Number(d.aFavor))}`, 300, y + 28, { width: 255, align: 'right' });
    doc.end();
  });
}
