import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { esPermiso, Permiso } from '@gestion/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { ES_PUBLICO } from './publico.decorator';

export interface PayloadJwt {
  sub: string;
  empresaId?: string;
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Debe iniciar sesión');

    let payload: PayloadJwt;
    try {
      payload = await this.jwt.verifyAsync<PayloadJwt>(token);
    } catch {
      throw new UnauthorizedException('Sesión vencida o inválida');
    }

    const usuario = await this.prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!usuario || !usuario.activo) throw new UnauthorizedException('Sesión vencida o inválida');

    let permisos: Permiso[] = [];
    let sucursalId: string | null = null;
    if (payload.empresaId) {
      const acceso = await this.prisma.usuarioEmpresa.findUnique({
        where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: payload.empresaId } },
        include: { rol: true, empresa: true },
      });
      if (!acceso || !acceso.activo || !acceso.empresa.activa)
        throw new UnauthorizedException('Sesión vencida o inválida');
      permisos = acceso.rol.permisos.filter(esPermiso);
      sucursalId = acceso.sucursalId;
    }

    const contexto: ContextoRequest = {
      usuarioId: usuario.id,
      empresaId: payload.empresaId ?? null,
      permisos,
      superadmin: usuario.superadmin,
      sucursalId,
    };
    this.cls.set(CLAVE_CONTEXTO, contexto);
    return true;
  }
}
