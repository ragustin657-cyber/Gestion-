import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Concepto, Liquidacion, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { NumeracionService } from '../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { ConceptoCalc, diasTrabajados, diasVacacionesCorresponden, liquidarFinal, liquidarMes, liquidarSac, NovedadCalc, remuneracionMesCompleto, ResultadoCalc, validarConcepto } from './calculo';
import { basicosVigentes, topeVigente } from './maestros.service';
import { ContabilizacionService } from './contabilizacion.service';
import { ContribucionesService } from './contribuciones.service';
import { PagosSueldosService } from './pagos.service';
import { RetencionGananciasService, SinTablaGanancias } from './ganancias/retencion.service';
import type { HojaGanancias } from './ganancias/calculo';

const D = Prisma.Decimal;
const mmaaaa = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);
const f2 = (x: Prisma.Decimal | null) => (x === null ? null : new D(x).toFixed(2));
const semestre = (mes: number): 1 | 2 => (mes <= 6 ? 1 : 2);
const mesesSemestre = (s: 1 | 2) => (s === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12]);

export interface NovedadEntrada { tipo: 'HORAS_EXTRA_50' | 'HORAS_EXTRA_100' | 'AUSENCIA_INJUSTIFICADA' | 'IMPORTE'; conceptoId?: string | null; cantidad?: number | null; importe?: number | null; detalle?: string | null }

const aCalc = (c: Concepto): ConceptoCalc => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, clase: c.clase, tipo: c.tipo, parametros: (c.parametros ?? {}) as Record<string, unknown>, orden: c.orden, soloAfiliados: c.soloAfiliados });

