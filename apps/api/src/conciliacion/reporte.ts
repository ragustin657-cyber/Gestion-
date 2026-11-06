import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ItemReporte { fecha: string; descripcion: string; referencia: string | null; importe: string }
export interface DatosReporte {
  encabezado: { empresa: string; cuit: string; cuenta: string; monedaCodigo: string; periodo: string; estado: string; cerradaPor: string | null; cerradaEn: string | null };
  saldoExtracto: string;
  creditosNoAcreditados: ItemReporte[];
  debitosNoDebitados: ItemReporte[];
  lineasPendientes: ItemReporte[];
  saldoLibros: string;
  diferencia: string;
}

const num = (s: string | number) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (iso: string) => iso.split('-').reverse().join('/');
const suma = (xs: ItemReporte[]) => xs.reduce((s, x) => s + Math.round(Number(x.importe) * 100), 0) / 100;

/** Filas del reporte (título, importe, detalle), en el orden de la conciliación. */
function secciones(d: DatosReporte): { titulo: string; importe: number | string; items?: ItemReporte[] }[] {
  return [
    { titulo: 'Saldo según extracto', importe: d.saldoExtracto },
    { titulo: '(+) Créditos registrados no acreditados por el banco', importe: suma(d.creditosNoAcreditados), items: d.creditosNoAcreditados },
    { titulo: '(−) Débitos registrados no debitados por el banco', importe: suma(d.debitosNoDebitados), items: d.debitosNoDebitados },
    { titulo: '(−/+) Movimientos del banco pendientes de registrar', importe: suma(d.lineasPendientes), items: d.lineasPendientes },
    { titulo: 'Saldo según libros', importe: d.saldoLibros },
    { titulo: 'Diferencia', importe: d.diferencia },
  ];
}

export function reportePdf(d: DatosReporte): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const e = d.encabezado;
    doc.fontSize(14).font('Helvetica-Bold').text(e.empresa);
    doc.fontSize(9).font('Helvetica').text(`CUIT ${e.cuit}`);
    doc.moveDown();
    doc.fontSize(13).font('Helvetica-Bold').text('Conciliación bancaria', { align: 'right' });
    doc.fontSize(9).font('Helvetica').text(`${e.cuenta} (${e.monedaCodigo}) · ${e.periodo}`, { align: 'right' });
    doc.text(e.estado === 'CERRADA' ? `Cerrada por ${e.cerradaPor ?? ''} el ${e.cerradaEn ?? ''}` : 'Abierta (borrador)', { align: 'right' });
    doc.moveDown();
    for (const s of secciones(d)) {
      const y = doc.y;
      doc.fontSize(10).font('Helvetica-Bold').text(s.titulo, 40, y, { width: 400 });
      doc.text(num(s.importe), 440, y, { width: 115, align: 'right' });
      doc.font('Helvetica').fontSize(8);
      for (const it of s.items ?? []) {
        const yi = doc.y;
        doc.text(`${fecha(it.fecha)}  ${it.descripcion}${it.referencia ? ` (${it.referencia})` : ''}`, 60, yi, { width: 370 });
        doc.text(num(it.importe), 440, yi, { width: 115, align: 'right' });
      }
      doc.moveDown(0.6);
    }
    doc.end();
  });
}

export async function reporteXlsx(d: DatosReporte): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Conciliación');
  ws.columns = [{ width: 60 }, { width: 14 }, { width: 18 }, { width: 16, style: { numFmt: '#,##0.00' } }];
  const e = d.encabezado;
  ws.addRow([`${e.empresa} · Conciliación bancaria`]).font = { bold: true };
  ws.addRow([`${e.cuenta} (${e.monedaCodigo}) · ${e.periodo} · ${e.estado === 'CERRADA' ? 'Cerrada' : 'Abierta'}`]);
  ws.addRow([]);
  for (const s of secciones(d)) {
    const r = ws.addRow([s.titulo, '', '', Number(s.importe)]);
    r.font = { bold: true };
    for (const it of s.items ?? []) ws.addRow([`   ${it.descripcion}`, fecha(it.fecha), it.referencia ?? '', Number(it.importe)]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
