import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ContextoRequest } from '../contexto/contexto';
import { AuthService } from './auth.service';
import { Publico } from './publico.decorator';
import { UsuarioActual } from './usuario-actual.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body?.email, body?.password);
  }

  @Post('empresa')
  @HttpCode(200)
  empresa(@UsuarioActual() ctx: ContextoRequest, @Body() body: { empresaId: string }) {
    return this.auth.seleccionarEmpresa(ctx.usuarioId, body?.empresaId);
  }

  @Get('yo')
  yo(@UsuarioActual() ctx: ContextoRequest) {
    return ctx;
  }
}