@Injectable()
export class LiquidacionesService {
  constructor(private readonly tenant: TenantPrisma, private readonly numeracion: NumeracionService, private readonly cls: ClsService, private readonly contabilizacion: ContabilizacionService, private readonly contribuciones: ContribucionesService, private readonly pagos: PagosSueldosService, private readonly retencion: RetencionGananciasService) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  async listar() {
    const ls = await this.tenant.db.liquidacion.findMany({ orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { tipo: 'asc' }], include: { recibos: { select: { neto: true } } } });
    const egresos = await this.tenant.db.egresoEmpleado.findMany({ where: { liquidacionId: { in: ls.filter((l) => l.tipo === 'FINAL').map((l) => l.id) } } });
    const emps = new Map((await this.tenant.db.empleado.findMany({ where: { id: { in: egresos.map((e) => e.empleadoId) } }, select: { id: true, legajo: true, apellido: true, nombre: true } })).map((e) => [e.id, e]));
    const empDe = (id: string) => { const eg = egresos.find((x) => x.liquidacionId === id); return eg ? emps.get(eg.empleadoId) ?? null : null; };
    return ls.map(({ recibos, ...l }) => ({ ...l, fechaPago: l.fechaPago.toISOString().slice(0, 10), empleados: recibos.length, totalNeto: recibos.reduce((s, r) => s.plus(r.neto), new D(0)).toFixed(2), ...(l.tipo === 'FINAL' ? { empleado: empDe(l.id) } : {}) }));
  }

  /** Bloquea la liquidación hasta el fin de la transacción (serializa cerrar, reabrir, contabilizar y pagar). */
  private async bloquear(tx: TxEmpresa, id: string) {
    await tx.$queryRawUnsafe(`SELECT id FROM "Liquidacion" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, id, this.tenant.empresaId);
  }

  private async liquidacion(tx: TxEmpresa, id: string, paraModificar = false) {
    const l = await tx.liquidacion.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Liquidación inexistente');
    if (paraModificar && l.estado === 'CERRADA') throw new BadRequestException('La liquidación está cerrada');
    return l;
  }

  crear(d: { tipo: 'MENSUAL' | 'SAC'; anio: number; mes: number; fechaPago: string }) {
    return this.tenant.transaccion(async (tx) => {
      if (d.tipo === 'SAC' && d.mes !== 6 && d.mes !== 12) throw new BadRequestException('El SAC se liquida en junio o diciembre');
      if (await tx.liquidacion.findFirst({ where: { tipo: d.tipo, anio: d.anio, mes: d.mes } }))
        throw new BadRequestException(`Ya existe la liquidación ${d.tipo === 'SAC' ? 'de SAC' : 'mensual'} de ${mmaaaa(d.anio, d.mes)}`);
      if (d.tipo === 'SAC' && !(await this.mensualesCerradas(tx, d.anio, semestre(d.mes))).length) throw new BadRequestException('No hay liquidaciones mensuales cerradas en el semestre');
      const numero = await this.numeracion.siguiente(tx, 'LIQUIDACION_SUELDO', 0);
      const l = await tx.liquidacion.create({ data: { empresaId: this.tenant.empresaId, numero, tipo: d.tipo, anio: d.anio, mes: d.mes, fechaPago: aFecha(d.fechaPago), creadoPor: this.usuario() } });
      await this.calcular(tx, l);
      return { id: l.id, numero };
    });
  }

  /** Mejor remuneración del último año y del semestre (spec E20 §4): manual, o el máximo entre los recibos mensuales cerrados y el mes completo del egreso. */
  private async mejoresRemuneraciones(tx: TxEmpresa, empleadoId: string, eg: { fechaEgreso: Date; mejorRemuneracion: Prisma.Decimal | null }, mesCompleto: Prisma.Decimal) {
    if (eg.mejorRemuneracion) return { mejor: new D(eg.mejorRemuneracion), mejorSemestre: new D(eg.mejorRemuneracion) };
    const anio = eg.fechaEgreso.getUTCFullYear(), mes = eg.fechaEgreso.getUTCMonth() + 1, idx = anio * 12 + mes;
    const rs = await tx.reciboSueldo.findMany({ where: { empleadoId, liquidacion: { tipo: 'MENSUAL', estado: 'CERRADA' } }, include: { liquidacion: { select: { anio: true, mes: true } }, renglones: { where: { vacacionPeriodoId: { not: null } } } } });
    let mejor = new D(mesCompleto), mejorSemestre = new D(mesCompleto);
    for (const r of rs) {
      const i = r.liquidacion.anio * 12 + r.liquidacion.mes;
      // Base indemnizatoria: sin la diferencia neta de vacaciones (150 + 151), E21 §11.3; el SAC sí la incluye
      const sinVacaciones = new D(r.totalRemunerativo).minus(r.renglones.reduce((t, x) => t.plus(x.importe), new D(0)));
      if (i >= idx - 12 && i <= idx && sinVacaciones.gt(mejor)) mejor = sinVacaciones;
      if (r.liquidacion.anio === anio && semestre(r.liquidacion.mes) === semestre(mes) && i <= idx && new D(r.totalRemunerativo).gt(mejorSemestre)) mejorSemestre = new D(r.totalRemunerativo);
    }
    return { mejor, mejorSemestre };
  }

  private async egresoSalida(tx: TxEmpresa, liquidacionId: string) {
    const eg = await tx.egresoEmpleado.findUnique({ where: { liquidacionId } });
    if (!eg) return null;
    const e = await tx.empleado.findUnique({ where: { id: eg.empleadoId }, select: { id: true, legajo: true, apellido: true, nombre: true } });
    return { causa: eg.causa, fechaEgreso: eg.fechaEgreso.toISOString().slice(0, 10), preavisoOtorgado: eg.preavisoOtorgado, mejorRemuneracion: eg.mejorRemuneracion?.toFixed(2) ?? null, gratificacion: eg.gratificacion.toFixed(2), empleado: e };
  }

  /** Días de vacaciones para la final (E21 §6): pendientes de años anteriores, tomados y saldo inicial del año del egreso. */
  private async vacacionesFinal(tx: TxEmpresa, e: { id: string; fechaIngreso: Date; fechaEgreso: Date | null }, egreso: Date) {
    const anio = egreso.getUTCFullYear();
    const inicio = (await tx.configuracionSueldos.findFirst())?.anioInicioVacaciones ?? anio;
    const saldosIniciales = await tx.vacacionSaldoInicial.findMany({ where: { empleadoId: e.id } });
    const periodos = await tx.vacacionPeriodo.findMany({ where: { empleadoId: e.id } });
    const desde = Math.min(inicio, ...saldosIniciales.map((x) => x.anio));
    let pendientesAnteriores = 0;
    for (let a = Math.max(desde, e.fechaIngreso.getUTCFullYear()); a < anio; a++) {
      const si = saldosIniciales.find((x) => x.anio === a);
      const corresponden = si ? si.dias : a >= inicio ? diasVacacionesCorresponden(e.fechaIngreso, null, a) : 0;
      const tomados = periodos.filter((p) => p.anio === a).reduce((t, p) => t + p.dias, 0);
      pendientesAnteriores += Math.max(0, corresponden - tomados);
    }
    // Tomados del año del egreso: los que empiezan en el mes del egreso se pagan en la final hasta el egreso (recortados);
    // los anteriores ya se pagaron enteros (en su mensual o fuera del sistema) y cuentan enteros
    const iniMesEgreso = new Date(Date.UTC(anio, egreso.getUTCMonth(), 1));
    const tomadosAnio = periodos.filter((p) => p.anio === anio && p.desde <= egreso)
      .reduce((t, p) => t + (p.desde >= iniMesEgreso ? Math.round(((p.hasta < egreso ? p.hasta : egreso).getTime() - p.desde.getTime()) / 86400000) + 1 : p.dias), 0);
    return { diasVacacionesPendientesAnteriores: pendientesAnteriores, diasVacacionesTomadosAnio: tomadosAnio, saldoInicialAnio: saldosIniciales.find((x) => x.anio === anio)?.dias ?? null };
  }

  /** Recalcula una liquidación en borrador dentro de una transacción (usado por los egresos). */
  async recalcularEn(tx: TxEmpresa, id: string) {
    await this.bloquear(tx, id);
    const l = await tx.liquidacion.findUnique({ where: { id } });
    if (l && l.estado === 'BORRADOR') await this.calcular(tx, l);
  }

  private mensualesCerradas(tx: TxEmpresa, anio: number, s: 1 | 2) {
    return tx.liquidacion.findMany({ where: { tipo: 'MENSUAL', anio, mes: { in: mesesSemestre(s) }, estado: 'CERRADA' } });
  }

  /** Recalcula los recibos del borrador (conserva el número de los que ya lo tenían). */
  private async calcular(tx: TxEmpresa, l: Liquidacion): Promise<{ errores: { empleadoId: string; mensaje: string }[]; aviso?: string }> {
    const ini = new Date(Date.UTC(l.anio, l.tipo === 'SAC' ? (semestre(l.mes) === 1 ? 0 : 6) : l.mes - 1, 1));
    const fin = new Date(Date.UTC(l.anio, l.mes, 0));
    const previos = new Map((await tx.reciboSueldo.findMany({ where: { liquidacionId: l.id } })).map((r) => [r.empleadoId, r]));
    // Con fecha de egreso decide la fecha (un empleado dado de baja en el período cobra sus días aunque esté inactivo);
    // los que ya tienen recibo numerado (liquidación reabierta) se conservan siempre.
    const numerados = [...previos.values()].filter((r) => r.numero !== null).map((r) => r.empleadoId);
    const egreso = l.tipo === 'FINAL' ? await tx.egresoEmpleado.findUnique({ where: { liquidacionId: l.id } }) : null;
    // Quienes tienen una liquidación final con egreso en el período (mes de la mensual o semestre del SAC) no entran
    const conFinal = l.tipo === 'FINAL' ? new Set<string>() : new Set((await tx.egresoEmpleado.findMany({
      // egreso hasta el fin del período: también los que se fueron en un mes anterior (su recibo numerado no se conserva)
      where: { fechaEgreso: { lte: fin }, liquidacion: { tipo: 'FINAL' } }, select: { empleadoId: true },
    })).map((x) => x.empleadoId));
    const empleados = l.tipo === 'FINAL'
      ? await tx.empleado.findMany({ where: { id: egreso?.empleadoId ?? '00000000-0000-0000-0000-000000000000' } })
      : (await tx.empleado.findMany({
        where: { fechaIngreso: { lte: fin }, OR: [{ activo: true, fechaEgreso: null }, { fechaEgreso: { gte: l.tipo === 'SAC' ? fin : ini } }] },
        orderBy: { legajo: 'asc' },
      })).filter((e) => !conFinal.has(e.id));
    // Recibos numerados de empleados que ya no corresponden (baja cargada después del cierre): quedan como se emitieron,
    // salvo que el empleado tenga una liquidación final en el período (la final reemplaza a la mensual)
    const conservados = numerados.filter((id) => !empleados.some((e) => e.id === id) && !conFinal.has(id));
    const categorias = new Map((await tx.categoria.findMany({ include: { convenio: true } })).map((c) => [c.id, c]));
    const conceptos = (await tx.concepto.findMany({ where: { activo: true } }));
    const basicos = await basicosVigentes(tx, [...new Set(empleados.map((e) => e.categoriaId))], l.anio, l.mes);
    const novedades = await tx.novedad.findMany({ where: { liquidacionId: l.id } });
    // Vacaciones que empiezan en el mes (las liquidadas fuera del sistema no se pagan)
    const vacacionesMes = await tx.vacacionPeriodo.findMany({ where: { empleadoId: { in: empleados.map((e) => e.id) }, liquidadoAfuera: false, desde: { gte: new Date(Date.UTC(l.anio, l.mes - 1, 1)), lte: fin } }, orderBy: { desde: 'asc' } });
    const param = await this.contribuciones.parametros(tx, l.anio, l.mes);
    let aviso: string | undefined = param.aviso;
    let mejores = new Map<string, Prisma.Decimal>();
    if (l.tipo === 'SAC') {
      const cerradas = await this.mensualesCerradas(tx, l.anio, semestre(l.mes));
      if (!cerradas.some((x) => x.mes === l.mes)) aviso = `La liquidación mensual de ${mmaaaa(l.anio, l.mes)} no está cerrada: no se considera en la mejor remuneración`;
      const rs = await tx.reciboSueldo.findMany({ where: { liquidacionId: { in: cerradas.map((x) => x.id) } } });
      mejores = new Map();
      for (const r of rs) if (!mejores.has(r.empleadoId) || new D(r.totalRemunerativo).gt(mejores.get(r.empleadoId)!)) mejores.set(r.empleadoId, new D(r.totalRemunerativo));
    }
    const errores: { empleadoId: string; mensaje: string }[] = [];
    const vigentes = new Set<string>(conservados);
    // Ganancias de cuarta (E31): solo si la empresa es agente de retención y tiene el concepto activo
    const conceptoGanancias = await this.retencion.concepto(tx);
    const conceptoAjuste = conceptoGanancias ? await tx.concepto.findFirst({ where: { tipo: 'GANANCIAS_AJUSTE', activo: true }, orderBy: { codigo: 'asc' } }) : null;
    for (const e of empleados) {
      const cat = categorias.get(e.categoriaId)!;
      if (!cat.activa) { errores.push({ empleadoId: e.id, mensaje: `La categoría ${cat.nombre} está inactiva` }); continue; }
      const basico = basicos.get(e.categoriaId);
      if (!basico) { errores.push({ empleadoId: e.id, mensaje: `Falta la escala de ${cat.nombre} para ${mmaaaa(l.anio, l.mes)}` }); continue; }
      const cs = conceptos.filter((c) => !c.convenioId || c.convenioId === cat.convenioId).map(aCalc);
      const invalido = cs.map((c) => ({ c, error: validarConcepto(c.tipo, c.clase, c.parametros) })).find((x) => x.error);
      if (invalido) { errores.push({ empleadoId: e.id, mensaje: `El concepto ${invalido.c.codigo} ${invalido.c.nombre} tiene parámetros inválidos: ${invalido.error}` }); continue; }
      const calcE = { fechaIngreso: e.fechaIngreso, fechaEgreso: e.fechaEgreso, afiliadoSindicato: e.afiliadoSindicato, basicoMensual: basico, horasMensuales: cat.convenio.horasMensuales };
      let r: ResultadoCalc;
      if (l.tipo === 'FINAL' && egreso) {
        const nov: NovedadCalc[] = novedades.filter((n) => n.empleadoId === e.id).map((n) => ({ tipo: n.tipo, conceptoId: n.conceptoId, cantidad: n.cantidad ? new D(n.cantidad) : null, importe: n.importe ? new D(n.importe) : null }));
        const { mejor, mejorSemestre } = await this.mejoresRemuneraciones(tx, e.id, egreso, remuneracionMesCompleto(calcE, cs, l.anio, l.mes));
        const tope = await topeVigente(tx, cat.convenioId, l.anio, l.mes);
        if (!tope && egreso.causa === 'DESPIDO_SIN_CAUSA') aviso = [aviso, `No hay tope indemnizatorio cargado para ${cat.convenio.nombre}`].filter(Boolean).join('. ');
        const vac = await this.vacacionesFinal(tx, e, egreso.fechaEgreso);
        const vacMes = vacacionesMes.filter((v) => v.empleadoId === e.id && v.desde <= egreso.fechaEgreso)
          .map((v) => ({ periodoId: v.id, dias: Math.round(((v.hasta < egreso.fechaEgreso ? v.hasta : egreso.fechaEgreso).getTime() - v.desde.getTime()) / 86400000) + 1 }));
        r = liquidarFinal(calcE, cs, nov, { causa: egreso.causa, fechaEgreso: egreso.fechaEgreso, preavisoOtorgado: egreso.preavisoOtorgado, mejorRemuneracion: mejor, mejorRemuneracionSemestre: mejorSemestre, topeIndemnizatorio: tope, baseMaxima: param.baseMaxima, gratificacion: egreso.gratificacion, ...vac, vacaciones: vacMes });
      } else if (l.tipo === 'SAC') {
        const mejor = mejores.get(e.id);
        if (!mejor) continue; // sin sueldos cerrados en el semestre
        r = liquidarSac(calcE, cs, mejor, l.anio, semestre(l.mes), param.baseMaxima);
      } else {
        const nov: NovedadCalc[] = novedades.filter((n) => n.empleadoId === e.id).map((n) => ({ tipo: n.tipo, conceptoId: n.conceptoId, cantidad: n.cantidad ? new D(n.cantidad) : null, importe: n.importe ? new D(n.importe) : null }));
        r = liquidarMes(calcE, cs, nov, l.anio, l.mes, param.baseMaxima, vacacionesMes.filter((v) => v.empleadoId === e.id).map((v) => ({ periodoId: v.id, dias: v.dias })));
      }
      let hojaGanancias: HojaGanancias | null = null;
      if (conceptoGanancias) {
        try {
          hojaGanancias = await this.retencion.aplicar(tx, l, e.id, r, conceptoGanancias);
          if (conceptoAjuste) await this.retencion.ajustes(tx, l, e.id, r, conceptoAjuste, conceptoGanancias);
        } catch (err) {
          if (!(err instanceof SinTablaGanancias)) throw err;
          errores.push({ empleadoId: e.id, mensaje: err.message });
          continue;
        }
      }
      vigentes.add(e.id);
      const datos = {
        hojaGanancias: hojaGanancias ? (hojaGanancias as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        apellido: e.apellido, nombre: e.nombre, cuil: e.cuil, legajo: e.legajo, categoria: cat.nombre, basico, fechaIngreso: e.fechaIngreso, antiguedadAnios: r.antiguedadAnios, diasTrabajados: r.diasTrabajados,
        totalRemunerativo: r.totalRemunerativo, totalNoRemunerativo: r.totalNoRemunerativo, totalDescuentos: r.totalDescuentos, neto: r.neto, centroCostoId: e.centroCostoId, formaPago: e.formaPago,
      };
      const previo = previos.get(e.id);
      const recibo = previo
        ? await tx.reciboSueldo.update({ where: { id: previo.id }, data: datos })
        : await tx.reciboSueldo.create({ data: { ...datos, empresaId: this.tenant.empresaId, liquidacionId: l.id, empleadoId: e.id } });
      await tx.reciboSueldoRenglon.deleteMany({ where: { reciboId: recibo.id } });
      if (r.renglones.length) await tx.reciboSueldoRenglon.createMany({
        data: r.renglones.map((x) => ({ empresaId: this.tenant.empresaId, reciboId: recibo.id, conceptoId: x.conceptoId === 'SAC' || x.conceptoId === 'FINAL' ? null : x.conceptoId, vacacionPeriodoId: x.vacacionPeriodoId ?? null, anioAjusteGanancias: x.anioAjusteGanancias ?? null, codigo: x.codigo, nombre: x.nombre, clase: x.clase, cantidad: x.cantidad, base: x.base, porcentaje: x.porcentaje, importe: x.importe, orden: x.orden })),
      });
    }
    // Recibos de empleados que ya no corresponden (o que ahora tienen error): se eliminan
    const sobran = [...previos.values()].filter((p) => !vigentes.has(p.empleadoId)).map((p) => p.id);
    if (sobran.length) await tx.reciboSueldo.deleteMany({ where: { id: { in: sobran } } });
    return { errores, ...(aviso ? { aviso } : {}) };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const l = await this.liquidacion(tx, id);
    const { errores, aviso } = l.estado === 'BORRADOR' ? await this.estadoBorrador(tx, l) : { errores: [], aviso: undefined };
    const recibos = await tx.reciboSueldo.findMany({ where: { liquidacionId: id }, include: { renglones: { orderBy: { orden: 'asc' } } }, orderBy: { legajo: 'asc' } });
    const novedades = await tx.novedad.findMany({ where: { liquidacionId: id } });
    const pagados = await this.pagos.recibosPagados(tx, id);
    const sinObraSocial = (await tx.empleado.findMany({ where: { id: { in: recibos.map((r) => r.empleadoId) }, codigoObraSocial: '000000' }, select: { legajo: true }, orderBy: { legajo: 'asc' } })).map((e) => e.legajo);
    const avisos = [aviso, ...sinObraSocial.map((n) => `Falta el código de obra social de ${n}`)].filter(Boolean);
    const tot = recibos.reduce((s, r) => ({ remunerativo: s.remunerativo.plus(r.totalRemunerativo), noRemunerativo: s.noRemunerativo.plus(r.totalNoRemunerativo), descuentos: s.descuentos.plus(r.totalDescuentos), neto: s.neto.plus(r.neto) }), { remunerativo: new D(0), noRemunerativo: new D(0), descuentos: new D(0), neto: new D(0) });
    return {
      ...l, fechaPago: l.fechaPago.toISOString().slice(0, 10), ultimoDepositoFecha: l.ultimoDepositoFecha?.toISOString().slice(0, 10) ?? null,
      errores, ...(avisos.length ? { aviso: avisos.join(". ") } : {}),
      recibos: recibos.map((r) => ({
        ...r, pagado: pagados.has(r.id), sinNeto: !new D(r.neto).gt(0), fechaIngreso: r.fechaIngreso.toISOString().slice(0, 10), basico: f2(r.basico), totalRemunerativo: f2(r.totalRemunerativo), totalNoRemunerativo: f2(r.totalNoRemunerativo), totalDescuentos: f2(r.totalDescuentos), neto: f2(r.neto),
        renglones: r.renglones.map((x) => ({ ...x, importe: f2(x.importe), base: f2(x.base), cantidad: x.cantidad === null ? null : new D(x.cantidad).toString(), porcentaje: x.porcentaje === null ? null : new D(x.porcentaje).toString() })),
        novedades: novedades.filter((n) => n.empleadoId === r.empleadoId).map((n) => ({ ...n, cantidad: n.cantidad === null ? null : Number(n.cantidad), importe: n.importe === null ? null : Number(n.importe) })),
      })),
      pagos: await this.pagos.pagosDeLiquidacion(tx, id),
      // Los recibos sin neto a pagar (≤ 0) no quedan pendientes (E22 §2.1)
      pendientePago: recibos.filter((r) => !pagados.has(r.id) && new D(r.neto).gt(0)).reduce((s, r) => s.plus(r.neto), new D(0)).toFixed(2),
      egreso: await this.egresoSalida(tx, id),
      asiento: l.asientoId ? await tx.asiento.findUnique({ where: { id: l.asientoId }, select: { id: true, numero: true } }) : null,
      contribuciones: await this.contabilizacion.resumen(tx, await this.liquidacion(tx, id)),
      totales: { remunerativo: tot.remunerativo.toFixed(2), noRemunerativo: tot.noRemunerativo.toFixed(2), descuentos: tot.descuentos.toFixed(2), neto: tot.neto.toFixed(2) },
    };
  }

  /** Errores y aviso del borrador sin grabar (se recalculan en una transacción que se descarta). */
  private async estadoBorrador(tx: TxEmpresa, l: Liquidacion) {
    // El cálculo es idempotente: recalcular al consultar mantiene el borrador al día (escalas o empleados nuevos)
    // Dos consultas simultáneas se serializan con el bloqueo de la liquidación (E22 §2.5); si se cerró mientras tanto, no se toca
    const recalcular = async (t: TxEmpresa) => {
      await this.bloquear(t, l.id);
      const actual = await t.liquidacion.findUniqueOrThrow({ where: { id: l.id } });
      return actual.estado === 'BORRADOR' ? this.calcular(t, actual) : { errores: [], aviso: undefined };
    };
    return this.tenant.db === tx ? this.tenant.transaccion(recalcular) : recalcular(tx);
  }

  guardarNovedades(id: string, empleadoId: string, novedades: NovedadEntrada[]) {
    return this.tenant.transaccion(async (tx) => {
      const l = await this.liquidacion(tx, id, true);
      if (l.tipo === 'SAC') throw new BadRequestException('El SAC no tiene novedades');
      const emp = await tx.empleado.findUnique({ where: { id: empleadoId } });
      if (!emp) throw new BadRequestException('Empleado inexistente');
      if (l.tipo === 'FINAL' && (await tx.egresoEmpleado.findUnique({ where: { liquidacionId: id } }))?.empleadoId !== empleadoId) throw new BadRequestException('La liquidación final es de otro empleado');
      // Las ausencias no pueden superar los días trabajados del mes (E22 §2.2)
      const ausencias = novedades.filter((n) => n.tipo === 'AUSENCIA_INJUSTIFICADA').reduce((t, n) => t + (n.cantidad ?? 0), 0);
      const trabajados = diasTrabajados(emp.fechaIngreso, emp.fechaEgreso, l.anio, l.mes);
      if (ausencias > trabajados) throw new BadRequestException(`Las ausencias (${ausencias} días) superan los días trabajados del mes (${trabajados})`);
      // Las novedades cargadas por una liquidación de comisiones (E24) no se tocan desde acá
      await tx.novedad.deleteMany({ where: { liquidacionId: id, empleadoId, liquidacionComisionesId: null } });
      const data = novedades.filter((n) => (n.cantidad ?? 0) || (n.importe ?? 0)).map((n) => ({ empresaId: this.tenant.empresaId, liquidacionId: id, empleadoId, tipo: n.tipo, conceptoId: n.conceptoId ?? null, cantidad: n.cantidad ?? null, importe: n.importe ?? null, detalle: n.detalle ?? null }));
      if (data.length) await tx.novedad.createMany({ data });
      await this.calcular(tx, l);
      return this.obtener(id, tx);
    });
  }

  /** Recalcula un borrador dentro de la transacción recibida (lo usan las comisiones al cargar o quitar su novedad). */
  async recalcularEnTx(tx: TxEmpresa, id: string) {
    await this.calcular(tx, await this.liquidacion(tx, id, true));
  }

  recalcular(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const l = await this.liquidacion(tx, id, true);
      await this.calcular(tx, l);
      return this.obtener(id, tx);
    });
  }

  cerrar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx, id);
      const l = await this.liquidacion(tx, id, true);
      if (await this.retencion.concepto(tx)) {
        // Ganancias (E31 §6): los cierres de la empresa se serializan y van en orden de fecha de pago dentro del año
        await tx.$queryRawUnsafe(`SELECT id FROM "ConfiguracionSueldos" WHERE "empresaId" = $1::uuid FOR UPDATE`, this.tenant.empresaId);
        const anio = l.fechaPago.getUTCFullYear();
        // Solo importa si la posterior ya retuvo (o devolvió) Ganancias a alguno de los empleados de esta: si no, no hay nada que retener dos veces
        const empleados = (await tx.reciboSueldo.findMany({ where: { liquidacionId: id }, select: { empleadoId: true } })).map((r) => r.empleadoId);
        const conceptosGanancias = (await tx.concepto.findMany({ where: { tipo: 'GANANCIAS' }, select: { id: true } })).map((c) => c.id);
        const posterior = await tx.liquidacion.findFirst({
          where: {
            id: { not: id }, estado: 'CERRADA', fechaPago: { gt: l.fechaPago, lt: new Date(Date.UTC(anio + 1, 0, 1)) },
            recibos: { some: { empleadoId: { in: empleados }, renglones: { some: { conceptoId: { in: conceptosGanancias } } } } },
          },
          orderBy: { fechaPago: 'asc' },
        });
        if (posterior) throw new BadRequestException(`Hay una liquidación cerrada con fecha de pago posterior (N° ${posterior.numero}): ciérrelas en orden de fecha de pago`);
      }
      const { errores } = await this.calcular(tx, l);
      if (errores.length) throw new BadRequestException('Corrija los errores antes de cerrar la liquidación');
      const recibos = await tx.reciboSueldo.findMany({ where: { liquidacionId: id, numero: null }, orderBy: { legajo: 'asc' } });
      if (!recibos.length && !(await tx.reciboSueldo.count({ where: { liquidacionId: id } }))) throw new BadRequestException('La liquidación no tiene recibos');
      for (const r of recibos) await tx.reciboSueldo.update({ where: { id: r.id }, data: { numero: await this.numeracion.siguiente(tx, 'RECIBO_SUELDO', 0) } });
      // Copia de los parámetros previsionales usados (el F.931 de un mes cerrado no cambia si se editan después), E22 §2.7
      const param = await this.contribuciones.parametros(tx, l.anio, l.mes);
      const cerrada = await tx.liquidacion.update({ where: { id }, data: { estado: 'CERRADA', cerradoPor: this.usuario(), cerradoEn: new Date(), baseMaximaAportes: param.baseMaxima, detraccion: param.detraccion } });
      await this.contabilizacion.contabilizar(tx, cerrada);
      await this.retencion.guardarDistracto(tx, cerrada);
      return this.obtener(id, tx);
    });
  }

  reabrir(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx, id);
      await tx.$queryRawUnsafe(`SELECT id FROM "ConfiguracionSueldos" WHERE "empresaId" = $1::uuid FOR UPDATE`, this.tenant.empresaId);
      const l = await this.liquidacion(tx, id);
      if (l.estado !== 'CERRADA') throw new BadRequestException('La liquidación no está cerrada');
      if (l.tipo === 'MENSUAL') {
        const sac = await tx.liquidacion.findFirst({ where: { tipo: 'SAC', anio: l.anio, mes: semestre(l.mes) === 1 ? 6 : 12, estado: 'CERRADA' } });
        if (sac) throw new BadRequestException(`La liquidación se usó en el SAC de ${mmaaaa(sac.anio, sac.mes)}: reábralo primero`);
      }
      await this.pagos.validarReapertura(tx, l);
      await this.contabilizacion.anular(tx, l);
      await tx.liquidacion.update({ where: { id }, data: { estado: 'BORRADOR', cerradoPor: null, cerradoEn: null } });
      await this.retencion.borrarDistracto(tx, id);
      const res = await this.obtener(id, tx);
      // Ganancias (E31 §6): las liquidaciones posteriores ya cerradas no se recalculan solas
      const anio = l.fechaPago.getUTCFullYear();
      // Mismo criterio que el cierre: posteriores del año que retuvieron Ganancias a empleados de esta
      let posteriores = 0;
      if (await this.retencion.concepto(tx)) {
        const empleados = (await tx.reciboSueldo.findMany({ where: { liquidacionId: id }, select: { empleadoId: true } })).map((r) => r.empleadoId);
        const conceptosGanancias = (await tx.concepto.findMany({ where: { tipo: 'GANANCIAS' }, select: { id: true } })).map((c) => c.id);
        posteriores = await tx.liquidacion.count({ where: {
          id: { not: id }, estado: 'CERRADA', fechaPago: { gt: l.fechaPago, lt: new Date(Date.UTC(anio + 1, 0, 1)) },
          recibos: { some: { empleadoId: { in: empleados }, renglones: { some: { conceptoId: { in: conceptosGanancias } } } } },
        } });
      }
      if (!posteriores) return res;
      const aviso = 'Hay liquidaciones posteriores cerradas: su retención de Ganancias no se recalcula; para volver a cerrarla, reabra primero las posteriores que retuvieron Ganancias';
      return { ...res, aviso: [res.aviso, aviso].filter(Boolean).join('. ') };
    });
  }

  /** Genera el asiento de una liquidación cerrada que no lo tiene (cerradas antes de la Entrega 19). */
  contabilizar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx, id);
      const l = await this.liquidacion(tx, id);
      if (l.estado !== 'CERRADA') throw new BadRequestException('La liquidación no está cerrada');
      await this.contabilizacion.contabilizar(tx, l);
      return this.obtener(id, tx);
    });
  }

  deposito(id: string, d: { fecha: string; banco: string; periodo: string }) {
    return this.tenant.transaccion(async (tx) => {
      await this.liquidacion(tx, id);
      await tx.liquidacion.update({ where: { id }, data: { ultimoDepositoFecha: aFecha(d.fecha), ultimoDepositoBanco: d.banco, ultimoDepositoPeriodo: d.periodo } });
      return this.obtener(id, tx);
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx, id);
      const l = await this.liquidacion(tx, id);
      if (l.estado !== 'BORRADOR') throw new BadRequestException('Solo se elimina una liquidación en borrador');
      // Sus novedades de comisiones se perderían con la liquidación (E24): primero se anula la de comisiones
      const conComisiones = await tx.novedad.findFirst({ where: { liquidacionId: id, liquidacionComisionesId: { not: null } } });
      if (conComisiones) {
        const lc = await tx.liquidacionComisiones.findUniqueOrThrow({ where: { id: conComisiones.liquidacionComisionesId! } });
        throw new BadRequestException(`La liquidación tiene comisiones cargadas: anule primero la liquidación de comisiones de ${mmaaaa(lc.anio, lc.mes)}`);
      }
      const eg = l.tipo === 'FINAL' ? await tx.egresoEmpleado.findUnique({ where: { liquidacionId: id } }) : null;
      if (eg && (await tx.liquidacion.count({ where: { tipo: 'MENSUAL', anio: l.anio, mes: l.mes, estado: 'CERRADA' } })))
        throw new BadRequestException(`La liquidación mensual de ${mmaaaa(l.anio, l.mes)} ya está cerrada: el empleado quedaría sin recibo de ese mes. Reábrala antes de eliminar la final`);
      await tx.liquidacion.delete({ where: { id } });
      if (eg) {
        // El empleado vuelve a estar activo y sin egreso; la mensual en borrador del mes lo vuelve a incluir
        await tx.empleado.update({ where: { id: eg.empleadoId }, data: { fechaEgreso: null, activo: true } });
        const m = await tx.liquidacion.findFirst({ where: { tipo: 'MENSUAL', anio: l.anio, mes: l.mes, estado: 'BORRADOR' } });
        if (m) await this.calcular(tx, m);
      }
      return { ok: true };
    });
  }
}
