import { Prisma } from '@prisma/client';
import type { AcumuladoEmpleado } from './acumulado';
import type { TablaCalc, TipoDeduccion } from './calculo';
import { cargaAcumulada } from './tablas';
import type { TablaConTramos } from './tablas.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const cero = () => new D(0);

/** Tabla de la base (con tramos) al formato del cálculo. */
export const aTablaCalc = (t: TablaConTramos): TablaCalc => ({ ...t, tramos: t.tramos.map((x) => ({ desde: x.desde, hasta: x.hasta, fijo: x.fijo, porcentaje: x.porcentaje })) });

export type ModoGanancias = 'MENSUAL' | 'FINAL' | 'ANUAL';
export interface CargasDetalle { conyuge: Dec; hijos: Dec; incapacitados: Dec; hijos50: number; hijos100: number; incapacitados50: number; incapacitados100: number }

/**
 * Deducciones y cargas de familia del F.572 para el cálculo, a un mes y según el modo (E32 §3):
 * mensual acumula por semestre; final y anual usan el importe anual completo de la tabla (final: si estuvo vigente hasta el egreso;
 * anual: proporcional a los meses de vigencia).
 */
export function prepararDatos(a: AcumuladoEmpleado, o: { tabla: TablaCalc; c1: TablaCalc | null; c2: TablaCalc | null; mes: number; modo: ModoGanancias }) {
  const deducciones: { tipo: TipoDeduccion; importe: Dec }[] = a.f572.deducciones.map((d) => ({ tipo: d.tipo, importe: d.meses.filter((x) => x.mes <= o.mes).reduce((s, x) => s.plus(x.importe), cero()) }));
  const campo = { CONYUGE: 'conyuge', HIJO: 'hijo', HIJO_INCAPACITADO: 'hijoIncapacitado' } as const;
  const detalle: CargasDetalle = { conyuge: cero(), hijos: cero(), incapacitados: cero(), hijos50: 0, hijos100: 0, incapacitados50: 0, incapacitados100: 0 };
  const cargas = a.f572.cargas.map((c) => {
    const parentesco = (c.parentesco in campo ? c.parentesco : 'OTRO') as 'CONYUGE' | 'HIJO' | 'HIJO_INCAPACITADO' | 'OTRO';
    if (parentesco === 'OTRO' || c.mesDesde > o.mes) return { parentesco, importe: cero() };
    const k = campo[parentesco];
    const importe = o.modo === 'MENSUAL'
      ? cargaAcumulada([(o.c1 ?? o.c2)![k], (o.c2 ?? o.c1)![k]], c.mesDesde, c.mesHasta, o.mes, c.porcentaje)
      : o.modo === 'FINAL'
        ? o.tabla[k].times(c.porcentaje).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP)
        : cargaAcumulada([o.tabla[k], o.tabla[k]], c.mesDesde, c.mesHasta, 12, c.porcentaje);
    if (parentesco === 'CONYUGE') detalle.conyuge = detalle.conyuge.plus(importe);
    else if (parentesco === 'HIJO') { detalle.hijos = detalle.hijos.plus(importe); if (c.porcentaje === 50) detalle.hijos50++; else detalle.hijos100++; }
    else { detalle.incapacitados = detalle.incapacitados.plus(importe); if (c.porcentaje === 50) detalle.incapacitados50++; else detalle.incapacitados100++; }
    return { parentesco, importe };
  });
  return { deducciones, cargas, detalle };
}

