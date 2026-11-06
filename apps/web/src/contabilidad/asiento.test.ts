import { totalesAsiento } from './asiento';

describe('totales de un asiento', () => {
  it('suma en centavos y calcula la diferencia', () => {
    expect(totalesAsiento([{ debe: '1000.10', haber: '' }, { debe: '', haber: '1000.1' }])).toEqual({ debe: 1000.1, haber: 1000.1, diferencia: 0 });
    expect(totalesAsiento([{ debe: '100', haber: '' }, { debe: '', haber: '90' }]).diferencia).toBe(10);
    expect(totalesAsiento([{ debe: '0.1', haber: '' }, { debe: '0.2', haber: '' }, { debe: '', haber: '0.3' }]).diferencia).toBe(0);
  });
});
