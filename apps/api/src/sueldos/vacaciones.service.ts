import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { diasVacacionesCorresponden } from './calculo';
import { LiquidacionesService } from './liquidaciones.service';

const DIA = 86400000;
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);
const dia = (f: Date) => f.toISOString().slice(0, 10);
const ddmmaaaa = (f: Date) => dia(f).split('-').reverse().join('/');
const mmaaaa = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
export interface DatosPeriodo { empleadoId: string; anio: number; desde: string; hasta: string; liquidadoAfuera?: boolean; observaciones?: string | null }

/** Períodos y saldo de vacaciones (spec E21 §2-§4, §11). */
@Injectable()
export class VacacionesService {
  constructor(private readonly tenant: TenantPrisma, private readonly liquidaciones: LiquidacionesService, private readonly cls: ClsService) {}

  private async anioInicio(tx: TxEmpresa) {
    return (await tx.configuracionSueldos.findFirst())?.anioInicioVacaciones ?? new Date().getUTCFullYear();
  }

  /** Corresponden, tomados y pendientes de un empleado en un año. */
  async saldoAnio(tx: TxEmpresa, empleado: { id: string; fechaIngreso: Date; fechaEgreso: Date | null }, anio: number, inicio?: number) {
    const ini = inicio ?? (await this.anioInicio(tx));
    const si = await tx.vacacionSaldoInicial.findFirst({ where: { empleadoId: empleado.id, anio } });
    const corresponden = si ? si.dias : anio >= ini ? diasVacacionesCorresponden(empleado.fechaIngreso, empleado.fechaEgreso, anio) : 0;
    const tomados = (await tx.vacacionPeriodo.aggregate({ where: { empleadoId: empleado.id, anio }, _sum: { dias: true } }))._sum.dias ?? 0;
    return { corresponden, saldoInicial: si?.dias ?? null, tomados, pendientes: corresponden - tomados };
  }

  /** Liquidación cerrada (mensual o final) que pagó el período, si existe. */
  private async liquidadoEn(tx: TxEmpresa, periodoId: string) {
    const r = await tx.reciboSueldoRenglon.findFirst({ where: { vacacionPeriodoId: periodoId, recibo: { liquidacion: { estado: 'CERRADA' } } }, include: { recibo: { include: { liquidacion: { select: { tipo: true, anio: true, mes: true } } } } } });
    return r?.recibo.liquidacion ?? null;
  }

  private async periodosSalida(tx: TxEmpresa, where: { empleadoId?: string; anio?: number }) {
    const ps = await tx.vacacionPeriodo.findMany({ where, orderBy: { desde: 'asc' } });
    const liquidados = new Set((await tx.reciboSueldoRenglon.findMany({ where: { vacacionPeriodoId: { in: ps.map((p) => p.id) }, recibo: { liquidacion: { estado: 'CERRADA' } } }, select: { vacacionPeriodoId: true } })).map((r) => r.vacacionPeriodoId));
    return ps.map((p) => ({ id: p.id, empleadoId: p.empleadoId, anio: p.anio, desde: dia(p.desde), hasta: dia(p.hasta), dias: p.dias, liquidadoAfuera: p.liquidadoAfuera, observaciones: p.observaciones, liquidado: liquidados.has(p.id) }));
  }

  async saldos(anio: number) {
    if (!Number.isInteger(anio)) throw new BadRequestException('Año inválido');
    const db = this.tenant.db;
    const inicio = await this.anioInicio(db);
    const empleados = await db.empleado.findMany({ where: { fechaIngreso: { lte: new Date(Date.UTC(anio, 11, 31)) }, OR: [{ activo: true }, { fechaEgreso: { gte: new Date(Date.UTC(anio, 0, 1)) } }] }, orderBy: { legajo: 'asc' } });
    const periodos = await this.periodosSalida(db, { anio });
    const filas = [];
    for (const e of empleados) filas.push({ empleadoId: e.id, legajo: e.legajo, nombre: `${e.apellido}, ${e.nombre}`, ...(await this.saldoAnio(db, e, anio, inicio)), periodos: periodos.filter((p) => p.empleadoId === e.id) });
    return filas;
  }

  async delEmpleado(empleadoId: string) {
    const db = this.tenant.db;
    const e = await db.empleado.findUnique({ where: { id: empleadoId } });
    if (!e) throw new NotFoundException('Empleado inexistente');
    const periodos = await this.periodosSalida(db, { empleadoId });
    const iniciales = await db.vacacionSaldoInicial.findMany({ where: { empleadoId }, select: { anio: true } });
    const anios = [...new Set([...periodos.map((p) => p.anio), ...iniciales.map((x) => x.anio), new Date().getUTCFullYear()])].sort();
    const saldos = [];
    for (const anio of anios) saldos.push({ anio, ...(await this.saldoAnio(db, e, anio)) });
    return { saldos, periodos };
  }

