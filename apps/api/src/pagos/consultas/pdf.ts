import PDFDocument from 'pdfkit';

const cuitFmt = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
export const num = (s: string | number) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : '');

function documento(cuerpo: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    cuerpo(doc);
    doc.end();
  });
}

export interface Empresa { razonSocial: string; cuit: string; domicilio: string | null }

function encabezado(doc: PDFKit.PDFDocument, e: Empresa, titulo: string, sub: string) {
  doc.fontSize(14).font('Helvetica-Bold').text(e.razonSocial);
  doc.fontSize(9).font('Helvetica').text(`CUIT ${cuitFmt(e.cuit)}${e.domicilio ? ` · ${e.domicilio}` : ''}`);
  doc.moveDown();
  doc.fontSize(13).font('Helvetica-Bold').text(titulo, { align: 'right' });
  doc.fontSize(9).font('Helvetica').text(sub, { align: 'right' });
  doc.moveDown();
}

function tabla(doc: PDFKit.PDFDocument, titulos: string[], anchos: number[], filas: string[][]) {
  let x = 40;
  const y0 = doc.y;
  doc.font('Helvetica-Bold');
  titulos.forEach((t, i) => { doc.text(t, x, y0, { width: anchos[i] - 4, align: i ? 'right' : 'left' }); x += anchos[i]; });
  let y = y0 + 14;
  doc.moveTo(40, y - 2).lineTo(555, y - 2).stroke();
  doc.font('Helvetica');
  for (const f of filas) {
    x = 40;
    f.forEach((v, i) => { doc.text(v, x, y, { width: anchos[i] - 4, align: i ? 'right' : 'left' }); x += anchos[i]; });
    y += 14;
  }
  doc.y = y + 6;
  doc.x = 40;
}

export interface DatosPdfOP {
  empresa: Empresa; proveedor: { razonSocial: string; cuit: string }; numero: string; fecha: Date; fechaPago: Date | null; estado: string;
  imputaciones: { comprobante: string; moneda: string; importe: string; importePesos: string }[];
  retenciones: { descripcion: string; base: string; importe: string; certificado: string }[];
  medios: { descripcion: string; importe: string }[];
  totalCancelar: string; totalRetenciones: string; neto: string;
}

export function pdfOrdenPago(d: DatosPdfOP): Promise<Buffer> {
  return documento((doc) => {
    encabezado(doc, d.empresa, `ORDEN DE PAGO N° ${d.numero}`, `Fecha: ${fecha(d.fecha)}${d.fechaPago ? `   Pagada: ${fecha(d.fechaPago)}` : ''}   ${d.estado}`);
    doc.font('Helvetica-Bold').text('Proveedor: ', { continued: true }).font('Helvetica').text(`${d.proveedor.razonSocial} (CUIT ${cuitFmt(d.proveedor.cuit)})`);
    doc.moveDown();
    tabla(doc, ['Comprobante', 'Moneda', 'Importe', 'En pesos'], [255, 60, 100, 100], d.imputaciones.map((i) => [i.comprobante, i.moneda, num(i.importe), num(i.importePesos)]));
    if (d.retenciones.length) tabla(doc, ['Retención', 'Base', 'Importe', 'Certificado'], [215, 100, 100, 100], d.retenciones.map((r) => [r.descripcion, num(r.base), num(r.importe), r.certificado]));
    if (d.medios.length) tabla(doc, ['Medio de pago', 'Importe'], [415, 100], d.medios.map((m) => [m.descripcion, num(m.importe)]));
    for (const [t, v] of [['Total a cancelar', d.totalCancelar], ['Retenciones', d.totalRetenciones], ['Neto pagado', d.neto]] as const) {
      doc.font(t === 'Neto pagado' ? 'Helvetica-Bold' : 'Helvetica').text(`${t}: $ ${num(v)}`, { align: 'right' });
    }
    doc.moveDown(3).font('Helvetica').text('______________________          ______________________', { align: 'center' });
    doc.text('Firma autorizada                              Recibí conforme', { align: 'center' });
  });
}

export interface DatosCertificado {
  empresa: Empresa; proveedor: { razonSocial: string; cuit: string; domicilio: string | null }; certificado: string; fecha: Date;
  impuesto: string; detalleImpuesto: string; base: string; alicuota: string; importe: string; ordenPago: string; anulado: boolean;
}

export function pdfCertificado(d: DatosCertificado): Promise<Buffer> {
  return documento((doc) => {
    encabezado(doc, d.empresa, `CERTIFICADO DE RETENCIÓN N° ${d.certificado}`, `Fecha: ${fecha(d.fecha)}   Orden de pago ${d.ordenPago}`);
    if (d.anulado) doc.fontSize(20).fillColor('red').text('ANULADO', { align: 'center' }).fillColor('black').fontSize(9);
    doc.font('Helvetica-Bold').text('Agente de retención');
    doc.font('Helvetica').text(`${d.empresa.razonSocial} — CUIT ${cuitFmt(d.empresa.cuit)}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Sujeto retenido');
    doc.font('Helvetica').text(`${d.proveedor.razonSocial} — CUIT ${cuitFmt(d.proveedor.cuit)}${d.proveedor.domicilio ? ` — ${d.proveedor.domicilio}` : ''}`);
    doc.moveDown();
    tabla(doc, ['Impuesto', 'Base sujeta', 'Alícuota', 'Importe retenido'], [215, 100, 100, 100], [[`${d.impuesto} — ${d.detalleImpuesto}`, num(d.base), d.alicuota === 'escala' ? 'Escala' : `${d.alicuota} %`, num(d.importe)]]);
    doc.moveDown(3).text('______________________', { align: 'right' }).text('Firma del agente de retención', { align: 'right' });
  });
}
