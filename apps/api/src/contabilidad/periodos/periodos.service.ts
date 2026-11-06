import type { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PeriodoContable } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { bloquear } from '../../compras/comun';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { crearEjercicio } from './ejercicios';

@Injectable()
export class PeriodosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  /**
   * Asigna los números definitivos de los asientos del período, siguiendo el último del ejercicio:
   * por fecha; a igual fecha APERTURA, luego AUTOMATICO y MANUAL, y REFUNDICION y CIERRE al final; luego por carga.
   */
  async numerarPeriodo(tx: TxEmpresa, periodo: PeriodoContable): Promise<number> {
    const ultimo = await tx.asiento.aggregate({ where: { ejercicioId: periodo.ejercicioId }, _max: { numeroDefinitivo: true } });
    const asientos = await tx.asiento.findMany({ where: { ejercicioId: periodo.ejercicioId, fecha: { gte: periodo.desde, lte: periodo.hasta }, numeroDefinitivo: null } });
    const rango = { APERTURA: 0, AUTOMATICO: 1, MANUAL: 1, REFUNDICION: 2, CIERRE: 3 } as const;
    asientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || rango[a.tipo] - rango[b.tipo] || a.creadoEn.getTime() - b.creadoEn.getTime() || a.numero - b.numero);
    let n = ultimo._max.numeroDefinitivo ?? 0;
    for (const a of asientos) await tx.asiento.update({ where: { id: a.id }, data: { numeroDefinitivo: ++n } });
    return asientos.length;
  }

  private async periodoBloqueado(tx: TxEmpresa, id: string) {
    if (!(await tx.periodoContable.findUnique({ where: { id } }))) throw new NotFoundException('Período no encontrado');
    await bloquear(tx, 'PeriodoContable', this.tenant.empresaId, [id]);
    const periodo = await tx.periodoContable.findUniqueOrThrow({ where: { id } });
    const ejercicio = await tx.ejercicio.findUniqueOrThrow({ where: { id: periodo.ejercicioId }, include: { periodos: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } } });
    return { periodo, ejercicio };
  }

  /** Cierra el período (en orden) y numera sus asientos. `final` permite cerrar el último mes desde el cierre del ejercicio. */
  async cerrarEnTx(tx: TxEmpresa, id: string, final = false) {
    const { periodo, ejercicio } = await this.periodoBloqueado(tx, id);
    if (ejercicio.estado === 'CERRADO') throw new BadRequestException(`El ejercicio ${ejercicio.numero} está cerrado`);
    if (periodo.estado === 'CERRADO') throw new BadRequestException('El período ya está cerrado');
    const i = ejercicio.periodos.findIndex((p) => p.id === id);
    const pendiente = ejercicio.periodos.slice(0, i).find((p) => p.estado !== 'CERRADO');
    if (pendiente) throw new BadRequestException(`Cierre primero el período ${String(pendiente.mes).padStart(2, '0')}/${pendiente.anio}`);
    if (i === ejercicio.periodos.length - 1 && !final) throw new BadRequestException('El último mes se cierra con el cierre del ejercicio');
    const numerados = await this.numerarPeriodo(tx, periodo);
    const r = await tx.periodoContable.update({ where: { id }, data: { estado: 'CERRADO', cerradoPor: this.usuario(), cerradoEn: new Date(), motivoReapertura: null } });
    await this.auditoria.registrar(tx, { entidad: 'PeriodoContable', entidadId: id, accion: 'MODIFICAR', datos: { cierre: true, numerados } });
    return { ...r, numerados };
  }

  cerrar(id: string) {
    return this.tenant.transaccion((tx) => this.cerrarEnTx(tx, id), { timeout: 60000 });
  }

  /** Reabre el último período cerrado del ejercicio y borra sus números definitivos. */
  async reabrirEnTx(tx: TxEmpresa, id: string, motivo: string, desdeEjercicio = false) {
    const { periodo, ejercicio } = await this.periodoBloqueado(tx, id);
    if (ejercicio.estado === 'CERRADO' && !desdeEjercicio) throw new BadRequestException(`El ejercicio ${ejercicio.numero} está cerrado`);
    if (periodo.estado !== 'CERRADO') throw new BadRequestException('El período no está cerrado');
    const i = ejercicio.periodos.findIndex((p) => p.id === id);
    if (ejercicio.periodos.slice(i + 1).some((p) => p.estado === 'CERRADO')) throw new BadRequestException('Solo se puede reabrir el último período cerrado');
    await tx.asiento.updateMany({ where: { ejercicioId: ejercicio.id, fecha: { gte: periodo.desde, lte: periodo.hasta } }, data: { numeroDefinitivo: null } });
    const r = await tx.periodoContable.update({ where: { id }, data: { estado: 'ABIERTO', cerradoPor: null, cerradoEn: null, motivoReapertura: motivo } });
    await this.auditoria.registrar(tx, { entidad: 'PeriodoContable', entidadId: id, accion: 'MODIFICAR', datos: { reapertura: motivo } });
    return r;
  }

  reabrir(id: string, motivo: string) {
    return this.tenant.transaccion((tx) => this.reabrirEnTx(tx, id, motivo));
  }

  /** Ejercicios con sus períodos y la cantidad de asientos de cada período. */
  async listar() {
    const db = this.tenant.db;
    const ejercicios = await db.ejercicio.findMany({ include: { periodos: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } }, orderBy: { numero: 'desc' } });
    const asientos = await db.asiento.findMany({ where: { ejercicioId: { in: ejercicios.map((e) => e.id) } }, select: { fecha: true } });
    const cuenta = new Map<string, number>();
    for (const a of asientos) {
      const k = `${a.fecha.getUTCFullYear()}-${a.fecha.getUTCMonth() + 1}`;
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    }
    return ejercicios.map((e) => ({ ...e, periodos: e.periodos.map((p) => ({ ...p, asientos: cuenta.get(`${p.anio}-${p.mes}`) ?? 0 })) }));
  }

  /** Crea el ejercicio que sigue al último. Como máximo dos abiertos a la vez. */
  siguiente() {
    return this.tenant.transaccion(async (tx) => {
      const ultimo = await tx.ejercicio.findFirst({ orderBy: { numero: 'desc' } });
      if (!ultimo) throw new BadRequestException('La empresa no tiene ejercicios');
      if ((await tx.ejercicio.count({ where: { estado: 'ABIERTO' } })) >= 2) throw new BadRequestException('Ya hay dos ejercicios abiertos: cierre el anterior primero');
      const desde = new Date(ultimo.hasta);
      desde.setUTCDate(desde.getUTCDate() + 1);
      const e = await crearEjercicio(tx as unknown as Prisma.TransactionClient, this.tenant.empresaId, desde, ultimo.numero + 1);
      await this.auditoria.registrar(tx, { entidad: 'Ejercicio', entidadId: e.id, accion: 'CREAR', datos: { numero: e.numero } });
      return e;
    });
  }
}
