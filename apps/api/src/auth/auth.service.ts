import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { esPermiso } from '@gestion/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PayloadJwt } from './jwt.guard';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: String(email ?? '').trim().toLowerCase() },
      include: { empresas: { where: { activo: true, empresa: { activa: true } }, include: { empresa: true } } },
    });
    const ok = usuario?.activo && (await verify(usuario.passwordHash, String(password ?? '')).catch(() => false));
    if (!usuario || !ok) throw new UnauthorizedException('Usuario o contraseña incorrectos');

    const payload: PayloadJwt = { sub: usuario.id };
    return {
      token: await this.jwt.signAsync(payload),
      usuario: { id: usuario.id, nombre: usuario.nombre },
      empresas: usuario.empresas.map((ue) => ({ id: ue.empresa.id, razonSocial: ue.empresa.razonSocial })),
    };
  }

  async seleccionarEmpresa(usuarioId: string, empresaId: string) {
    const acceso = await this.prisma.usuarioEmpresa.findFirst({
      where: { usuarioId, empresaId: String(empresaId ?? ''), activo: true, empresa: { activa: true } },
      include: { rol: true, empresa: true },
    }).catch(() => null);
    if (!acceso) throw new ForbiddenException('No tiene acceso a esta empresa');

    const payload: PayloadJwt = { sub: usuarioId, empresaId: acceso.empresaId };
    return {
      token: await this.jwt.signAsync(payload),
      empresa: { id: acceso.empresa.id, razonSocial: acceso.empresa.razonSocial, condicionIva: acceso.empresa.condicionIva },
      permisos: acceso.rol.permisos.filter(esPermiso),
    };
  }

  async cambiarPassword(usuarioId: string, actual: string, nueva: string) {
    const u = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (!(await verify(u.passwordHash, actual).catch(() => false)))
      throw new BadRequestException({ statusCode: 400, message: 'La contraseña actual no es correcta', campos: { actual: 'La contraseña actual no es correcta' } });
    await this.prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash: await hash(nueva) } });
    return { ok: true };
  }
}
