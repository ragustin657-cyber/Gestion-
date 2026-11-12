import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { CargaPresupuestoService } from './carga.service';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { DatosLinea, DatosPresupuesto, esquemaLinea, esquemaModificacion, esquemaPresupuesto } from './dto';
import { PresupuestosService } from './presupuestos.service';

const esquemaRepartir = z.object({ cuentaContableId: z.string().uuid(), centroCostoId: z.string().uuid().nullish(), total: z.number().min(0) });

@Controller('presupuestos')
export class PresupuestosController {
  constructor(private readonly presupuestos: PresupuestosService, private readonly carga: CargaPresupuestoService) {}

  @Get()
  @RequierePermiso('presupuesto.ver')
  listar(@Query('ejercicioId') ejercicioId?: string) {
    return this.presupuestos.listar(ejercicioId);
  }

  @Post()
  @RequierePermiso('presupuesto.editar')
  crear(@Body(new ZodValidationPipe(esquemaPresupuesto)) d: DatosPresupuesto) {
    return this.presupuestos.crear(d);
  }

  @Put(':id')
  @RequierePermiso('presupuesto.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModificacion)) d: { nombre: string; observaciones?: string | null }) {
    return this.presupuestos.modificar(id, d);
  }

  @Post(':id/vigente')
  @RequierePermiso('presupuesto.editar')
  vigente(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestos.marcarVigente(id);
  }

  @Delete(':id')
  @RequierePermiso('presupuesto.editar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestos.eliminar(id);
  }

  @Get(':id/grilla')
  @RequierePermiso('presupuesto.ver')
  grilla(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestos.grilla(id);
  }

  @Put(':id/lineas')
  @RequierePermiso('presupuesto.editar')
  guardarLinea(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaLinea)) d: DatosLinea) {
    return this.presupuestos.guardarLinea(id, d);
  }

  @Post(':id/lineas/repartir')
  @RequierePermiso('presupuesto.editar')
  repartir(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRepartir)) d: z.infer<typeof esquemaRepartir>) {
    return this.carga.repartir(id, d);
  }

  @Post(':id/desde-real')
  @RequierePermiso('presupuesto.editar')
  desdeReal(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ ajustePct: z.number().min(-100).max(10000).default(0) }))) d: { ajustePct: number }) {
    return this.carga.desdeReal(id, d.ajustePct);
  }

  @Get(':id/exportar')
  @RequierePermiso('presupuesto.ver')
  async exportar(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const x = await this.carga.exportar(id);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${x.nombre}"` });
    return new StreamableFile(x.contenido);
  }

  @Post(':id/importar')
  @RequierePermiso('presupuesto.editar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importar(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() archivo?: { buffer: Buffer; originalname: string }) {
    return this.carga.importar(id, archivo?.buffer, archivo?.originalname ?? 'presupuesto.csv');
  }

  @Delete(':id/lineas')
  @HttpCode(200)
  @RequierePermiso('presupuesto.editar')
  eliminarLinea(@Param('id', ParseUUIDPipe) id: string, @Query('cuentaContableId', ParseUUIDPipe) cuentaContableId: string, @Query('centroCostoId') centroCostoId?: string) {
    return this.presupuestos.eliminarLinea(id, cuentaContableId, centroCostoId || null);
  }
}
