import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { DatosConfigIntereses } from './dto';

/** Tasa mensual de intereses por mora de la empresa (spec E27 §3). */
@Injectable()
export class ConfigInteresesService {
  constructor(private readonly tenant: TenantPrisma) {}

  async ver() {
    const c = await this.tenant.db.configIntereses.findFirst();
    return { tasaMensual: c ? c.tasaMensual.toFixed(2) : null, descripcion: c?.descripcion ?? 'Intereses por mora' };
  }

  async guardar(d: DatosConfigIntereses) {
    // Upsert por empresa: dos guardados simultáneos no chocan con la clave única
    await this.tenant.db.configIntereses.upsert({
      where: { empresaId: this.tenant.empresaId },
      update: { tasaMensual: d.tasaMensual, ...(d.descripcion !== undefined ? { descripcion: d.descripcion } : {}) },
      create: { empresaId: this.tenant.empresaId, tasaMensual: d.tasaMensual, descripcion: d.descripcion ?? 'Intereses por mora' },
    });
    return this.ver();
  }

  /** Configuración obligatoria para calcular o liquidar. */
  async requerida(tx: TxEmpresa) {
    const c = await tx.configIntereses.findFirst();
    if (!c) throw new BadRequestException('Configure la tasa de interés por mora');
    return c;
  }
}
