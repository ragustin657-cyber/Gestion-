import { reemplazar } from './plantilla';

describe('plantilla del mail', () => {
  it('reemplaza las variables conocidas y deja las desconocidas', () => {
    expect(reemplazar('Hola {cliente}, debe {vencido} {otra}', { cliente: 'Norte', vencido: '$ 1.210,00' })).toBe('Hola Norte, debe $ 1.210,00 {otra}');
  });
  it('reemplaza todas las apariciones', () => {
    expect(reemplazar('{cliente} / {cliente}', { cliente: 'A' })).toBe('A / A');
  });
});
