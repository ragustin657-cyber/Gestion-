import { Prisma } from '@prisma/client';
import { CAMPOS_F931, DatosF931, lineaF931, normalizarTexto } from './f931-diseno';

const D = (n: number | string) => new Prisma.Decimal(n);
export const datosEjemplo = (o: Partial<DatosF931> = {}): DatosF931 => ({
  cuil: '20172543597', apellidoNombre: 'Pérez Juan', conyuge: false, cantidadHijos: 0, codigoSituacion: 1, codigoCondicion: 1, codigoActividad: 49, codigoZona: 0,
  codigoModalidad: 8, codigoObraSocial: '125000', adherentes: 0, codigoSiniestrado: 0, regimen: 1, diaInicioRevista: 1, convencionado: true,
  localidad: 'Rosario', tipoEmpresa: 1, scvo: true,
  remuneracionTotal: D('1168965.00'), imponible1: D('1168965.00'), imponible2: D('1168965.00'), imponible3: D('1168965.00'), imponible4: D('1168965.00'), imponible5: D('1168965.00'),
  imponible8: D('1168965.00'), imponible9: D('1168965.00'), imponible11: D('1161961.32'), sueldoAdicionales: D('1137465.00'), sac: D(0), horasExtrasImporte: D('31500.00'),
  noRemunerativo: D(0), detraccion: D('7003.68'), diasTrabajados: 30, horasExtras: 4, ...o,
});
/** Valor del campo n de una línea. */
export function campo(linea: string, n: number): string {
  let pos = 0;
  for (const c of CAMPOS_F931) { if (c.numero === n) return linea.slice(pos, pos + c.largo); pos += c.largo; }
  throw new Error(`campo ${n}`);
}

describe('diseño F.931', () => {
  it('tabla', () => {
    expect(CAMPOS_F931).toHaveLength(60);
    expect(CAMPOS_F931.map((c) => c.numero)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(CAMPOS_F931.reduce((s, c) => s + c.largo, 0)).toBe(499);
    const inicio = (n: number) => CAMPOS_F931.filter((c) => c.numero < n).reduce((s, c) => s + c.largo, 0) + 1;
    expect([inicio(3), inicio(4), inicio(5)]).toEqual([42, 43, 45]);
    expect(CAMPOS_F931[36].largo).toBe(12);
  });

  it('línea del ejemplo', () => {
    const l = lineaF931(datosEjemplo(), 1);
    expect(l).toHaveLength(499);
    expect(l.slice(0, 11)).toBe('20172543597');
    expect(l.slice(11, 41)).toBe('PEREZ JUAN'.padEnd(30));
    expect(campo(l, 13)).toBe('  1168965,00');
    expect(campo(l, 11)).toBe('125000');
    expect(campo(l, 39)).toBe('        0,00');
    expect(campo(l, 41)).toBe('    30,00');
    expect(campo(l, 50)).toBe('004');
    expect(campo(l, 58)).toBe('     7003,68');
    expect(campo(l, 7)).toBe('049');
    expect(campo(l, 57)).toBe('1');
  });

  it('normaliza y recorta', () => {
    const l = lineaF931(datosEjemplo({ apellidoNombre: 'Muñoz Peña, María José de los Ángeles Etcheverry' }), 1);
    expect(l).toHaveLength(499);
    expect(campo(l, 2)).toHaveLength(30);
    expect(campo(l, 2).startsWith('MUNOZ PENA')).toBe(true);
    expect(normalizarTexto('Ñandú Güemes')).toBe('NANDU GUEMES');
  });

  it('importe que no entra', () => {
    expect(() => lineaF931(datosEjemplo({ imponible1: D('1000000000000') }), 7)).toThrow('El importe de Remuneración imponible 1 del legajo 7 excede el largo del archivo');
  });
});
