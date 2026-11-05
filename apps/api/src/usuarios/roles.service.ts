import { Injectable } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar() {
    return this.tenant.db.rol.findMany({ orderBy: { nombre: 'asc' } });
  }

  crear(d: { nombre: string; permisos: string[] }) {
    return this.tenant.transaccion(async (tx) => {
      const rol = await tx.rol.create({ data: { empresaId: this.tenant.empresaId, ...d } });
      await this.auditoria.registrar(tx, { entidad: 'Rol', entidadId: rol.id, accion: 'CREAR', datos: d });
      return rol;
    });
  }

  modificar(id: string, d: { nombre?: string; permisos?: string[] }) {
    return this.tenant.transaccion(async (tx) => {
      const rol = await tx.rol.update({ where: { id }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'Rol', entidadId: id, accion: 'MODIFICAR', datos: d });
      return rol;
    });
  }
}
