import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface Columna { titulo: string; ancho: number; importe?: boolean }
export type Fila = (string | number | null)[];

const num = (v: string | number | null) => (v === null || v === '' ? '' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Tabla en Excel con título y subtítulo. Las columnas de importe se guardan como número. */
export async function tablaXlsx(titulo: string, subtitulo: string, columnas: Columna[], filas: Fila[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(titulo.slice(0, 30));
  ws.addRow([titulo]).font = { bold: true, size: 13 };
  ws.addRow([subtitulo]);
  ws.addRow([]);
  ws.addRow(columnas.map((c) => c.titulo)).font = { bold: true };
  columnas.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(10, c.ancho / 6);
    if (c.importe) ws.getColumn(i + 1).numFmt = '#,##0.00';
  });
  for (const f of filas) ws.addRow(f.map((v, i) => (columnas[i]?.importe && v !== null && v !== '' ? Number(v) : v)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Tabla en PDF apaisado, con encabezado repetido en cada página. */
export function tablaPdf(empresa: string, titulo: string, subtitulo: string, columnas: Columna[], filas: Fila[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, compress: process.env.NODE_ENV !== 'test' });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const encabezado = () => {
      doc.fontSize(11).font('Helvetica-Bold').text(empresa, 30, 30);
      doc.fontSize(10).text(titulo, 30, 30, { align: 'right' });
      doc.fontSize(8).font('Helvetica').text(subtitulo, 30, 44, { align: 'right' });
      let x = 30;
      doc.font('Helvetica-Bold');
      for (const c of columnas) {
        doc.text(c.titulo, x, 62, { width: c.ancho - 4, align: c.importe ? 'right' : 'left' });
        x += c.ancho;
      }
      doc.moveTo(30, 74).lineTo(812, 74).stroke();
      doc.font('Helvetica');
      return 78;
    };
    let y = encabezado();
    for (const f of filas) {
      if (y > 560) {
        doc.addPage();
        y = encabezado();
      }
      let x = 30;
      f.forEach((v, i) => {
        const c = columnas[i];
        doc.text(c?.importe ? num(v) : String(v ?? ''), x, y, { width: (c?.ancho ?? 60) - 4, align: c?.importe ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += c?.ancho ?? 60;
      });
      y += 12;
    }
    doc.end();
  });
}
