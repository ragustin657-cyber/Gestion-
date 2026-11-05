import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CondicionIva } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso, SoloSuperadmin } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ContextoRequest } from '../contexto/contexto';
import { zCuit, zTexto, zTextoOpcional } from '../comun/esquemas';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { EmpresasService } from './empresas.service';

const esquemaEmpresa = z.object({
  razonSocial: zTexto,
  cuit: zCuit,
  condicionIva: z.nativeEnum(CondicionIva),
  domicilio: zTextoOpcional,
  inicioEjercicioMes: z.number().int().min(1).max(12).nullish().transform((v) => v ?? 1),
  agenteRetencionGanancias: z.boolean().optional(),
  agenteRetencionIva: z.boolean().optional(),
  agenteRetencionSuss: z.boolean().optional(),
  jurisdiccionesIibb: z.array(z.string().regex(/^9\d\d$/, 'Jurisdicción inválida')).optional(),
});
const esquemaPuntoVenta = z.object({
  numero: z.number().int().min(1).max(99999),
  descripcion: zTextoOpcional,
});

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Post()
  @SoloSuperadmin()
  crear(@Body(new ZodValidationPipe(esquemaEmpresa)) d: z.infer<typeof esquemaEmpresa>, @UsuarioActual() ctx: ContextoRequest) {
    return this.empresas.crear(d, ctx.usuarioId);
  }

  @Get('actual')
  @RequierePermiso('empresa.administrar')
  actual() {
    return this.empresas.actual();
  }

  @Patch('actual')
  @RequierePermiso('empresa.administrar')
  modificar(@Body(new ZodValidationPipe(esquemaEmpresa.partial())) d: Partial<z.infer<typeof esquemaEmpresa>>) {
    return this.empresas.modificarActual(d);
  }

  @Get('actual/puntos-venta')
  @RequierePermiso('empresa.administrar')
  puntosVenta() {
    return this.empresas.puntosVenta();
  }

  @Post('actual/puntos-venta')
  @RequierePermiso('empresa.administrar')
  crearPuntoVenta(@Body(new ZodValidationPipe(esquemaPuntoVenta)) d: z.infer<typeof esquemaPuntoVenta>) {
    return this.empresas.crearPuntoVenta(d);
  }
}
