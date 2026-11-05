import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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

  /** Cambia rol/estado en la empresa activa y, si se indica, blanquea la contraseña. */
  modificar(usuarioId: string, d: { rolId?: string; activo?: boolean; password?: string | null }) {
    const { password, ...cambios } = d;
    return this.tenant.transaccion(async (tx) => {
      if (cambios.rolId) await this.verificarRol(tx, cambios.rolId);
      const ue = await tx.usuarioEmpresa.update({
        where: { usuarioId_empresaId: { usuarioId, empresaId: this.tenant.empresaId } },
        data: cambios,
        include: { usuario: true, rol: true },
      });
      if (password) {
        // Solo se blanquea a usuarios que pertenecen únicamente a esta empresa (consulta sin filtro de empresa).
        const otras = await this.prisma.usuarioEmpresa.count({ where: { usuarioId, empresaId: { not: this.tenant.empresaId } } });
        if (otras) throw new ForbiddenException('El usuario pertenece también a otras empresas: debe cambiar su contraseña él mismo');
      }
      if (password) await tx.usuario.update({ where: { id: usuarioId }, data: { passwordHash: await hash(password) } });
      await this.auditoria.registrar(tx, {
        entidad: 'Usuario', entidadId: usuarioId, accion: 'MODIFICAR', datos: { ...cambios, blanqueoPassword: !!password },
      });
      return vista(ue);
    });
  }

  private async verificarRol(tx: Parameters<Parameters<TenantPrisma['transaccion']>[0]>[0], rolId: string) {
    const rol = await tx.rol.findUnique({ where: { id: rolId } });
    if (!rol) throw new NotFoundException('Rol no encontrado');
  }
}
