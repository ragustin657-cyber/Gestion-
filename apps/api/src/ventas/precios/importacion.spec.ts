import { leerPrecios } from './importacion';

const leer = (t: string) => leerPrecios(Buffer.from(t), 'p.csv');
describe('leerPrecios', () => {
  it('interpreta separadores de miles', async () => {
    expect((await leer('A;2.500\nB;1.234.567\nC;1.234,50\nD;2.5\nE;99')).map((x) => x.precio)).toEqual(['2500', '1234567', '1234.50', '2.5', '99']);
  });
  it('rechaza formatos ambiguos o columnas de más', async () => {
    await expect(leer('A;1,234.56')).rejects.toThrow('Línea 1: precio inválido');
    await expect(leer('A,2500,50')).rejects.toThrow('Línea 1: precio inválido');
  });

  it('comillas, encabezado después de líneas vacías y número de línea del archivo', async () => {
    const r = await leer('\n\nCódigo;Precio\n"A-1";"2.500"\n\nB;10\n');
    expect(r.map((x) => [x.codigo, x.precio, x.linea])).toEqual([['A-1', '2500', 4], ['B', '10', 6]]);
    await expect(leer('Código;Precio\nA;1\n\nB;0')).rejects.toThrow('Línea 4: precio inválido');
  });
  it('xlsx con fórmulas y códigos numéricos', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('P');
    ws.addRow(['Código', 'Precio']);
    ws.addRow([1001, { formula: '1000*2', result: 2000 }]);
    const r = await leerPrecios(Buffer.from(await wb.xlsx.writeBuffer()), 'p.xlsx');
    expect(r).toEqual([{ codigo: '1001', precio: '2000', linea: 2 }]);
  });
});
