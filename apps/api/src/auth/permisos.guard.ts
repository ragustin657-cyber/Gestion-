import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Permiso } from '@gestion/shared';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { PERMISOS_ALGUNO, PERMISOS_REQUERIDOS, SOLO_SUPERADMIN } from './requiere-permiso.decorator';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const objetivos = [ctx.getHandler(), ctx.getClass()];
    const requeridos = this.reflector.getAllAndOverride<Permiso[]>(PERMISOS_REQUERIDOS, objetivos) ?? [];
    const alguno = this.reflector.getAllAndOverride<Permiso[]>(PERMISOS_ALGUNO, objetivos) ?? [];
    const soloSuper = this.reflector.getAllAndOverride<boolean>(SOLO_SUPERADMIN, objetivos) ?? false;
    if (!requeridos.length && !alguno.length && !soloSuper) return true;

    const c = this.cls.get<ContextoRequest | undefined>(CLAVE_CONTEXTO);
    if (c?.superadmin) return true;
    const okTodos = requeridos.every((p) => c?.permisos.includes(p));
    const okAlguno = !alguno.length || alguno.some((p) => c?.permisos.includes(p));
    if (!soloSuper && c && okTodos && okAlguno) return true;
    throw new ForbiddenException('No tiene permiso para realizar esta acción');
  }
}
