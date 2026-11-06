import { Injectable, NotFoundException } from '@nestjs/common';
import type { Caja, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

/** Alcance por sucursal del usuario: null = todas las sucursales. */
@Injectable()
export class AlcanceSucursalService {
  constructor(private readonly cls: ClsService) {}

  sucursalUsuario(): string | null {
    const ctx = this.cls.isActive() ? this.cls.get<ContextoRequest | undefined>(CLAVE_CONTEXTO) : undefined;
    return ctx?.sucursalId ?? null;
  }

  filtroCajas(): Prisma.CajaWhereInput {
    const s = this.sucursalUsuario();
    return s ? { sucursalId: s } : {};
  }

  /** La caja debe existir y pertenecer al alcance del usuario; si no, 404. */
  async verificarCaja(tx: TxEmpresa, cajaId: string): Promise<Caja> {
    const caja = await tx.caja.findFirst({ where: { id: cajaId, ...this.filtroCajas() } });
    if (!caja) throw new NotFoundException('Caja no encontrada');
    return caja;
  }

  /** Ids de las cajas visibles, o null si el usuario ve todas. */
  async cajasVisibles(tx: TxEmpresa): Promise<string[] | null> {
    const s = this.sucursalUsuario();
    if (!s) return null;
    return (await tx.caja.findMany({ where: { sucursalId: s }, select: { id: true } })).map((c) => c.id);
  }
}
