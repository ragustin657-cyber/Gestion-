import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
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

  async login(email: string, password: string, ip = '') {
    const correo = String(email ?? '').trim().toLowerCase();
    const claves = [`email:${correo}`, ...(ip ? [`ip:${ip}`] : [])];
    await this.controlarIntentos(claves);
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: correo },
      include: { empresas: { where: { activo: true, empresa: { activa: true } }, include: { empresa: true } } },
    });
    // Tiempo parejo (E36): sin usuario activo se verifica igual contra un hash ficticio
    const hashAVerificar = usuario?.activo ? usuario.passwordHash : await this.hashFicticio();
    const ok = (await verify(hashAVerificar, String(password ?? '')).catch(() => false)) && !!usuario?.activo;
    if (!usuario || !ok) {
      await this.registrarFallido(claves);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    await this.prisma.intentoLogin.deleteMany({ where: { clave: `email:${correo}` } });

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
      superadmin: (await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).superadmin,
      sucursal: acceso.sucursalId
        ? await this.prisma.sucursal.findUnique({ where: { id: acceso.sucursalId }, select: { id: true, codigo: true, nombre: true } })
        : null,
    };
  }

  async cambiarPassword(usuarioId: string, actual: string, nueva: string) {
    const u = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (!(await verify(u.passwordHash, actual).catch(() => false)))
      throw new BadRequestException({ statusCode: 400, message: 'La contraseña actual no es correcta', campos: { actual: 'La contraseña actual no es correcta' } });
    await this.prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash: await hash(nueva) } });
    return { ok: true };
  }

  // --- Límite de intentos de login (E36): 5 fallidos por email o por IP en 15 minutos ---
  private ficticio?: Promise<string>;
  private hashFicticio() {
    this.ficticio ??= hash('clave-ficticia-para-tiempo-parejo');
    return this.ficticio;
  }

  private async controlarIntentos(claves: string[]) {
    const desde = new Date(Date.now() - VENTANA_INTENTOS_MS);
    for (const clave of claves)
      if ((await this.prisma.intentoLogin.count({ where: { clave, creadoEn: { gte: desde } } })) >= MAXIMO_INTENTOS)
        throw new HttpException('Demasiados intentos: espere unos minutos', HttpStatus.TOO_MANY_REQUESTS);
  }

  private async registrarFallido(claves: string[]) {
    const ahora = new Date();
    await this.prisma.intentoLogin.deleteMany({ where: { creadoEn: { lt: new Date(ahora.getTime() - VENTANA_INTENTOS_MS) } } });
    await this.prisma.intentoLogin.createMany({ data: claves.map((clave) => ({ clave, creadoEn: ahora })) });
  }
}

const MAXIMO_INTENTOS = 5;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
