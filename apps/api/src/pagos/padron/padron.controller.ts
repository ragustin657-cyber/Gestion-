import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { FormatoPadronDef } from './parsers';
import { FileInterceptor } from '@nestjs/platform-express';
import { tmpdir } from 'os';
import { SoloSuperadmin } from '../../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../../auth/usuario-actual.decorator';
import { ContextoRequest } from '../../contexto/contexto';
import { PadronService } from './padron.service';

/** El padrón es común a todas las empresas: solo lo administra el administrador general. */
const columna = z.string().trim().regex(/^(\d{1,3}|\d{1,4}-\d{1,4})$/, 'Columna o posición inválida');
const esquemaFormato = z.object({
  separador: z.enum([';', ',', '|', 'TAB', 'FIJO']), encabezado: z.boolean(), cuit: columna,
  alicuotaPercepcion: columna.nullish().transform((v) => v || null), alicuotaRetencion: columna.nullish().transform((v) => v || null),
  vigenciaDesde: columna.nullish().transform((v) => v || null), vigenciaHasta: columna.nullish().transform((v) => v || null),
  formatoFecha: z.enum(['DDMMAAAA', 'DD/MM/AAAA', 'AAAAMMDD', 'AAAA-MM-DD']), separadorDecimal: z.enum(['.', ',']),
}).refine((d) => d.alicuotaPercepcion || d.alicuotaRetencion, { message: 'Indique la columna de alguna alícuota', path: ['alicuotaRetencion'] })
  // Pulido E49: las dos vigencias o ninguna; en ancho fijo cada campo es «desde-hasta» (desde ≥ 1 y ≤ hasta), si no un número ≥ 1
  .refine((d) => !d.vigenciaDesde === !d.vigenciaHasta, { message: 'Indique las dos vigencias o ninguna', path: ['vigenciaHasta'] })
  .superRefine((d, ctx) => {
    for (const k of ['cuit', 'alicuotaPercepcion', 'alicuotaRetencion', 'vigenciaDesde', 'vigenciaHasta'] as const) {
      const v = d[k];
      if (!v) continue;
      const [a, b] = v.split('-').map(Number);
      const ok = d.separador === 'FIJO' ? v.includes('-') && a >= 1 && b >= a : !v.includes('-') && a >= 1;
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Columna o posición inválida', path: [k] });
    }
  });

@Controller('padrones')
@SoloSuperadmin()
export class PadronController {
  constructor(private readonly padron: PadronService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('archivo', { dest: tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } }))
  cargar(@UploadedFile() archivo: { originalname: string; path: string } | undefined, @Body('jurisdiccion') jurisdiccion: string, @Body('periodo') periodo: string | undefined, @UsuarioActual() ctx: ContextoRequest) {
    if (!archivo) throw new BadRequestException('Falta el archivo del padrón');
    if (periodo && !/^\d{4}(0[1-9]|1[0-2])$/.test(String(periodo))) throw new BadRequestException('Período inválido (AAAAMM)');
    return this.padron.cargar(String(jurisdiccion ?? ''), archivo.originalname, archivo.path, ctx.usuarioId, periodo ? String(periodo) : undefined);
  }

  @Get('formatos/:jurisdiccion')
  formato(@Param('jurisdiccion') jurisdiccion: string) {
    return this.padron.formato(jurisdiccion).then((f) => f ?? {});
  }

  @Put('formatos/:jurisdiccion')
  guardarFormato(@Param('jurisdiccion') jurisdiccion: string, @Body(new ZodValidationPipe(esquemaFormato)) d: FormatoPadronDef) {
    return this.padron.guardarFormato(jurisdiccion, d);
  }

  @Get()
  listar() {
    return this.padron.listar();
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.padron.obtener(id);
  }
}
