import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';

export type AccionAuditoria = 'CREAR' | 'MODIFICAR' | 'APROBAR' | 'ANULAR' | 'ELIMINAR';

@Injectable()
export class AuditoriaService {
  constructor(
    private readonly cls: ClsService,
    private readonly tenant: TenantPrisma,
  ) {}

  /** Registra una acción dentro de la misma transacción que la operación auditada. */
  async registrar(
    tx: TxEmpresa,
    e: { entidad: string; entidadId: string; accion: AccionAuditoria; datos?: unknown },
  ): Promise<void> {
    const ctx = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO);
    await tx.auditoria.create({
      data: {
        empresaId: this.tenant.empresaId,
        usuarioId: ctx.usuarioId,
        entidad: e.entidad,
        entidadId: e.entidadId,
        accion: e.accion,
        datos: e.datos === undefined ? undefined : (JSON.parse(JSON.stringify(e.datos)) as Prisma.InputJsonValue),
      },
    });
  }

  listar(filtro: { entidad?: string; entidadId?: string; desde?: string; hasta?: string }) {
    return this.tenant.db.auditoria.findMany({
      where: {
        entidad: filtro.entidad || undefined,
        entidadId: filtro.entidadId || undefined,
        fecha: {
          gte: filtro.desde ? new Date(filtro.desde) : undefined,
          lte: filtro.hasta ? new Date(filtro.hasta) : undefined,
        },
      },
      orderBy: { fecha: 'desc' },
      take: 500,
    });
  }
}
