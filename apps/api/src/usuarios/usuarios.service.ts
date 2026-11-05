import { Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

type UsuarioEmpresaConDatos = {
  usuarioId: string;
  rolId: string;
  activo: boolean;
  usuario: { email: string; nombre: string };
  rol: { nombre: string };
};

const vista = (ue: UsuarioEmpresaConDatos) => ({
  id: ue.usuarioId,
  email: ue.usuario.email,
  nombre: ue.usuario.nombre,
  rolId: ue.rolId,
  rol: ue.rol.nombre,
  activo: ue.activo,
});

@Injectable()
export class UsuariosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar() {
    const filas = await this.tenant.db.usuarioEmpresa.findMany({
      include: { usuario: true, rol: true },
      orderBy: { usuario: { nombre: 'asc' } },
    });
    return filas.map(vista);
  }

  /** Crea el usuario (o reutiliza uno existente por email) y lo asigna a la empresa activa. */
  crear(d: { email: string; nombre: string; password: string; rolId: string }) {
    return this.tenant.transaccion(async (tx) => {
      await this.verificarRol(tx, d.rolId);
      const usuario =
        (await tx.usuario.findUnique({ where: { email: d.email } })) ??
        (await tx.usuario.create({
          data: { email: d.email, nombre: d.nombre, passwordHash: await hash(d.password) },
        }));
      const ue = await tx.usuarioEmpresa.create({
        data: { usuarioId: usuario.id, empresaId: this.tenant.empresaId, rolId: d.rolId },
        include: { usuario: true, rol: true },
      });
      await this.auditoria.registrar(tx, {
        entidad: 'Usuario', entidadId: usuario.id, accion: 'CREAR', datos: { email: d.email, rolId: d.rolId },
      });
      return vista(ue);
    });
  }

  modificar(usuarioId: string, d: { rolId?: string; activo?: boolean }) {
    return this.tenant.transaccion(async (tx) => {
      if (d.rolId) await this.verificarRol(tx, d.rolId);
      const ue = await tx.usuarioEmpresa.update({
        where: { usuarioId_empresaId: { usuarioId, empresaId: this.tenant.empresaId } },
        data: d,
        include: { usuario: true, rol: true },
      });
      await this.auditoria.registrar(tx, { entidad: 'Usuario', entidadId: usuarioId, accion: 'MODIFICAR', datos: d });
      return vista(ue);
    });
  }

  private async verificarRol(tx: Parameters<Parameters<TenantPrisma['transaccion']>[0]>[0], rolId: string) {
    const rol = await tx.rol.findUnique({ where: { id: rolId } });
    if (!rol) throw new NotFoundException('Rol no encontrado');
  }
}