  /** Valida el período y devuelve los avisos (spec §2, §11). */
  private async validar(tx: TxEmpresa, d: DatosPeriodo, id?: string) {
    const e = await tx.empleado.findUnique({ where: { id: d.empleadoId } });
    if (!e) throw new BadRequestException('Empleado inexistente');
    const desde = aFecha(d.desde), hasta = aFecha(d.hasta);
    if (hasta < desde) throw new BadRequestException('La fecha hasta es anterior a la fecha desde');
    if (desde < e.fechaIngreso) throw new BadRequestException('El período empieza antes del ingreso del empleado');
    if (e.fechaEgreso && hasta > e.fechaEgreso) throw new BadRequestException(`El período termina después del egreso del empleado (${ddmmaaaa(e.fechaEgreso)})`);
    if (d.anio < e.fechaIngreso.getUTCFullYear() || d.anio > desde.getUTCFullYear()) throw new BadRequestException(`El año de las vacaciones debe estar entre ${e.fechaIngreso.getUTCFullYear()} y ${desde.getUTCFullYear()}`);
    const sup = await tx.vacacionPeriodo.findFirst({ where: { empleadoId: e.id, id: id ? { not: id } : undefined, desde: { lte: hasta }, hasta: { gte: desde } } });
    if (sup) throw new BadRequestException(`El período se superpone con otro del empleado (${ddmmaaaa(sup.desde)} al ${ddmmaaaa(sup.hasta)})`);
    if (!d.liquidadoAfuera) {
      const anio = desde.getUTCFullYear(), mes = desde.getUTCMonth() + 1;
      if (await tx.liquidacion.count({ where: { tipo: 'MENSUAL', anio, mes, estado: 'CERRADA' } }))
        throw new BadRequestException(`La liquidación mensual de ${mmaaaa(anio, mes)} ya está cerrada: marque el período como liquidado fuera del sistema o reabra la liquidación`);
    }
    const dias = Math.round((hasta.getTime() - desde.getTime()) / DIA) + 1;
    const avisos: string[] = [];
    const saldo = await this.saldoAnio(tx, e, d.anio);
    const propio = id ? (await tx.vacacionPeriodo.findUnique({ where: { id } }))?.dias ?? 0 : 0;
    const quedan = saldo.pendientes + propio;
    if (dias > quedan) avisos.push(`Supera el saldo de ${d.anio} (quedan ${quedan} días)`);
    const mesDesde = desde.getUTCMonth() + 1;
    if (mesDesde >= 5 && mesDesde <= 9) avisos.push('Comienza fuera del período legal (1/10 al 30/4)');
    return { e, desde, hasta, dias, avisos };
  }

  /** Recalcula las liquidaciones en borrador del mes de inicio que pueden incluir al empleado. */
  private async recalcular(tx: TxEmpresa, empleadoId: string, desde: Date) {
    const anio = desde.getUTCFullYear(), mes = desde.getUTCMonth() + 1;
    const ls = await tx.liquidacion.findMany({ where: { anio, mes, estado: 'BORRADOR', OR: [{ tipo: 'MENSUAL' }, { tipo: 'FINAL', egreso: { empleadoId } }] } });
    for (const l of ls) await this.liquidaciones.recalcularEn(tx, l.id);
  }

  private async noLiquidado(tx: TxEmpresa, id: string) {
    const p = await tx.vacacionPeriodo.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Período inexistente');
    const l = await this.liquidadoEn(tx, id);
    if (l) throw new BadRequestException(`El período ya se pagó en la liquidación ${l.tipo === 'FINAL' ? 'final' : 'mensual'} de ${mmaaaa(l.anio, l.mes)}: reábrala para modificarlo`);
    return p;
  }

  crear(d: DatosPeriodo) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "Empleado" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, d.empleadoId, this.tenant.empresaId);
      const v = await this.validar(tx, d);
      const p = await tx.vacacionPeriodo.create({ data: {
        empresaId: this.tenant.empresaId, empleadoId: d.empleadoId, anio: d.anio, desde: v.desde, hasta: v.hasta, dias: v.dias, liquidadoAfuera: !!d.liquidadoAfuera,
        observaciones: d.observaciones ?? null, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
      } });
      await this.recalcular(tx, d.empleadoId, v.desde);
      return { id: p.id, avisos: v.avisos };
    });
  }

  modificar(id: string, d: DatosPeriodo) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "Empleado" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, d.empleadoId, this.tenant.empresaId);
      const actual = await this.noLiquidado(tx, id);
      if (actual.empleadoId !== d.empleadoId) throw new BadRequestException('El período es de otro empleado');
      const v = await this.validar(tx, d, id);
      await tx.vacacionPeriodo.update({ where: { id }, data: { anio: d.anio, desde: v.desde, hasta: v.hasta, dias: v.dias, liquidadoAfuera: !!d.liquidadoAfuera, observaciones: d.observaciones ?? null } });
      await this.recalcular(tx, d.empleadoId, actual.desde);
      if (dia(actual.desde).slice(0, 7) !== dia(v.desde).slice(0, 7)) await this.recalcular(tx, d.empleadoId, v.desde);
      return { id, avisos: v.avisos };
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.noLiquidado(tx, id);
      await tx.vacacionPeriodo.delete({ where: { id } });
      await this.recalcular(tx, p.empleadoId, p.desde);
      return { ok: true };
    });
  }

  saldoInicial(d: { empleadoId: string; anio: number; dias: number | null }) {
    return this.tenant.transaccion(async (tx) => {
      const e = await tx.empleado.findUnique({ where: { id: d.empleadoId } });
      if (!e) throw new BadRequestException('Empleado inexistente');
      if (d.anio < e.fechaIngreso.getUTCFullYear()) throw new BadRequestException('El año es anterior al ingreso del empleado');
      await tx.$queryRawUnsafe(`SELECT id FROM "Empleado" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, e.id, this.tenant.empresaId);
      const actual = await tx.vacacionSaldoInicial.findFirst({ where: { empleadoId: e.id, anio: d.anio } });
      if (d.dias === null) { if (actual) await tx.vacacionSaldoInicial.delete({ where: { id: actual.id } }); }
      else if (actual) await tx.vacacionSaldoInicial.update({ where: { id: actual.id }, data: { dias: d.dias } });
      else await tx.vacacionSaldoInicial.create({ data: { empresaId: this.tenant.empresaId, empleadoId: e.id, anio: d.anio, dias: d.dias } });
      return { anio: d.anio, ...(await this.saldoAnio(tx, e, d.anio)) };
    });
  }
}
