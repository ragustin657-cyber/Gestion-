import { Injectable } from '@nestjs/common';
import type { ConfigImpuestos, PeriodicidadArba } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

export interface DatosConfigImpuestos { arbaActividad: string; arbaSucursal: number; arbaPeriodicidad: PeriodicidadArba; agipCodigoNorma: string }

@Injectable()
export class ConfigImpuestosService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}

  /** La configuración de la empresa; se crea con los valores por defecto si no existe. */
  async obtener(tx: TxEmpresa = this.tenant.db): Promise<ConfigImpuestos> {
    return (await tx.configImpuestos.findFirst()) ?? tx.configImpuestos.create({ data: { empresaId: this.tenant.empresaId } });
  }

  async guardar(d: DatosConfigImpuestos) {
    const c = await this.obtener();
    const r = await this.tenant.db.configImpuestos.update({ where: { id: c.id }, data: d });
    await this.auditoria.registrar(this.tenant.db, { entidad: 'ConfigImpuestos', entidadId: c.id, accion: 'MODIFICAR', datos: d });
    return r;
  }
}
