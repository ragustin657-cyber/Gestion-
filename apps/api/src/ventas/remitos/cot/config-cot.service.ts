import { Injectable } from '@nestjs/common';
import type { AmbienteCot } from '@prisma/client';
import { cifrar } from '../../../arca/cifrado';
import { AuditoriaService } from '../../../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../../../prisma/tenant-prisma.service';

export interface DatosConfigCot { activo?: boolean; ambiente?: AmbienteCot; usuario?: string | null; clave?: string | null; pedirAlConfirmar?: boolean }

/** E57: configuración del COT de ARBA; la clave CIT se guarda cifrada y nunca se devuelve. */
@Injectable()
export class ConfigCotService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}

  async leer(tx: TxEmpresa = this.tenant.db) {
    return tx.configCot.findFirst();
  }

  async obtener() {
    const c = await this.leer();
    return { activo: c?.activo ?? false, ambiente: c?.ambiente ?? 'SIMULADO', usuario: c?.usuario ?? null, pedirAlConfirmar: c?.pedirAlConfirmar ?? false, tieneClave: !!c?.claveCifrada };
  }

  guardar(d: DatosConfigCot) {
    return this.tenant.transaccion(async (tx) => {
      const { clave, ...resto } = d;
      // E59: clave null la borra; vacía o ausente la conserva
      const data = { ...resto, ...(clave ? { claveCifrada: cifrar(clave) } : clave === null ? { claveCifrada: null } : {}) };
      await tx.configCot.upsert({ where: { empresaId: this.tenant.empresaId }, create: { empresaId: this.tenant.empresaId, ...data }, update: data });
      // La clave nunca va a la auditoría
      await this.auditoria.registrar(tx, { entidad: 'ConfigCot', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: { ...resto, clave: clave ? '(cambiada)' : clave === null ? '(borrada)' : undefined } });
    }).then(() => this.obtener());
  }
}
