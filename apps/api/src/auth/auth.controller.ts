import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { zPassword } from '../comun/esquemas';
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

  @Patch('password')
  cambiarPassword(
    @UsuarioActual() ctx: ContextoRequest,
    @Body(new ZodValidationPipe(z.object({ actual: z.string().min(1), nueva: zPassword }))) d: { actual: string; nueva: string },
  ) {
    return this.auth.cambiarPassword(ctx.usuarioId, d.actual, d.nueva);
  }

  @Get('yo')
  yo(@UsuarioActual() ctx: ContextoRequest) {
    return ctx;
  }
}
