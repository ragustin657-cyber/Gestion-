import ExcelJS from 'exceljs';
import { FormatoParseo, parsearExtracto, parsearFecha, parsearImporte } from './interprete';

const base: FormatoParseo = {
  tipoArchivo: 'CSV', separador: ';', hoja: null, filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
  columnaFecha: '1', columnaConcepto: '2', columnaReferencia: '3', columnaSaldo: null,
  modoImporte: 'IMPORTE_CON_SIGNO', columnaImporte: '4', columnaDebito: null, columnaCredito: null,
};
const csv = (filas: string[]) => Buffer.from(['Fecha;Concepto;Ref;Importe', ...filas].join('\n'), 'utf8');

describe('intérprete de extractos', () => {
  it('importe con signo, miles y decimales con coma', async () => {
    const r = await parsearExtracto(csv(['05/10/2026;DEP EFECTIVO;0045;1.234.567,89', '06/10/2026;IMP LEY 25413;;-318,00']), base);
    expect(r.errores).toEqual([]);
    expect(r.lineas.map((l) => [l.fila, l.fecha.toISOString().slice(0, 10), l.concepto, l.referencia, l.importe.toString()])).toEqual([
      [2, '2026-10-05', 'DEP EFECTIVO', '0045', '1234567.89'],
      [3, '2026-10-06', 'IMP LEY 25413', null, '-318'],
    ]);
  });

  it('débito y crédito en columnas separadas, decimal con punto y comillas', async () => {
    const f: FormatoParseo = { ...base, separador: ',', separadorDecimal: '.', modoImporte: 'DEBITO_CREDITO', columnaImporte: null, columnaDebito: '4', columnaCredito: '5' };
    const buf = Buffer.from('h\n2026-10-05,"PAGO, PROVEEDOR",77,"1,234.50",\n2026-10-06,ACRED,,,200.00\n2026-10-07,NADA,,,\n', 'utf8');
    const r = await parsearExtracto(buf, { ...f, formatoFecha: 'AAAA-MM-DD' });
    expect(r.errores).toEqual([]);
    expect(r.lineas.map((l) => [l.concepto, l.importe.toString()])).toEqual([['PAGO, PROVEEDOR', '-1234.5'], ['ACRED', '200']]);
    expect(r.advertencias).toContain('Se omitieron 1 filas vacías o con importe cero');
  });

  it('fecha imposible o importe ilegible: error con número de fila', async () => {
    const r = await parsearExtracto(csv(['05/10/2026;A;;1', '31/02/2026;B;;2', '07/10/2026;C;;abc']), base);
    expect(r.errores).toEqual([{ fila: 3, mensaje: 'Fecha inválida' }, { fila: 4, mensaje: 'Importe inválido' }]);
  });

  it('lee archivos en Latin-1', async () => {
    const buf = Buffer.concat([Buffer.from('h\n05/10/2026;A', 'latin1'), Buffer.from([0xd1]), Buffer.from('O;;10', 'latin1')]);
    const r = await parsearExtracto(buf, base);
    expect(r.lineas[0].concepto).toBe('AÑO');
  });

  it('XLSX con fechas y números nativos', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Movimientos');
    ws.addRow(['Fecha', 'Concepto', 'Ref', 'Importe']);
    ws.addRow([new Date(Date.UTC(2026, 9, 5)), 'DEPOSITO', 45, 53000.5]);
    ws.addRow(['06/10/2026', 'COMISION', '', -8500]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parsearExtracto(buf, { ...base, tipoArchivo: 'XLSX', hoja: '1' });
    expect(r.errores).toEqual([]);
    expect(r.lineas.map((l) => [l.fecha.toISOString().slice(0, 10), l.referencia, l.importe.toString()])).toEqual([['2026-10-05', '45', '53000.5'], ['2026-10-06', null, '-8500']]);
  });

  it('advierte si el saldo no cuadra', async () => {
    const f = { ...base, columnaSaldo: '5' };
    const buf = Buffer.from('h\n01/10/2026;A;;100;1100\n02/10/2026;B;;-50;1050\n03/10/2026;C;;10;1070\n', 'utf8');
    const r = await parsearExtracto(buf, f);
    expect(r.advertencias).toContain('El saldo de la fila 4 no coincide: revise el formato');
  });

  it('formatos de fecha y columnas por letra', () => {
    expect(parsearFecha('05-10-2026', 'DD-MM-AAAA')!.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(parsearFecha('2026-13-01', 'AAAA-MM-DD')).toBeNull();
    expect(parsearImporte('(1.500,00)', ',')!.toString()).toBe('-1500');
    expect(parsearImporte('$ 2.000,10', ',')!.toString()).toBe('2000.1');
    expect(parsearImporte('1.2.3', '.')).toBeNull();
  });
});
