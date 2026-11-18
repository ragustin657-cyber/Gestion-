import { Injectable } from '@nestjs/common';
import { Concepto, Liquidacion, Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { RenglonCalc, ResultadoCalc } from '../calculo';
import { HojaGanancias, retencionGanancias, TipoDeduccion } from './calculo';
import { DatosF572 } from './f572-xml';
import { semestreDe, TablasGananciasService } from './tablas.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const cero = () => new D(0);
const DESTINOS_APORTE = ['SEGURIDAD_SOCIAL', 'OBRA_SOCIAL', 'SINDICAL'];
/** Renglones fijos exentos (indemnización por antigüedad, E31 §6). */
const FIJOS_EXENTOS = ['300'];

/** La tabla del semestre falta: es un error del empleado en el borrador (no deja cerrar). */
export class SinTablaGanancias extends Error {}

/** Renglón mínimo para sumar: el concepto (si tiene), su código y clase, y el importe. */
interface RenglonSuma { conceptoId: string | null; codigo: string; clase: string; importe: Dec | Prisma.Decimal.Value }

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

  /** Suma bruta gravada, aportes y retenido de un conjunto de renglones. */
  private sumar(rs: RenglonSuma[], conceptos: Map<string, Concepto>) {
    let bruta = cero(); let aportes = cero(); let retenido = cero();
    for (const x of rs) {
      const c = x.conceptoId ? conceptos.get(x.conceptoId) : undefined;
      const imp = new D(x.importe);
      if (x.clase === 'DESCUENTO') {
        if (c?.tipo === 'GANANCIAS') retenido = retenido.plus(imp);
        else if (c && DESTINOS_APORTE.includes(c.destino)) aportes = aportes.plus(imp);
      } else if (!(c?.exentoGanancias) && !(!c && FIJOS_EXENTOS.includes(x.codigo))) bruta = bruta.plus(imp);
    }
    return { bruta, aportes, retenido };
  }

  /**
   * Agrega al resultado del cálculo el renglón de Ganancias (o la devolución) y devuelve la hoja de cálculo.
   * Acumula las liquidaciones cerradas del año fiscal (año de la fecha de pago), el acumulado previo y el F.572.
   */
  async aplicar(tx: TxEmpresa, l: Liquidacion, empleadoId: string, r: ResultadoCalc, concepto: Concepto): Promise<HojaGanancias> {
    const anio = l.fechaPago.getUTCFullYear();
    const mes = l.fechaPago.getUTCMonth() + 1;
    const tabla = await this.tablas.tabla(tx, anio, mes);
    if (!tabla) throw new SinTablaGanancias(`Cargue la tabla de Ganancias de ${semestreDe(mes) === 1 ? '1.er' : '2.º'} semestre ${anio}`);
    const conceptos = new Map((await tx.concepto.findMany()).map((c) => [c.id, c]));
    const previos = await tx.reciboSueldoRenglon.findMany({
      where: { recibo: { empleadoId, liquidacionId: { not: l.id }, liquidacion: { estado: 'CERRADA', fechaPago: { gte: new Date(Date.UTC(anio, 0, 1)), lte: l.fechaPago } } } },
    });
    const ant = this.sumar(previos, conceptos);
    const actual = this.sumar(r.renglones.map((x) => ({ ...x, conceptoId: x.conceptoId === 'SAC' || x.conceptoId === 'FINAL' ? null : x.conceptoId })), conceptos);
    const acum = await tx.acumuladoGanancias.findUnique({ where: { empleadoId_anio: { empleadoId, anio } } });
    const f = await tx.f572.findUnique({ where: { empleadoId_anio: { empleadoId, anio } } });
    const datos = (f?.datos ?? { cargas: [], otrosEmpleadores: [], deducciones: [] }) as unknown as DatosF572;
    let otrosBruta = cero(); let otrosAportes = cero(); let otrosRetenido = cero();
    for (const o of datos.otrosEmpleadores) for (const x of o.meses) if (x.mes <= mes) {
      otrosBruta = otrosBruta.plus(x.bruta); otrosAportes = otrosAportes.plus(x.aportes); otrosRetenido = otrosRetenido.plus(x.retenido);
    }
    const deducciones: { tipo: TipoDeduccion; importe: Dec }[] = datos.deducciones.map((d) => ({ tipo: d.tipo, importe: d.meses.filter((x) => x.mes <= mes).reduce((s, x) => s.plus(x.importe), cero()) }));
    const cargas = datos.cargas.map((c) => ({
      parentesco: (['CONYUGE', 'HIJO', 'HIJO_INCAPACITADO'].includes(c.parentesco) ? c.parentesco : 'OTRO') as 'CONYUGE' | 'HIJO' | 'HIJO_INCAPACITADO' | 'OTRO',
      meses: Math.max(0, Math.min(c.mesHasta, mes) - c.mesDesde + 1), porcentaje: c.porcentaje,
    }));
    const retenidoEmpresa = ant.retenido.plus(acum?.retenido ?? 0);
    const brutaRecibo = new D(r.totalRemunerativo).plus(r.totalNoRemunerativo);
    const res = retencionGanancias({
      mes, deducciones, cargas, brutaRecibo, retenidoEmpresa, netoRecibo: new D(r.neto),
      tabla: { ...tabla, tramos: tabla.tramos.map((x) => ({ desde: x.desde, hasta: x.hasta, fijo: x.fijo, porcentaje: x.porcentaje })) },
      bruta: ant.bruta.plus(actual.bruta).plus(acum?.bruta ?? 0).plus(otrosBruta),
      aportes: ant.aportes.plus(actual.aportes).plus(acum?.aportes ?? 0).plus(otrosAportes),
      retenidoAnterior: retenidoEmpresa.plus(otrosRetenido),
    });
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
