import { Injectable } from '@nestjs/common';
import { Concepto, Liquidacion, Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { RenglonCalc, ResultadoCalc } from '../calculo';
import { HojaGanancias, retencionGanancias, TablaCalc, TipoDeduccion } from './calculo';
import { acumuladoEmpleado, AcumuladoEmpleado, aportesTotales, brutaGravada } from './acumulado';
import { TablaConTramos, TablasGananciasService } from './tablas.service';
import { cargaAcumulada, tablaAcumulada, tablaFinal } from './tablas';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const cero = () => new D(0);
/** Tabla de la base (con tramos) al formato del cálculo. */
export const aTablaCalc = (t: TablaConTramos): TablaCalc => ({ ...t, tramos: t.tramos.map((x) => ({ desde: x.desde, hasta: x.hasta, fijo: x.fijo, porcentaje: x.porcentaje })) });
export { SinTablaGanancias } from './tablas';

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

/** Retención de Ganancias de cuarta en la liquidación (spec E31 §5 y §6). */
@Injectable()
export class RetencionGananciasService {
  constructor(private readonly tenant: TenantPrisma, private readonly tablas: TablasGananciasService) {}

  /** ¿Corresponde retener en esta empresa? (agente de retención y con el concepto de Ganancias activo). */
  async concepto(tx: TxEmpresa): Promise<Concepto | null> {
    const e = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId }, select: { agenteRetencionGanancias: true } });
    if (!e.agenteRetencionGanancias) return null;
    return tx.concepto.findFirst({ where: { tipo: 'GANANCIAS', activo: true }, orderBy: { codigo: 'asc' } });
  }

  /**
   * Agrega al resultado del cálculo el renglón de Ganancias (o la devolución) y devuelve la hoja de cálculo.
   * Acumula las liquidaciones cerradas del año fiscal (año de la fecha de pago), el acumulado previo y el F.572.
   */
  async aplicar(tx: TxEmpresa, l: Liquidacion, empleadoId: string, r: ResultadoCalc, concepto: Concepto): Promise<HojaGanancias> {
    const anio = l.fechaPago.getUTCFullYear();
    const mes = l.fechaPago.getUTCMonth() + 1;
    const { t1, t2 } = await this.tablas.tablasDelAnio(tx, anio);
    const c1 = t1 ? aTablaCalc(t1) : null;
    const c2 = t2 ? aTablaCalc(t2) : null;
    // Mensual: acumulada por semestre (E32 §3); final: valores anuales completos del semestre de pago (manual §2.2)
    const esFinal = l.tipo === 'FINAL';
    let avisos: string[] = [];
    let tabla: TablaCalc;
    if (esFinal) tabla = tablaFinal(c1, c2, mes, anio);
    else ({ tabla, avisos } = tablaAcumulada(c1, c2, mes, anio));
    const a = await acumuladoEmpleado(tx, empleadoId, anio, { fechaPago: l.fechaPago, mes, excluirLiquidacionId: l.id, incluirRecibo: r.renglones });
    const { deducciones, cargas } = prepararDatos(a, { tabla, c1, c2, mes, modo: esFinal ? 'FINAL' : 'MENSUAL' });
    const retenidoEmpresa = a.retenido.plus(a.previo.retenido);
    const brutaRecibo = new D(r.totalRemunerativo).plus(r.totalNoRemunerativo);
    const res = retencionGanancias({
      mes, deducciones, cargas, brutaRecibo, retenidoEmpresa, pagosACuenta: a.pagosACuenta, netoRecibo: new D(r.neto), tabla,
      bruta: brutaGravada(a), aportes: aportesTotales(a), retenidoAnterior: retenidoEmpresa.plus(a.otros.retenido),
    });
    res.hoja.avisos.unshift(...avisos);
    if (!res.importe.isZero()) {
      const renglon: RenglonCalc = {
        conceptoId: concepto.id, codigo: concepto.codigo, nombre: concepto.nombre, clase: 'DESCUENTO', cantidad: null,
        base: new D(res.hoja.sujeta), porcentaje: new D(res.hoja.tramo.porcentaje), importe: res.importe, orden: concepto.orden,
      };
      r.renglones.push(renglon);
      r.totalDescuentos = new D(r.totalDescuentos).plus(res.importe);
      r.neto = new D(r.neto).minus(res.importe);
    }
    return res.hoja;
  }
}
