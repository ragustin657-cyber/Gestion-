import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { SoloSuperadmin } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import type { ContextoRequest } from '../contexto/contexto';
import { IndicesInflacionService } from './indices-inflacion.service';

const esquemaValor = z.object({ valor: z.coerce.number().positive('El índice debe ser mayor que cero') });
const esquemaPeriodo = z.object({ anio: z.number().int().min(1900).max(2999), mes: z.number().int().min(1, 'Mes inválido').max(12, 'Mes inválido') });
type Archivo = { buffer: Buffer };

@Controller('indices-inflacion')
export class IndicesInflacionController {
  constructor(private readonly indices: IndicesInflacionService) {}

  @Get()
  listar() {
    return this.indices.listar();
  }

  @Put(':anio/:mes')
  @SoloSuperadmin()
  guardar(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number, @Body(new ZodValidationPipe(esquemaValor)) d: z.infer<typeof esquemaValor>, @UsuarioActual() ctx: ContextoRequest) {
    const p = new ZodValidationPipe(esquemaPeriodo).transform({ anio, mes }) as { anio: number; mes: number };
    return this.indices.guardar(p.anio, p.mes, d.valor, ctx.usuarioId);
  }

  @Delete(':anio/:mes')
  @SoloSuperadmin()
  borrar(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.indices.borrar(anio, mes);
  }

  @Post('importar')
  @SoloSuperadmin()
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 1024 * 1024 } }))
  importar(@UploadedFile() archivo: Archivo | undefined, @UsuarioActual() ctx: ContextoRequest) {
    return this.indices.importar(archivo?.buffer, ctx.usuarioId);
  }
}
