import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { TipoPresentacion } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { PresentacionesService } from './presentaciones.service';

const esquema = z.object({
  tipo: z.nativeEnum(TipoPresentacion),
  periodo: z.string().regex(/^\d{4}(0[1-9]|1[0-2])$/, 'Período inválido (AAAAMM)'),
  quincena: z.union([z.literal(1), z.literal(2)]).nullish().transform((v) => v ?? undefined),
});

@Controller('impuestos/presentaciones')
export class PresentacionesController {
  constructor(private readonly presentaciones: PresentacionesService) {}

  @Post() @RequierePermiso('impuestos.presentar')
  generar(@Body(new ZodValidationPipe(esquema)) d: z.infer<typeof esquema>) {
    return this.presentaciones.generar(d);
  }

  @Get() @RequierePermiso('impuestos.ver')
  listar(@Query('tipo') tipo?: string, @Query('periodo') periodo?: string) {
    return this.presentaciones.listar({ tipo, periodo });
  }

  @Get(':id/archivo') @RequierePermiso('impuestos.ver')
  async archivo(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.presentaciones.archivo(id);
    const tipo = p.nombreArchivo.endsWith('.zip') ? 'application/zip' : 'text/plain; charset=latin1';
    res.set({ 'Content-Type': tipo, 'Content-Disposition': `attachment; filename="${p.nombreArchivo}"` });
    return new StreamableFile(Buffer.from(p.contenido));
  }
}
