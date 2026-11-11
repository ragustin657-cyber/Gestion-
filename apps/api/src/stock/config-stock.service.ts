import { Injectable } from '@nestjs/common';
import type { ModoStockNegativo } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';

@Injectable()
export class ConfigStockService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Modo de stock negativo de la empresa (sin configuración: BLOQUEAR). */
  async modo(tx: TxEmpresa): Promise<ModoStockNegativo> {
    return (await tx.configStock.findFirst())?.stockNegativo ?? 'BLOQUEAR';
  }

  async obtener() {
    return { stockNegativo: await this.modo(this.tenant.db) };
  }

  guardar(stockNegativo: ModoStockNegativo) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      await tx.configStock.upsert({ where: { empresaId }, create: { empresaId, stockNegativo }, update: { stockNegativo } });
      await this.auditoria.registrar(tx, { entidad: 'ConfigStock', entidadId: empresaId, accion: 'MODIFICAR', datos: { stockNegativo } });
      return { stockNegativo };
    });
  }
}
