import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';

export const UsuarioActual = createParamDecorator(
  (_: unknown, _ctx: ExecutionContext): ContextoRequest =>
    ClsServiceManager.getClsService().get(CLAVE_CONTEXTO),
);
