import { Prisma } from '@prisma/client';
import { TablaCalc } from './calculo';
import { SinTablaGanancias } from './retencion.service';
import { cargaAcumulada, tablaAcumulada, tablaAnual, tablaFinal } from './tablas';

const D = (x: number) => new Prisma.Decimal(x);
// Tablas oficiales 2025 (manual F.1359 v2.0, Tablas 4, 5 y 6): 1.er semestre (anual) y 2.º semestre (anual)
const tabla = (gni: number, conyuge: number, desde2: number): TablaCalc => ({
  gni: D(gni), deduccionEspecial: D(0), conyuge: D(conyuge), hijo: D(0), hijoIncapacitado: D(0),
  topeHipotecario: D(20000), topeSeguroMuerte: D(0), topeSeguroMixto: D(0), topeSeguroRetiro: D(0), topeSepelio: D(996.23),
  tramos: [{ desde: D(0), hasta: D(desde2), fijo: D(0), porcentaje: D(5) }, { desde: D(desde2), hasta: null, fijo: D(desde2 * 0.05), porcentaje: D(9) }],
});
const T1 = tabla(3916268.37, 3688339.32, 1200000);
const T2 = tabla(4507505.52, 4245166.13, 2400000);
const cerca = (x: Prisma.Decimal, esperado: number) => expect(Math.abs(Number(x) - esperado)).toBeLessThanOrEqual(0.01);

describe('Ganancias: tablas por semestre', () => {
  it('acumulado como la Tabla 5 de ARCA', () => {
    cerca(tablaAcumulada(T1, T2, 1).tabla.gni, 326355.70);
    cerca(tablaAcumulada(T1, T2, 7).tabla.gni, 2333759.65);
    cerca(tablaAcumulada(T1, T2, 9).tabla.gni, 3085010.57);
    cerca(tablaAcumulada(T1, T2, 12).tabla.gni, 4211886.94);
    expect(tablaAcumulada(T1, T2, 7).avisos).toEqual([]);
  });

  it('julio sin tabla del primer semestre', () => {
    const r = tablaAcumulada(null, T2, 7);
    cerca(r.tabla.gni, 4507505.52 * 7 / 12);
    expect(r.avisos).toEqual(['Falta la tabla de Ganancias del 1.er semestre: se usa la del 2.º para enero a junio']);
    expect(() => tablaAcumulada(T1, null, 7)).toThrow(SinTablaGanancias);
  });

  it('anual', () => {
    expect(tablaAnual(T2).gni.toFixed(2)).toBe('4507505.52');
  });

  it('final', () => {
    expect(tablaFinal(T1, T2, 3).gni.toFixed(2)).toBe('3916268.37');
    expect(tablaFinal(T1, T2, 8).gni.toFixed(2)).toBe('4507505.52');
    expect(() => tablaFinal(null, T2, 3)).toThrow(SinTablaGanancias);
  });

  it('carga de familia acumulada', () => {
    cerca(cargaAcumulada([D(3688339.32), D(4245166.13)], 1, 12, 7, 100), 2197933.50);
    cerca(cargaAcumulada([D(3688339.32), D(4245166.13)], 1, 12, 1, 50), 3688339.32 / 12 / 2);
    expect(cargaAcumulada([D(1200000), D(1200000)], 5, 12, 3, 100).toFixed(2)).toBe('0.00');
  });

  it('escala acumulada', () => {
    const t = tablaAcumulada(T1, T2, 7).tabla;
    expect(t.tramos[1].desde.toFixed(2)).toBe('800000.00');
    expect(t.tramos[1].hasta).toBeNull();
  });
});
