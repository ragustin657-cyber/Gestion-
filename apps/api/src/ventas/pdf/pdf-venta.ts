import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface DatosPdfVenta {
  empresa: { razonSocial: string; cuit: string; condicionIva: string; domicilio: string | null };
  cliente: { razonSocial: string; documento: string; condicionIva: string; domicilio: string | null };
  titulo: string;
  letra: string;
  codigo: string;
  numero: string;
  fecha: string;
  vencimiento: string;
  servicio: { desde: string; hasta: string; vencePago: string } | null;
  moneda: string;
  cotizacion: string | null;
  asociado: string | null;
  discriminaIva: boolean;
  renglones: { descripcion: string; cantidad: string; precio: string; alicuota: string; importe: string }[];
  totales: [string, string][];
  total: string;
  cae: string;
  caeVencimiento: string;
  urlQr: string;
  sinValidez: boolean;
}

export const importeAR = (s: string | number) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** PDF del comprobante: original con datos fiscales, renglones, totales, CAE y QR de ARCA. */
export async function pdfVenta(d: DatosPdfVenta): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.urlQr, { type: 'png', margin: 1, width: 240 });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, compress: process.env.NODE_ENV !== 'test' });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.fontSize(8).font('Helvetica-Bold').text('ORIGINAL', 40, 30, { align: 'center' });
    // Letra en un recuadro con su código
    doc.rect(275, 45, 45, 45).stroke();
    doc.fontSize(26).text(d.letra, 275, 52, { width: 45, align: 'center' });
    doc.fontSize(7).font('Helvetica').text(`Cód. ${d.codigo}`, 275, 80, { width: 45, align: 'center' });
    // Emisor
    doc.fontSize(13).font('Helvetica-Bold').text(d.empresa.razonSocial, 40, 50, { width: 225 });
    doc.fontSize(8).font('Helvetica').text(`CUIT ${d.empresa.cuit}`, { width: 225 }).text(d.empresa.condicionIva, { width: 225 });
    if (d.empresa.domicilio) doc.text(d.empresa.domicilio, { width: 225 });
    // Comprobante
    doc.fontSize(13).font('Helvetica-Bold').text(d.titulo, 330, 50, { width: 225, align: 'right' });
    doc.fontSize(9).font('Helvetica').text(`N° ${d.numero}`, { width: 225, align: 'right' }).text(`Fecha: ${d.fecha}`, { width: 225, align: 'right' });
    doc.moveTo(40, 110).lineTo(555, 110).stroke();
    // Cliente
    doc.fontSize(9).font('Helvetica-Bold').text('Cliente: ', 40, 118, { continued: true }).font('Helvetica').text(d.cliente.razonSocial);
    doc.text(`${d.cliente.documento} · ${d.cliente.condicionIva}${d.cliente.domicilio ? ` · ${d.cliente.domicilio}` : ''}`);
    doc.text(`Vencimiento del pago: ${d.vencimiento}   Moneda: ${d.moneda}${d.cotizacion ? `   Cotización: ${d.cotizacion}` : ''}`);
    if (d.servicio) doc.text(`Período facturado: ${d.servicio.desde} al ${d.servicio.hasta}   Vencimiento: ${d.servicio.vencePago}`);
    if (d.asociado) doc.text(`Comprobante asociado: ${d.asociado}`);
    doc.moveDown();

    const cols = d.discriminaIva ? [40, 300, 360, 440, 490] : [40, 330, 400, 490];
    const enc = d.discriminaIva ? ['Descripción', 'Cantidad', 'Precio unit.', 'IVA', 'Importe'] : ['Descripción', 'Cantidad', 'Precio unit.', 'Importe'];
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8);
    enc.forEach((e, i) => doc.text(e, cols[i], y, { width: (cols[i + 1] ?? 555) - cols[i] - 4, align: i === 0 ? 'left' : 'right' }));
    doc.font('Helvetica');
    y += 14;
    for (const r of d.renglones) {
      if (y > 680) { doc.addPage(); y = 40; }
      const fila = d.discriminaIva ? [r.descripcion, r.cantidad, r.precio, r.alicuota, r.importe] : [r.descripcion, r.cantidad, r.precio, r.importe];
      const alto = doc.heightOfString(r.descripcion, { width: cols[1] - cols[0] - 4 });
      fila.forEach((v, i) => doc.text(v, cols[i], y, { width: (cols[i + 1] ?? 555) - cols[i] - 4, align: i === 0 ? 'left' : 'right' }));
      y += Math.max(alto, 10) + 4;
    }
    doc.moveTo(40, y).lineTo(555, y).stroke();
    y += 8;
    doc.fontSize(9);
    for (const [k, v] of d.totales) {
      doc.text(k, 330, y, { width: 140, align: 'right' }).text(v, 470, y, { width: 85, align: 'right' });
      y += 13;
    }
    doc.font('Helvetica-Bold').fontSize(11).text('Total', 330, y, { width: 140, align: 'right' }).text(d.total, 470, y, { width: 85, align: 'right' });

    // Pie: QR y CAE
    const pie = 700;
    doc.image(qr, 40, pie, { width: 90 });
    doc.font('Helvetica-Bold').fontSize(10).text(`CAE: ${d.cae}`, 150, pie + 20).font('Helvetica').text(`Vencimiento del CAE: ${d.caeVencimiento}`, 150, pie + 36);
    doc.fontSize(7).text('Comprobante autorizado por ARCA', 150, pie + 54);

    if (d.sinValidez) {
      doc.save().rotate(-35, { origin: [297, 420] }).fontSize(54).fillColor('#cc0000').opacity(0.25).font('Helvetica-Bold').text('SIN VALIDEZ FISCAL', 20, 400, { width: 560, align: 'center' }).restore();
    }
    doc.end();
  });
}
