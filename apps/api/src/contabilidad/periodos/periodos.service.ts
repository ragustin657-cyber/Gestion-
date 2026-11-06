import type { Prisma } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { crearEjercicio } from './ejercicios';

@Injectable()
export class PeriodosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

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
