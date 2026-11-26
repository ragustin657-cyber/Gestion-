import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { esquemaEscalas, type DatosEscalas } from '../ventas/precios/escalas';
import { z } from 'zod';
import { esAlicuotaIva, esUnidadArba } from '@gestion/shared';
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
  rubroId: z.string().uuid('Valor inválido').nullish(),
  // E57: COT de ARBA
  codigoNomencladorArba: z.string().trim().regex(/^\d{6}$/, 'El código del nomenclador de ARBA tiene 6 dígitos').nullish(),
  unidadMedidaArba: z.string().trim().refine(esUnidadArba, 'Unidad de medida de ARBA inválida').nullish(),
});

@Controller('articulos')
export class ArticulosController {
  constructor(private readonly articulos: ArticulosService) {}

  @Get()
  @RequierePermiso('articulo.ver')
  listar(@Query() q: { q?: string; activo?: string; pagina?: string; porPagina?: string; rubroId?: string }) {
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

  @Get(':id/escalas')
  @RequierePermiso('articulo.ver')
  escalas(@Param('id', ParseUUIDPipe) id: string) {
    return this.articulos.escalas(id);
  }

  @Put(':id/escalas')
  @RequierePermiso('articulo.editar')
  guardarEscalas(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaEscalas)) d: DatosEscalas) {
    return this.articulos.guardarEscalas(id, d);
  }
}
