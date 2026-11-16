import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { NumeracionService } from '../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { CausaEgreso } from './calculo';
import { LiquidacionesService } from './liquidaciones.service';

const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);
const mmaaaa = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
export interface DatosEgreso { causa: CausaEgreso; fechaEgreso: string; preavisoOtorgado: boolean; mejorRemuneracion?: number | null; gratificacion?: number; fechaPago: string }

/** Baja de empleados con liquidación final (spec E20 §3, §9). */
@Injectable()
export class EgresosService {
  constructor(private readonly tenant: TenantPrisma, private readonly numeracion: NumeracionService, private readonly liquidaciones: LiquidacionesService, private readonly cls: ClsService) {}

  private validarDatos(d: DatosEgreso, ingreso: Date) {
    if (aFecha(d.fechaEgreso) < ingreso) throw new BadRequestException('La fecha de egreso es anterior al ingreso');
    if ((d.gratificacion ?? 0) > 0 && d.causa !== 'MUTUO_ACUERDO') throw new BadRequestException('La gratificación corresponde solo al mutuo acuerdo');
  }

  /** Doble cobro (§9.1): mensual o SAC cerrados que ya incluyen al empleado desde el mes del egreso. */
  private async validarDobleCobro(tx: TxEmpresa, empleadoId: string, egreso: Date) {
    const anio = egreso.getUTCFullYear(), mes = egreso.getUTCMonth() + 1, idx = anio * 12 + mes;
    const rs = await tx.reciboSueldo.findMany({ where: { empleadoId, liquidacion: { estado: 'CERRADA', tipo: { in: ['MENSUAL', 'SAC'] } } }, include: { liquidacion: { select: { tipo: true, anio: true, mes: true } } } });
    const mensual = rs.filter((r) => r.liquidacion.tipo === 'MENSUAL' && r.liquidacion.anio * 12 + r.liquidacion.mes >= idx).sort((a, b) => a.liquidacion.anio * 12 + a.liquidacion.mes - (b.liquidacion.anio * 12 + b.liquidacion.mes))[0];
    if (mensual) throw new BadRequestException(`La liquidación mensual de ${mmaaaa(mensual.liquidacion.anio, mensual.liquidacion.mes)} ya incluye al empleado: reábrala antes de darlo de baja`);
    const sac = rs.find((r) => r.liquidacion.tipo === 'SAC' && r.liquidacion.anio * 12 + r.liquidacion.mes >= idx);
    if (sac) throw new BadRequestException(`El SAC de ${mmaaaa(sac.liquidacion.anio, sac.liquidacion.mes)} ya incluye al empleado: reábralo antes de darlo de baja`);
  }

  crear(d: DatosEgreso & { empleadoId: string }) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "Empleado" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, d.empleadoId, this.tenant.empresaId);
      const e = await tx.empleado.findUnique({ where: { id: d.empleadoId } });
      if (!e) throw new NotFoundException('Empleado inexistente');
      if (await tx.egresoEmpleado.count({ where: { empleadoId: e.id } })) throw new BadRequestException('El empleado ya tiene una liquidación final');
      this.validarDatos(d, e.fechaIngreso);
      const fecha = aFecha(d.fechaEgreso);
      await this.validarDobleCobro(tx, e.id, fecha);
      const anio = fecha.getUTCFullYear(), mes = fecha.getUTCMonth() + 1;
      await tx.empleado.update({ where: { id: e.id }, data: { fechaEgreso: fecha, activo: false } });
      const l = await tx.liquidacion.create({ data: {
        empresaId: this.tenant.empresaId, numero: await this.numeracion.siguiente(tx, 'LIQUIDACION_SUELDO', 0), tipo: 'FINAL', anio, mes, fechaPago: aFecha(d.fechaPago),
        creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
      } });
      await tx.egresoEmpleado.create({ data: {
        empresaId: this.tenant.empresaId, liquidacionId: l.id, empleadoId: e.id, causa: d.causa, fechaEgreso: fecha, preavisoOtorgado: d.preavisoOtorgado,
        mejorRemuneracion: d.mejorRemuneracion ?? null, gratificacion: d.gratificacion ?? 0, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
      } });
      // Las novedades del mes pasan de la mensual en borrador a la final; la mensual se recalcula sin el empleado
      const mensual = await tx.liquidacion.findFirst({ where: { tipo: 'MENSUAL', anio, mes, estado: 'BORRADOR' } });
      if (mensual) {
        await tx.novedad.updateMany({ where: { liquidacionId: mensual.id, empleadoId: e.id }, data: { liquidacionId: l.id } });
        await this.liquidaciones.recalcularEn(tx, mensual.id);
      }
      await this.liquidaciones.recalcularEn(tx, l.id);
      return { id: l.id, numero: l.numero };
    });
  }

  modificar(liquidacionId: string, d: DatosEgreso) {
    return this.tenant.transaccion(async (tx) => {
      const l = await tx.liquidacion.findUnique({ where: { id: liquidacionId } });
      const eg = await tx.egresoEmpleado.findUnique({ where: { liquidacionId } });
      if (!l || !eg) throw new NotFoundException('Liquidación final inexistente');
      if (l.estado !== 'BORRADOR') throw new BadRequestException('La liquidación está cerrada');
      const fecha = aFecha(d.fechaEgreso);
      if (fecha.getUTCFullYear() !== l.anio || fecha.getUTCMonth() + 1 !== l.mes) throw new BadRequestException('Para cambiar el mes del egreso, elimine la liquidación final y vuelva a darlo de baja');
      const e = await tx.empleado.findUniqueOrThrow({ where: { id: eg.empleadoId } });
      this.validarDatos(d, e.fechaIngreso);
      await tx.egresoEmpleado.update({ where: { id: eg.id }, data: { causa: d.causa, fechaEgreso: fecha, preavisoOtorgado: d.preavisoOtorgado, mejorRemuneracion: d.mejorRemuneracion ?? null, gratificacion: new Prisma.Decimal(d.gratificacion ?? 0) } });
      await tx.empleado.update({ where: { id: e.id }, data: { fechaEgreso: fecha } });
      await tx.liquidacion.update({ where: { id: l.id }, data: { fechaPago: aFecha(d.fechaPago) } });
      await this.liquidaciones.recalcularEn(tx, l.id);
      return this.liquidaciones.obtener(l.id, tx);
    });
  }
}
