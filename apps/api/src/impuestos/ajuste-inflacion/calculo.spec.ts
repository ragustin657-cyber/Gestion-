import { Prisma } from '@prisma/client';
import { ajusteImpositivo, clasificarAsiento, DatosAjusteImpositivo, mesesNecesarios, MovimientoDinamico } from './calculo';

const D = Prisma.Decimal;
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const IND: Record<string, number> = { '2025-12': 100, '2026-12': 150, '2026-03': 110, '2026-05': 120, '2026-07': 125, '2026-10': 140, '2023-12': 50 };
const mov = (fecha: string, tipo: MovimientoDinamico['tipo'], importe: number): MovimientoDinamico => ({ fecha: f(fecha), asientoNumero: 1, descripcion: tipo, tipo, importe: new D(importe) });
const MOVS = [mov('2026-05-10', 'APORTE', -100000), mov('2026-07-10', 'RETIRO', 50000), mov('2026-03-10', 'COMPRA_EXCLUIDO', 200000), mov('2026-10-10', 'VENTA_EXCLUIDO', -30000)];
const datos = (o: Partial<DatosAjusteImpositivo> = {}, ind = IND): DatosAjusteImpositivo => ({
  mesAnterior: '2025-12', mesCierre: '2026-12', activoComputable: new D(1000000), pasivoComputable: new D(400000), manualActivo: new D(0), manualPasivo: new D(0), movimientos: [],
  indice: (m) => { if (ind[m] === undefined) throw new Error(`sin índice ${m}`); return new D(ind[m]); }, ...o,
});

describe('ajuste por inflación impositivo (E45)', () => {
  it('estático: activo mayor que pasivo da ajuste negativo; con partida manual de activo', () => {
    const r = ajusteImpositivo(datos());
    expect([Number(r.base), Number(r.coeficienteEstatico), Number(r.estatico)]).toEqual([600000, 0.5, -300000]);
    expect(Number(ajusteImpositivo(datos({ manualActivo: new D(40000) })).estatico)).toBe(-320000);
  });

  it('pasivo mayor que activo: ajuste positivo', () => {
    expect(Number(ajusteImpositivo(datos({ activoComputable: new D(100000), pasivoComputable: new D(300000) })).estatico)).toBe(100000);
  });

  it('dinámico: aportes, retiros, compras y ventas de excluidos con el coeficiente de su mes', () => {
    const r = ajusteImpositivo(datos({ movimientos: MOVS }));
    expect(r.dinamico.map((m) => Number(m.ajuste))).toEqual([-25000, 10000, 72727.27, -2142.86]);
    expect([Number(r.totalDinamico), Number(r.total), Number(r.variacion36), r.corresponde, Number(r.totalDj), r.aviso]).toEqual([55584.41, -244415.59, 200, true, -244415.59, null]);
  });

  it('variación de 36 meses no supera el 100 %: no corresponde', () => {
    const r = ajusteImpositivo(datos({ movimientos: MOVS }, { ...IND, '2023-12': 80 }));
    expect([Number(r.variacion36), r.corresponde, Number(r.totalDj), r.aviso, Number(r.total)])
      .toEqual([87.5, false, 0, 'No corresponde aplicar el ajuste: la variación de los últimos 36 meses es 87,50 %', -244415.59]);
  });

  it('clasificación de asientos', () => {
    const r = (tipoCuenta: 'ACTIVO' | 'PASIVO' | 'PATRIMONIO_NETO', excluida: boolean, debe: number, haber: number) => ({ tipoCuenta, excluida, debe: new D(debe), haber: new D(haber) });
    const n = (x: { pn: Prisma.Decimal; excluidos: Prisma.Decimal }) => [Number(x.pn), Number(x.excluidos)];
    expect(n(clasificarAsiento([r('ACTIVO', false, 100, 0), r('PATRIMONIO_NETO', false, 0, 100)]))).toEqual([100, 0]);
    expect(n(clasificarAsiento([r('ACTIVO', true, 200, 0), r('ACTIVO', false, 0, 200)]))).toEqual([0, 200]);
    expect(n(clasificarAsiento([r('PATRIMONIO_NETO', false, 10, 0), r('PATRIMONIO_NETO', false, 0, 10)]))).toEqual([0, 0]);
  });

  it('meses necesarios', () => {
    expect(mesesNecesarios({ mesAnterior: '2025-12', mesCierre: '2026-12', movimientos: MOVS })).toEqual(['2023-12', '2025-12', '2026-03', '2026-05', '2026-07', '2026-10', '2026-12']);
  });
});
