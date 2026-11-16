import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { DatosConcepto, DatosEmpleado, esquemaTope, esquemaCategoria, esquemaConcepto, esquemaConvenio, esquemaEdicionEmpleado, esquemaEmpleado, esquemaEscala } from './dto';
import { MaestrosSueldosService } from './maestros.service';

@Controller('sueldos')
export class MaestrosSueldosController {
  constructor(private readonly m: MaestrosSueldosService) {}

  @Get('convenios') @RequierePermiso('sueldos.ver')
  convenios() { return this.m.convenios(); }

  @Post('convenios') @RequierePermiso('sueldos.liquidar')
  crearConvenio(@Body(new ZodValidationPipe(esquemaConvenio)) d: { nombre: string; codigo: string; horasMensuales: number }) { return this.m.crearConvenio(d); }

  @Put('convenios/:id') @RequierePermiso('sueldos.liquidar')
  modificarConvenio(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaConvenio)) d: { nombre: string; codigo: string; horasMensuales: number }) { return this.m.modificarConvenio(id, d); }

  @Post('categorias') @RequierePermiso('sueldos.liquidar')
  crearCategoria(@Body(new ZodValidationPipe(esquemaCategoria)) d: { convenioId: string; nombre: string; orden: number }) { return this.m.crearCategoria(d); }

  @Put('categorias/:id') @RequierePermiso('sueldos.liquidar')
  modificarCategoria(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaCategoria)) d: { nombre: string; orden: number; activa?: boolean }) { return this.m.modificarCategoria(id, d); }

  @Get('escalas') @RequierePermiso('sueldos.ver')
  escalas(@Query('convenioId') convenioId?: string, @Query('anio') anio?: string, @Query('mes') mes?: string) { return this.m.escalas(convenioId, Number(anio), Number(mes)); }

  @Put('escalas') @RequierePermiso('sueldos.liquidar')
  guardarEscala(@Body(new ZodValidationPipe(esquemaEscala)) d: { categoriaId: string; anio: number; mes: number; basico: number }) { return this.m.guardarEscala(d); }

  @Post('escalas/importar') @RequierePermiso('sueldos.liquidar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importar(@Query('convenioId') convenioId?: string, @UploadedFile() archivo?: { buffer: Buffer; originalname: string }) {
    return this.m.importarEscalas(convenioId, archivo?.buffer, archivo?.originalname ?? 'escalas.csv');
  }

  @Get('topes') @RequierePermiso('sueldos.ver')
  topes(@Query('convenioId') convenioId?: string, @Query('anio') anio?: string, @Query('mes') mes?: string) { return this.m.topes(convenioId, anio ? Number(anio) : undefined, mes ? Number(mes) : undefined); }

  @Put('topes') @RequierePermiso('sueldos.liquidar')
  guardarTope(@Body(new ZodValidationPipe(esquemaTope)) d: { convenioId: string; desdeAnio: number; desdeMes: number; importe: number }) { return this.m.guardarTope(d); }

  @Get('empleados') @RequierePermiso('sueldos.ver')
  empleados() { return this.m.empleados(); }

  @Post('empleados') @RequierePermiso('sueldos.liquidar')
  crearEmpleado(@Body(new ZodValidationPipe(esquemaEmpleado)) d: DatosEmpleado) { return this.m.crearEmpleado(d); }

  @Put('empleados/:id') @RequierePermiso('sueldos.liquidar')
  modificarEmpleado(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaEdicionEmpleado)) d: Partial<DatosEmpleado>) { return this.m.modificarEmpleado(id, d); }

  @Get('conceptos') @RequierePermiso('sueldos.ver')
  conceptos() { return this.m.conceptos(); }

  @Post('conceptos') @RequierePermiso('sueldos.liquidar')
  crearConcepto(@Body(new ZodValidationPipe(esquemaConcepto)) d: DatosConcepto) { return this.m.crearConcepto(d); }

  @Put('conceptos/:id') @RequierePermiso('sueldos.liquidar')
  modificarConcepto(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaConcepto)) d: DatosConcepto) { return this.m.modificarConcepto(id, d); }
}
