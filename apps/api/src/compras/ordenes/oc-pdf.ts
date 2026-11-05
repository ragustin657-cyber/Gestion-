import PDFDocument from 'pdfkit';

export interface DatosPdfOC {
  empresa: { razonSocial: string; cuit: string; domicilio: string | null };
  proveedor: { razonSocial: string; cuit: string };
  numero: string;
  fecha: string;
  fechaEntrega: string | null;
  moneda: string;
  observaciones: string | null;
  renglones: { descripcion: string; cantidad: string; precioUnitario: string; bonificacionPct: string; alicuotaIva: string; importe: string }[];
  neto: string;
  iva: string;
  total: string;
}

const cuitFmt = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
const num = (s: string) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Genera el PDF de una orden de compra. */
export function pdfOrdenCompra(d: DatosPdfOC): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.fontSize(14).font('Helvetica-Bold').text(d.empresa.razonSocial);
    doc.fontSize(9).font('Helvetica').text(`CUIT ${cuitFmt(d.empresa.cuit)}${d.empresa.domicilio ? ` · ${d.empresa.domicilio}` : ''}`);
    doc.moveDown();
    doc.fontSize(13).font('Helvetica-Bold').text(`ORDEN DE COMPRA N° ${d.numero}`, { align: 'right' });
    doc.fontSize(9).font('Helvetica').text(`Fecha: ${d.fecha}${d.fechaEntrega ? `   Entrega: ${d.fechaEntrega}` : ''}   Moneda: ${d.moneda}`, { align: 'right' });
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Proveedor: ', { continued: true }).font('Helvetica').text(`${d.proveedor.razonSocial} (CUIT ${cuitFmt(d.proveedor.cuit)})`);
    doc.moveDown();

    const cols = [40, 300, 360, 430, 470, 510];
    const encabezado = ['Descripción', 'Cantidad', 'Precio unit.', 'Bonif.', 'IVA', 'Importe'];
    let y = doc.y;
    doc.font('Helvetica-Bold');
    encabezado.forEach((h, i) => doc.text(h, cols[i], y, { width: (cols[i + 1] ?? 555) - cols[i] - 4, align: i ? 'right' : 'left' }));
    y += 16;
    doc.moveTo(40, y - 3).lineTo(555, y - 3).stroke();
    doc.font('Helvetica');
    for (const r of d.renglones) {
      const valores = [r.descripcion, Number(r.cantidad).toLocaleString('es-AR'), num(r.precioUnitario), `${Number(r.bonificacionPct)} %`, `${Number(r.alicuotaIva)} %`, num(r.importe)];
      const alto = doc.heightOfString(r.descripcion, { width: cols[1] - cols[0] - 4 });
      if (y + alto > 760) {
        doc.addPage();
        y = 40;
      }
      valores.forEach((v, i) => doc.text(v, cols[i], y, { width: (cols[i + 1] ?? 555) - cols[i] - 4, align: i ? 'right' : 'left' }));
      y += Math.max(alto, 12) + 4;
    }
    doc.moveTo(40, y).lineTo(555, y).stroke();
    y += 8;
    for (const [etiqueta, valor] of [['Neto', d.neto], ['IVA', d.iva], ['Total', d.total]] as const) {
      doc.font(etiqueta === 'Total' ? 'Helvetica-Bold' : 'Helvetica').text(etiqueta, 380, y, { width: 90, align: 'right' }).text(num(valor), 470, y, { width: 85, align: 'right' });
      y += 14;
    }
    if (d.observaciones) doc.font('Helvetica').text(`Observaciones: ${d.observaciones}`, 40, y + 10, { width: 515 });
    doc.end();
  });
}
