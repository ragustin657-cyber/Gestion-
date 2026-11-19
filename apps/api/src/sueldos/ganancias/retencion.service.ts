import { Injectable } from '@nestjs/common';
import { Concepto, Liquidacion, Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { RenglonCalc, ResultadoCalc } from '../calculo';
import { HojaGanancias, retencionGanancias, TablaCalc, TipoDeduccion } from './calculo';
import { acumuladoEmpleado, AcumuladoEmpleado, aportesTotales, brutaGravada } from './acumulado';
import { TablasGananciasService } from './tablas.service';
import { AnualGananciasService } from './anual.service';
import { cargaAcumulada, tablaAcumulada, tablaFinal } from './tablas';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const cero = () => new D(0);
export { SinTablaGanancias } from './tablas';
export { aTablaCalc, prepararDatos } from './preparar';
export type { CargasDetalle, ModoGanancias } from './preparar';
import { aTablaCalc, prepararDatos } from './preparar';

/** Retención de Ganancias de cuarta en la liquidación (spec E31 §5 y §6). */
@Injectable()
export class RetencionGananciasService {
  constructor(private readonly tenant: TenantPrisma, private readonly tablas: TablasGananciasService, private readonly anual: AnualGananciasService) {}

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

  /**
   * Ajuste anual de Ganancias (E32 §5 y §6): agrega los renglones del concepto de ajuste con lo pendiente de cada anual cerrada
   * (si la fecha de pago es posterior al cierre) y, en una final de enero a marzo, el saldo de la anual del año anterior (distracto).
   * A retener: hasta el 35 % del bruto menos la retención del mes; a devolver: sin tope.
   */
  async ajustes(tx: TxEmpresa, l: Liquidacion, empleadoId: string, r: ResultadoCalc, concepto: Concepto, conceptoGanancias: Concepto): Promise<void> {
    // Spec E32 §6 / E33: el ajuste anual va en la mensual o la final siguiente, no en el SAC ni en otros tipos
    if (l.tipo !== 'MENSUAL' && l.tipo !== 'FINAL') return;
    const anio = l.fechaPago.getUTCFullYear();
    const bruta = new D(r.totalRemunerativo).plus(r.totalNoRemunerativo);
    const retMes = r.renglones.filter((x) => x.conceptoId === conceptoGanancias.id).reduce((s, x) => s.plus(x.importe), cero());
    // Tope: 35 % del bruto menos la retención del mes, y nunca más que el neto que queda (revisión E32)
    let disponible = D.max(D.min(bruta.times(0.35).minus(retMes), new D(r.neto)), 0);
    const agregar = (anioAjuste: number, pendiente: Dec) => {
      const importe = (pendiente.gt(0) ? D.min(pendiente, disponible) : pendiente).toDecimalPlaces(2, D.ROUND_HALF_UP);
      if (importe.isZero()) return;
      if (importe.gt(0)) disponible = disponible.minus(importe);
      r.renglones.push({ conceptoId: concepto.id, codigo: concepto.codigo, nombre: `${concepto.nombre} ${anioAjuste}`, clase: 'DESCUENTO', cantidad: null, base: null, porcentaje: null, importe, orden: concepto.orden, anioAjusteGanancias: anioAjuste });
      r.totalDescuentos = new D(r.totalDescuentos).plus(importe);
      r.neto = new D(r.neto).minus(importe);
    };
    const filas = await this.pendientes(tx, empleadoId, l);
    for (const f of filas) agregar(f.anio, f.pendiente);
    // Distracto: la final de enero a marzo liquida la anual del año anterior si el empleado no está en una anual cerrada
    if (!filas.some((f) => f.anio === anio - 1) && (await this.esDistracto(tx, l, empleadoId))) {
      agregar(anio - 1, (await this.anual.anualDeEmpleado(tx, empleadoId, anio - 1)).saldo);
    }
  }

  /**
   * Saldos de anuales cerradas antes del pago, menos lo ya aplicado en liquidaciones cerradas (cualquier concepto de ajuste: se cuenta
   * por anioAjusteGanancias, E33), sin contar la liquidación en cálculo.
   */
  private async pendientes(tx: TxEmpresa, empleadoId: string, l: Liquidacion) {
    const filas = await tx.liquidacionAnualGananciasEmpleado.findMany({ where: { empleadoId, distracto: false, anual: { estado: 'CERRADA', cerradoEn: { lt: l.fechaPago } } }, include: { anual: true }, orderBy: { anual: { anio: 'asc' } } });
    const out: { anio: number; pendiente: Dec }[] = [];
    for (const f of filas) {
      const aplicado = await tx.reciboSueldoRenglon.aggregate({ where: { anioAjusteGanancias: f.anual.anio, recibo: { empleadoId, liquidacionId: { not: l.id }, liquidacion: { estado: 'CERRADA' } } }, _sum: { importe: true } });
      out.push({ anio: f.anual.anio, pendiente: new D(f.saldo).minus(aplicado._sum.importe ?? 0) });
    }
    return out;
  }

  /** Hay ajuste anual pendiente para alguno de los empleados (para avisar si no hay concepto de ajuste activo, E33). */
  async pendientesSinConcepto(tx: TxEmpresa, empleadoIds: string[], l: Liquidacion): Promise<boolean> {
    if (l.tipo !== 'MENSUAL' && l.tipo !== 'FINAL') return false;
    for (const id of empleadoIds) if ((await this.pendientes(tx, id, l)).some((p) => !p.pendiente.isZero())) return true;
    return false;
  }

  /** Distracto (E32 §6): final pagada de enero a marzo, empleado con recibos cerrados del año anterior y fuera de una anual cerrada. */
  private async esDistracto(tx: TxEmpresa, l: Liquidacion, empleadoId: string) {
    const anio = l.fechaPago.getUTCFullYear();
    if (l.tipo !== 'FINAL' || l.fechaPago.getUTCMonth() >= 3) return false;
    if (await tx.liquidacionAnualGananciasEmpleado.findFirst({ where: { empleadoId, distracto: false, anual: { anio: anio - 1, estado: 'CERRADA' } } })) return false;
    return (await tx.reciboSueldo.count({ where: { empleadoId, liquidacion: { estado: 'CERRADA', fechaPago: { gte: new Date(Date.UTC(anio - 1, 0, 1)), lt: new Date(Date.UTC(anio, 0, 1)) } } } })) > 0;
  }

  /** Al cerrar una final con distracto, guarda la fila de la anual del año anterior (E32 §6); al reabrir se borra. */
  async guardarDistracto(tx: TxEmpresa, l: Liquidacion) {
    const anio = l.fechaPago.getUTCFullYear() - 1;
    if (l.tipo !== 'FINAL') return;
    // Por los empleados de la final, no por los renglones 561: un distracto con ajuste 0 también va en el F.1359 de distracto
    const empleados: string[] = [];
    for (const r of await tx.reciboSueldo.findMany({ where: { liquidacionId: l.id }, select: { empleadoId: true } })) if (await this.esDistracto(tx, l, r.empleadoId)) empleados.push(r.empleadoId);
    if (!empleados.length) return;
    const encabezado = await tx.liquidacionAnualGanancias.upsert({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio } }, update: {}, create: { empresaId: this.tenant.empresaId, anio } });
    for (const empleadoId of empleados) {
      const a = await this.anual.anualDeEmpleado(tx, empleadoId, anio);
      const datos = { distracto: true, liquidacionFinalId: l.id, hoja: a.hoja as unknown as Prisma.InputJsonValue, f1359: a.f1359 as unknown as Prisma.InputJsonValue, impuesto: a.impuesto, retenido: a.retenido, pagosACuenta: a.pagosACuenta, saldo: a.saldo };
      await tx.liquidacionAnualGananciasEmpleado.upsert({ where: { anualId_empleadoId: { anualId: encabezado.id, empleadoId } }, update: datos, create: { ...datos, empresaId: this.tenant.empresaId, anualId: encabezado.id, empleadoId } });
    }
  }

  borrarDistracto(tx: TxEmpresa, liquidacionId: string) {
    return tx.liquidacionAnualGananciasEmpleado.deleteMany({ where: { liquidacionFinalId: liquidacionId, distracto: true } });
  }
}
