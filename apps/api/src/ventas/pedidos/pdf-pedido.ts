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

/** Renglones del PDF: en letra B (y C) con IVA incluido, como la factura; en A, netos. */
export function renglonesPdf(letra: string, renglones: { descripcion: string; cantidad: string; precioUnitario: string; neto: string; iva: string }[]) {
  return renglones.map((r) => {
    if (letra === 'A') return { descripcion: r.descripcion, cantidad: r.cantidad, precioUnitario: r.precioUnitario, importe: r.neto };
    const importe = Number(r.neto) + Number(r.iva);
    return { descripcion: r.descripcion, cantidad: r.cantidad, precioUnitario: String(Number((importe / Number(r.cantidad)).toFixed(4))), importe: importe.toFixed(2) };
  });
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
    const encabezado = (copia: string) => {
      doc.font('Helvetica-Bold').fontSize(14).text(d.empresa.razonSocial, 40, 40);
      doc.font('Helvetica').fontSize(9).text(`CUIT ${d.empresa.cuit}${d.empresa.domicilio ? ` · ${d.empresa.domicilio}` : ''}`);
      doc.font('Helvetica-Bold').fontSize(14).text(`${d.titulo} N° ${d.numero}`, 300, 40, { align: 'right' });
      doc.font('Helvetica').fontSize(9).text(`Fecha: ${d.fecha}${d.validoHasta ? ` · Válido hasta: ${d.validoHasta}` : ''}`, 300, 60, { align: 'right' });
      if (copia) doc.text(copia, 300, 72, { align: 'right' });
      doc.moveTo(40, 92).lineTo(555, 92).stroke();
      doc.fontSize(10).text(`Cliente: ${d.cliente.razonSocial} · CUIT ${d.cliente.cuit}`, 40, 100);
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Descripción', 40, 125).text('Cantidad', 330, 125, { width: 60, align: 'right' });
      if (conPrecios) doc.text(`Precio (${d.moneda})`, 395, 125, { width: 75, align: 'right' }).text('Importe', 475, 125, { width: 80, align: 'right' });
      doc.font('Helvetica');
    };
    const conPrecios = d.renglones.some((r) => r.precioUnitario);
    // Lo que va al pie (totales, observaciones o firma) no puede pisar los renglones: salto antes de 700
    const LIMITE = 700;
    copias.forEach((copia, i) => {
      if (i) doc.addPage();
      encabezado(copia);
      let y = 125;
      for (const r of d.renglones) {
        y += 16;
        if (y > LIMITE) { doc.addPage(); encabezado(copia); y = 141; }
        doc.text(r.descripcion, 40, y, { width: 285 }).text(r.cantidad, 330, y, { width: 60, align: 'right' });
        if (conPrecios) doc.text(importeAR(r.precioUnitario ?? 0), 395, y, { width: 75, align: 'right' }).text(importeAR(r.importe ?? 0), 475, y, { width: 80, align: 'right' });
      }
      if (y > LIMITE - 40) { doc.addPage(); encabezado(copia); y = 141; }
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
