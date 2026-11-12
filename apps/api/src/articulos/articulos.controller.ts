import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { esAlicuotaIva } from '@gestion/shared';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { zTexto } from '../comun/esquemas';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ArticulosService } from './articulos.service';

const esquema = z.object({
  codigo: zTexto,
  descripcion: zTexto,
  unidad: zTexto.nullish().transform((v) => v ?? undefined),
  alicuotaIva: z.number().refine(esAlicuotaIva, 'Alícuota de IVA inválida'),
  cuentaCompraId: z.string().uuid().optional().nullable(),
  cuentaVentaId: z.string().uuid().optional().nullable(),
  esServicio: z.boolean().optional(),
  activo: z.boolean().optional(),
  controlaStock: z.boolean().optional(),
});

@Controller('articulos')
export class ArticulosController {
  constructor(private readonly articulos: ArticulosService) {}

  @Get()
  @RequierePermiso('articulo.ver')
  listar(@Query() q: { q?: string; activo?: string; pagina?: string; porPagina?: string }) {
    return this.articulos.listar(q);
  }

  @Get(':id')
  @RequierePermiso('articulo.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.articulos.obtener(id);
  }

  @Post()
  @RequierePermiso('articulo.editar')
  crear(@Body(new ZodValidationPipe(esquema)) d: z.infer<typeof esquema>) {
    return this.articulos.crear(d);
  }

  @Patch(':id')
  @RequierePermiso('articulo.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquema.partial())) d: Partial<z.infer<typeof esquema>>) {
    return this.articulos.modificar(id, d);
  }
}
