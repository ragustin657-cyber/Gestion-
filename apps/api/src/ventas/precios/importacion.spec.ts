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
});
