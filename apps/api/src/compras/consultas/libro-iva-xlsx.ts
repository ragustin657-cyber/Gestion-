import ExcelJS from 'exceljs';
import { FilaLibroIva } from './consultas.service';

const ETIQUETA = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito', TICKET: 'Ticket' } as Record<string, string>;

/** Arma el Libro IVA Compras en .xlsx con una fila de totales al pie. */
export async function libroIvaXlsx(datos: { filas: FilaLibroIva[]; totales: Omit<FilaLibroIva, 'fechaContable' | 'tipo' | 'letra' | 'numero' | 'razonSocial' | 'cuit'> }): Promise<Buffer> {
  const alicuotas = [...new Set([...Object.keys(datos.totales.netoPorAlicuota)])].sort((a, b) => Number(a) - Number(b));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Libro IVA Compras');
  const columnasImporte = [
    ...alicuotas.flatMap((a) => [{ header: `Neto ${a.replace('.', ',')} %`, key: `n${a}` }, { header: `IVA ${a.replace('.', ',')} %`, key: `i${a}` }]),
    { header: 'Percepción IVA', key: 'percepcionIva' }, { header: 'Percepciones IIBB', key: 'percepcionesIibb' },
    { header: 'Imp. internos', key: 'impuestosInternos' }, { header: 'No gravado', key: 'noGravado' }, { header: 'Exento', key: 'exento' },
    { header: 'No computable', key: 'noComputable' }, { header: 'Total', key: 'total' },
  ];
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Tipo', key: 'tipo', width: 16 }, { header: 'Letra', key: 'letra', width: 6 },
    { header: 'Número', key: 'numero', width: 16 }, { header: 'Proveedor', key: 'razonSocial', width: 32 }, { header: 'CUIT', key: 'cuit', width: 14 },
    ...columnasImporte.map((c) => ({ ...c, width: 15, style: { numFmt: '#,##0.00' } })),
  ];
  ws.getRow(1).font = { bold: true };
  const importes = (x: Omit<FilaLibroIva, 'fechaContable' | 'tipo' | 'letra' | 'numero' | 'razonSocial' | 'cuit'>) => ({
    ...Object.fromEntries(alicuotas.flatMap((a) => [[`n${a}`, Number(x.netoPorAlicuota[a] ?? 0)], [`i${a}`, Number(x.ivaPorAlicuota[a] ?? 0)]])),
    percepcionIva: Number(x.percepcionIva), percepcionesIibb: Number(x.percepcionesIibb), impuestosInternos: Number(x.impuestosInternos),
    noGravado: Number(x.noGravado), exento: Number(x.exento), noComputable: Number(x.noComputable), total: Number(x.total),
  });
  for (const f of datos.filas)
    ws.addRow({ fecha: f.fechaContable.toISOString().slice(0, 10).split('-').reverse().join('/'), tipo: ETIQUETA[f.tipo] ?? f.tipo, letra: f.letra, numero: f.numero, razonSocial: f.razonSocial, cuit: f.cuit, ...importes(f) });
  const t = ws.addRow({ fecha: 'Totales', ...importes(datos.totales) });
  t.font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
