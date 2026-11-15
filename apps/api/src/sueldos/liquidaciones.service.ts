import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Concepto, Liquidacion, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { NumeracionService } from '../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { ConceptoCalc, liquidarMes, liquidarSac, NovedadCalc, ResultadoCalc, validarConcepto } from './calculo';
import { basicosVigentes } from './maestros.service';

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
  constructor(private readonly tenant: TenantPrisma, private readonly numeracion: NumeracionService, private readonly cls: ClsService) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  async listar() {
    const ls = await this.tenant.db.liquidacion.findMany({ orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { tipo: 'asc' }], include: { recibos: { select: { neto: true } } } });
    return ls.map(({ recibos, ...l }) => ({ ...l, fechaPago: l.fechaPago.toISOString().slice(0, 10), empleados: recibos.length, totalNeto: recibos.reduce((s, r) => s.plus(r.neto), new D(0)).toFixed(2) }));
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
    const empleados = await tx.empleado.findMany({
      where: { fechaIngreso: { lte: fin }, OR: [{ activo: true, fechaEgreso: null }, { fechaEgreso: { gte: l.tipo === 'SAC' ? fin : ini } }] },
      orderBy: { legajo: 'asc' },
    });
    // Recibos numerados de empleados que ya no corresponden (baja cargada después del cierre): quedan como se emitieron
    const conservados = numerados.filter((id) => !empleados.some((e) => e.id === id));
    const categorias = new Map((await tx.categoria.findMany({ include: { convenio: true } })).map((c) => [c.id, c]));
    const conceptos = (await tx.concepto.findMany({ where: { activo: true } }));
    const basicos = await basicosVigentes(tx, [...new Set(empleados.map((e) => e.categoriaId))], l.anio, l.mes);
    const novedades = await tx.novedad.findMany({ where: { liquidacionId: l.id } });
    let aviso: string | undefined;
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
      if (l.tipo === 'SAC') {
        const mejor = mejores.get(e.id);
        if (!mejor) continue; // sin sueldos cerrados en el semestre
        r = liquidarSac(calcE, cs, mejor, l.anio, semestre(l.mes));
      } else {
        const nov: NovedadCalc[] = novedades.filter((n) => n.empleadoId === e.id).map((n) => ({ tipo: n.tipo, conceptoId: n.conceptoId, cantidad: n.cantidad ? new D(n.cantidad) : null, importe: n.importe ? new D(n.importe) : null }));
        r = liquidarMes(calcE, cs, nov, l.anio, l.mes);
      }
      vigentes.add(e.id);
      const datos = {
        apellido: e.apellido, nombre: e.nombre, cuil: e.cuil, legajo: e.legajo, categoria: cat.nombre, basico, fechaIngreso: e.fechaIngreso, antiguedadAnios: r.antiguedadAnios, diasTrabajados: r.diasTrabajados,
        totalRemunerativo: r.totalRemunerativo, totalNoRemunerativo: r.totalNoRemunerativo, totalDescuentos: r.totalDescuentos, neto: r.neto,
      };
      const previo = previos.get(e.id);
      const recibo = previo
        ? await tx.reciboSueldo.update({ where: { id: previo.id }, data: datos })
        : await tx.reciboSueldo.create({ data: { ...datos, empresaId: this.tenant.empresaId, liquidacionId: l.id, empleadoId: e.id } });
      await tx.reciboSueldoRenglon.deleteMany({ where: { reciboId: recibo.id } });
      if (r.renglones.length) await tx.reciboSueldoRenglon.createMany({
        data: r.renglones.map((x) => ({ empresaId: this.tenant.empresaId, reciboId: recibo.id, conceptoId: x.conceptoId === 'SAC' ? null : x.conceptoId, codigo: x.codigo, nombre: x.nombre, clase: x.clase, cantidad: x.cantidad, base: x.base, porcentaje: x.porcentaje, importe: x.importe, orden: x.orden })),
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
    const tot = recibos.reduce((s, r) => ({ remunerativo: s.remunerativo.plus(r.totalRemunerativo), noRemunerativo: s.noRemunerativo.plus(r.totalNoRemunerativo), descuentos: s.descuentos.plus(r.totalDescuentos), neto: s.neto.plus(r.neto) }), { remunerativo: new D(0), noRemunerativo: new D(0), descuentos: new D(0), neto: new D(0) });
    return {
      ...l, fechaPago: l.fechaPago.toISOString().slice(0, 10), ultimoDepositoFecha: l.ultimoDepositoFecha?.toISOString().slice(0, 10) ?? null,
      errores, ...(aviso ? { aviso } : {}),
      recibos: recibos.map((r) => ({
        ...r, fechaIngreso: r.fechaIngreso.toISOString().slice(0, 10), basico: f2(r.basico), totalRemunerativo: f2(r.totalRemunerativo), totalNoRemunerativo: f2(r.totalNoRemunerativo), totalDescuentos: f2(r.totalDescuentos), neto: f2(r.neto),
        renglones: r.renglones.map((x) => ({ ...x, importe: f2(x.importe), base: f2(x.base), cantidad: x.cantidad === null ? null : new D(x.cantidad).toString(), porcentaje: x.porcentaje === null ? null : new D(x.porcentaje).toString() })),
        novedades: novedades.filter((n) => n.empleadoId === r.empleadoId).map((n) => ({ ...n, cantidad: n.cantidad === null ? null : Number(n.cantidad), importe: n.importe === null ? null : Number(n.importe) })),
      })),
      totales: { remunerativo: tot.remunerativo.toFixed(2), noRemunerativo: tot.noRemunerativo.toFixed(2), descuentos: tot.descuentos.toFixed(2), neto: tot.neto.toFixed(2) },
    };
  }

  /** Errores y aviso del borrador sin grabar (se recalculan en una transacción que se descarta). */
  private async estadoBorrador(tx: TxEmpresa, l: Liquidacion) {
    // El cálculo es idempotente: recalcular al consultar mantiene el borrador al día (escalas o empleados nuevos)
    return this.tenant.db === tx ? this.tenant.transaccion((t) => this.calcular(t, l)) : this.calcular(tx, l);
  }

  guardarNovedades(id: string, empleadoId: string, novedades: NovedadEntrada[]) {
    return this.tenant.transaccion(async (tx) => {
      const l = await this.liquidacion(tx, id, true);
      if (l.tipo === 'SAC') throw new BadRequestException('El SAC no tiene novedades');
      if (!(await tx.empleado.findUnique({ where: { id: empleadoId } }))) throw new BadRequestException('Empleado inexistente');
      await tx.novedad.deleteMany({ where: { liquidacionId: id, empleadoId } });
      const data = novedades.filter((n) => (n.cantidad ?? 0) || (n.importe ?? 0)).map((n) => ({ empresaId: this.tenant.empresaId, liquidacionId: id, empleadoId, tipo: n.tipo, conceptoId: n.conceptoId ?? null, cantidad: n.cantidad ?? null, importe: n.importe ?? null, detalle: n.detalle ?? null }));
      if (data.length) await tx.novedad.createMany({ data });
      await this.calcular(tx, l);
      return this.obtener(id, tx);
    });
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
      const l = await this.liquidacion(tx, id, true);
      const { errores } = await this.calcular(tx, l);
      if (errores.length) throw new BadRequestException('Corrija los errores antes de cerrar la liquidación');
      const recibos = await tx.reciboSueldo.findMany({ where: { liquidacionId: id, numero: null }, orderBy: { legajo: 'asc' } });
      if (!recibos.length && !(await tx.reciboSueldo.count({ where: { liquidacionId: id } }))) throw new BadRequestException('La liquidación no tiene recibos');
      for (const r of recibos) await tx.reciboSueldo.update({ where: { id: r.id }, data: { numero: await this.numeracion.siguiente(tx, 'RECIBO_SUELDO', 0) } });
      await tx.liquidacion.update({ where: { id }, data: { estado: 'CERRADA', cerradoPor: this.usuario(), cerradoEn: new Date() } });
      return this.obtener(id, tx);
    });
  }

  reabrir(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const l = await this.liquidacion(tx, id);
      if (l.estado !== 'CERRADA') throw new BadRequestException('La liquidación no está cerrada');
      if (l.tipo === 'MENSUAL') {
        const sac = await tx.liquidacion.findFirst({ where: { tipo: 'SAC', anio: l.anio, mes: semestre(l.mes) === 1 ? 6 : 12, estado: 'CERRADA' } });
        if (sac) throw new BadRequestException(`La liquidación se usó en el SAC de ${mmaaaa(sac.anio, sac.mes)}: reábralo primero`);
      }
      await tx.liquidacion.update({ where: { id }, data: { estado: 'BORRADOR', cerradoPor: null, cerradoEn: null } });
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
      const l = await this.liquidacion(tx, id);
      if (l.estado !== 'BORRADOR') throw new BadRequestException('Solo se elimina una liquidación en borrador');
      await tx.liquidacion.delete({ where: { id } });
      return { ok: true };
    });
  }
}
