import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { MODELOS_DE_EMPRESA } from './modelos-empresa';
import { PrismaService } from './prisma.service';

const CON_WHERE = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany',
]);

function extender(prisma: PrismaService, empresaActual: () => string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!MODELOS_DE_EMPRESA.includes(model)) return query(args);
          const empresaId = empresaActual();
          const a = (args ?? {}) as Record<string, any>;
          if (CON_WHERE.has(operation)) a.where = { ...(a.where ?? {}), empresaId };
          if (operation === 'create') a.data = { ...a.data, empresaId };
          if (operation === 'createMany' || operation === 'createManyAndReturn')
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: object) => ({ ...d, empresaId }));
          if (operation === 'upsert') {
            a.where = { ...a.where, empresaId };
            a.create = { ...a.create, empresaId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type ClienteEmpresa = ReturnType<typeof extender>;
export type TxEmpresa = Omit<ClienteEmpresa, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/**
 * Cliente Prisma que filtra por la empresa activa del usuario.
 * Todos los servicios de negocio usan `db` (nunca PrismaService directamente).
 */
@Injectable()
export class TenantPrisma {
  readonly db: ClienteEmpresa;

  constructor(
    prisma: PrismaService,
    private readonly cls: ClsService,
  ) {
    this.db = extender(prisma, () => this.empresaId);
  }

  /** Empresa activa del contexto; lanza 403 si no hay ninguna seleccionada. */
  get empresaId(): string {
    const ctx = this.cls.isActive() ? this.cls.get<ContextoRequest>(CLAVE_CONTEXTO) : undefined;
    if (!ctx?.empresaId) throw new ForbiddenException('Debe seleccionar una empresa');
    return ctx.empresaId;
  }

  transaccion<T>(fn: (tx: TxEmpresa) => Promise<T>, opciones?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
    return this.db.$transaction((tx) => fn(tx as TxEmpresa), opciones);
  }
}
