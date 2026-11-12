import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { esquemaAumento, esquemaLista, esquemaModLista, esquemaPrecio } from './dto';
import { PreciosService } from './precios.service';

@Controller('ventas')
export class PreciosController {
  constructor(
    private readonly precios: PreciosService,
    private readonly tenant: TenantPrisma,
  ) {}

  @Get('listas') @RequierePermiso()
  listas() {
    return this.precios.listas();
  }

  @Post('listas') @RequierePermiso('precios.editar')
  crear(@Body(new ZodValidationPipe(esquemaLista)) d: z.infer<typeof esquemaLista>) {
    return this.precios.crearLista(d);
  }

  @Patch('listas/:id') @RequierePermiso('precios.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModLista)) d: z.infer<typeof esquemaModLista>) {
    return this.precios.modificarLista(id, d);
  }

  @Get('listas/:id/precios') @RequierePermiso('venta.ver')
  preciosDe(@Param('id', ParseUUIDPipe) id: string, @Query('q') q?: string) {
    return this.precios.precios(id, q);
  }

  @Put('listas/:id/precios/:articuloId') @RequierePermiso('precios.editar')
  fijar(@Param('id', ParseUUIDPipe) id: string, @Param('articuloId', ParseUUIDPipe) articuloId: string, @Body(new ZodValidationPipe(esquemaPrecio)) d: { precio: number }) {
    return this.precios.fijarPrecio(id, articuloId, d.precio);
  }

  @Delete('listas/:id/precios/:articuloId') @RequierePermiso('precios.editar')
  borrar(@Param('id', ParseUUIDPipe) id: string, @Param('articuloId', ParseUUIDPipe) articuloId: string) {
    return this.precios.fijarPrecio(id, articuloId, null);
  }

  @Post('listas/:id/aumento') @RequierePermiso('precios.editar')
  aumento(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAumento)) d: z.infer<typeof esquemaAumento>) {
    return this.precios.aumento(id, d);
  }

  @Post('listas/:id/importar') @RequierePermiso('precios.editar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importar(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() archivo?: { buffer: Buffer; originalname: string }) {
    return this.precios.importar(id, archivo?.buffer, archivo?.originalname ?? 'precios.csv');
  }

  @Get('listas/:id/historial') @RequierePermiso('venta.ver')
  historial(@Param('id', ParseUUIDPipe) id: string, @Query('articuloId') articuloId?: string) {
    return this.precios.historial(id, articuloId);
  }

  @Get('precio') @RequierePermiso()
  sugerido(@Query() q: { terceroId: string; articuloId: string; monedaCodigo: string; cotizacion?: string }) {
    return this.precios.sugerido(this.tenant.db, { ...q, cotizacion: q.cotizacion ? Number(q.cotizacion) : null });
  }
}
