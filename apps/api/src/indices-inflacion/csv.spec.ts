import { parsearCsvIndices } from './csv';

describe('parsearCsvIndices', () => {
  const error = (t: string) => { try { parsearCsvIndices(t); return null; } catch (e) { return (e as Error).message; } };
  it('lee AAAA-MM con punto y coma y coma decimal', () => {
    expect(parsearCsvIndices('2025-06;50\n2025-07;55,5')).toEqual([{ anio: 2025, mes: 6, valor: '50' }, { anio: 2025, mes: 7, valor: '55.5' }]);
  });
  it('ignora el encabezado, las líneas vacías y los \\r', () => {
    expect(parsearCsvIndices('Período,Índice\r\n06/2025,50.25\r\n\r\n')).toEqual([{ anio: 2025, mes: 6, valor: '50.25' }]);
  });
  it('acepta BOM UTF-8', () => {
    expect(parsearCsvIndices('﻿2025-06;50')).toEqual([{ anio: 2025, mes: 6, valor: '50' }]);
  });
  it('informa la línea con el error', () => {
    expect(error('2025-13;5')).toBe('Línea 1: período inválido');
    expect(error('2025-06;0')).toBe('Línea 1: valor inválido');
    expect(error('2025-06;abc')).toBe('Línea 1: valor inválido');
    expect(error('2025-06;5\n2025-06;6')).toBe('Línea 2: período repetido');
    expect(error('Periodo;Valor\nxx;5')).toBe('Línea 2: período inválido');
  });
});
