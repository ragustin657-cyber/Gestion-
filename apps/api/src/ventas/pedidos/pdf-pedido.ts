import PDFDocument from 'pdfkit';
import { importeAR } from '../pdf/pdf-venta';

export interface DatosPdfPedido {
  titulo: string;
  numero: string;
  empresa: { razonSocial: string; cuit: string; domicilio?: string | null };
  cliente: { razonSocial: string; cuit: string };
  fecha: string;
  validoHasta?: string | null;
  moneda: string;
  /** Sin precios (remito). */
  renglones: { descripcion: string; cantidad: string; precioUnitario?: string; importe?: string }[];
  totales?: { neto: string; iva: string; total: string };
  observaciones?: string | null;
  copias?: string[];
}

/** PDF simple de pedido, presupuesto o remito (una página por copia). */
export function pdfDocumento(d: DatosPdfPedido): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, compress: process.env.NODE_ENV !== 'test', info: { Title: `${d.titulo} Nro. ${d.numero}` } });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const copias = d.copias ?? [''];
    copias.forEach((copia, i) => {
      if (i) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).text(d.empresa.razonSocial, 40, 40);
      doc.font('Helvetica').fontSize(9).text(`CUIT ${d.empresa.cuit}${d.empresa.domicilio ? ` · ${d.empresa.domicilio}` : ''}`);
      doc.font('Helvetica-Bold').fontSize(14).text(`${d.titulo} N° ${d.numero}`, 300, 40, { align: 'right' });
      doc.font('Helvetica').fontSize(9).text(`Fecha: ${d.fecha}${d.validoHasta ? ` · Válido hasta: ${d.validoHasta}` : ''}`, 300, 60, { align: 'right' });
      if (copia) doc.text(copia, 300, 72, { align: 'right' });
      doc.moveTo(40, 92).lineTo(555, 92).stroke();
      doc.fontSize(10).text(`Cliente: ${d.cliente.razonSocial} · CUIT ${d.cliente.cuit}`, 40, 100);
      let y = 125;
      const conPrecios = d.renglones.some((r) => r.precioUnitario);
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Descripción', 40, y).text('Cantidad', 330, y, { width: 60, align: 'right' });
      if (conPrecios) doc.text(`Precio (${d.moneda})`, 395, y, { width: 75, align: 'right' }).text('Importe', 475, y, { width: 80, align: 'right' });
      doc.font('Helvetica');
      for (const r of d.renglones) {
        y += 16;
        if (y > 760) { doc.addPage(); y = 40; }
        doc.text(r.descripcion, 40, y, { width: 285 }).text(r.cantidad, 330, y, { width: 60, align: 'right' });
        if (conPrecios) doc.text(importeAR(r.precioUnitario ?? 0), 395, y, { width: 75, align: 'right' }).text(importeAR(r.importe ?? 0), 475, y, { width: 80, align: 'right' });
      }
      if (d.totales) {
        y += 28;
        doc.font('Helvetica-Bold');
        doc.text(`Neto: ${importeAR(d.totales.neto)}   IVA: ${importeAR(d.totales.iva)}   Total ${d.moneda}: ${importeAR(d.totales.total)}`, 40, y, { align: 'right', width: 515 });
        doc.font('Helvetica');
      }
      if (d.observaciones) doc.text(`Observaciones: ${d.observaciones}`, 40, y + 24, { width: 515 });
      if (!conPrecios) doc.text('Recibí conforme: ______________________   Aclaración: ______________________', 40, 740);
    });
    doc.end();
  });
}
