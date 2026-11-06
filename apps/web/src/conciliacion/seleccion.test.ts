import { puedeConciliar, sumaSeleccion } from './seleccion';

describe('selección de la conciliación', () => {
  it('suma en centavos sin errores de coma flotante', () => {
    const items = [{ id: 'a', importe: '30000.10' }, { id: 'b', importe: '22999.90' }, { id: 'c', importe: '-1' }];
    expect(sumaSeleccion(items, ['a', 'b'])).toBe(53000);
    expect(sumaSeleccion(items, ['a', 'b', 'c'])).toBe(52999);
    expect(sumaSeleccion(items, [])).toBe(0);
  });
  it('solo se puede conciliar si hay algo de cada lado y las sumas coinciden', () => {
    expect(puedeConciliar(53000, 53000, 1, 1)).toBe(true);
    expect(puedeConciliar(53000, 52999.99, 1, 1)).toBe(false);
    expect(puedeConciliar(0, 0, 0, 1)).toBe(false);
  });
});
