import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequiereAlguno, RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasComprasService } from './consultas.service';
import { libroIvaXlsx } from './libro-iva-xlsx';

@Controller('compras')
export class ConsultasComprasController {
  constructor(private readonly consultas: ConsultasComprasService) {}

  @Get('cuenta-corriente/:terceroId')
  @RequierePermiso('fc.ver')
  cuentaCorriente(@Param('terceroId', ParseUUIDPipe) id: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.consultas.cuentaCorriente(id, desde, hasta);
  }

  @Get('antiguedad-deuda')
  @RequierePermiso('fc.ver')
  antiguedad(@Query('fecha') fecha?: string) {
    return this.consultas.antiguedadDeuda(fecha);
  }

  @Get('libro-iva')
  @RequierePermiso('fc.ver')
  async libroIva(
    @Query('desde') desde: string, @Query('hasta') hasta: string, @Query('formato') formato: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const datos = await this.consultas.libroIva(desde, hasta);
    if (formato !== 'xlsx') return datos;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="libro-iva-compras-${desde}-${hasta}.xlsx"`,
    });
    return new StreamableFile(await libroIvaXlsx(datos));
  }

  @Get('buscador')
  @RequierePermiso()
  @RequiereAlguno('oc.ver', 'ir.ver', 'fc.ver')
  buscar(@Query('q') q?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.consultas.buscar(q, desde, hasta);
  }
}
