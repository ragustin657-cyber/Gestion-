import { archivo, ErrorFormato, linea } from './escritor';
import type { Campo } from './campos';

const una = (c: Campo, v: unknown, registro?: number) => linea([c], { [c.nombre]: v as never }, registro);

describe('escritor de ancho fijo', () => {
  it('NUM: ceros a la izquierda; desborde lanza', () => {
    expect(una({ nombre: 'n', largo: 5, tipo: 'NUM' }, 42).texto).toBe('00042');
    try {
      una({ nombre: 'n', largo: 5, tipo: 'NUM' }, 123456);
      throw new Error('no lanzó');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorFormato);
      expect((e as ErrorFormato).campo).toBe('n');
    }
  });
  it('TXT: espacios, sin acentos y recorte con advertencia', () => {
    expect(una({ nombre: 't', largo: 6, tipo: 'TXT' }, 'Peña').texto).toBe('Pena  ');
    const r = una({ nombre: 'X', largo: 4, tipo: 'TXT' }, 'Sociedad', 3);
    expect(r.texto).toBe('Soci');
    expect(r.advertencias).toEqual(['El campo X (4) del registro 3 se recortó']);
  });
  it('IMPORTE con y sin separador; negativo lanza', () => {
    expect(una({ nombre: 'i', largo: 15, tipo: 'IMPORTE', separador: '' }, '1234.5').texto).toBe('000000000123450');
    expect(una({ nombre: 'i', largo: 16, tipo: 'IMPORTE', separador: ',' }, '50').texto).toBe('0000000000050,00');
    expect(una({ nombre: 'i', largo: 5, tipo: 'IMPORTE', separador: '.' }, '3.5').texto).toBe('03.50');
    expect(() => una({ nombre: 'i', largo: 15, tipo: 'IMPORTE', separador: '' }, '-1')).toThrow(ErrorFormato);
  });
  it('FECHA en los dos formatos, vacía', () => {
    expect(una({ nombre: 'f', largo: 8, tipo: 'FECHA', formato: 'AAAAMMDD' }, new Date('2026-11-05T00:00:00Z')).texto).toBe('20261105');
    expect(una({ nombre: 'f', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' }, new Date('2026-11-05T00:00:00Z')).texto).toBe('05/11/2026');
    expect(una({ nombre: 'f', largo: 10, tipo: 'FECHA', formato: 'DD/MM/AAAA' }, null).texto).toBe(' '.repeat(10));
    expect(una({ nombre: 'f', largo: 8, tipo: 'FECHA', formato: 'AAAAMMDD' }, null).texto).toBe('00000000');
  });
  it('FIJO y largo total exacto', () => {
    const r = linea([{ nombre: 'a', largo: 2, tipo: 'FIJO', valor: '06' }, { nombre: 'b', largo: 3, tipo: 'NUM' }], { b: 7 });
    expect(r.texto).toBe('06007');
  });
  it('archivo: latin1 con CRLF también al final', () => {
    const b = archivo(['ab', 'cd']);
    expect(b.toString('latin1')).toBe('ab\r\ncd\r\n');
    expect(archivo([]).length).toBe(0);
  });
});
