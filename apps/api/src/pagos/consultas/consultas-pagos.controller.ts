import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasPagosService } from './consultas-pagos.service';

type FiltroRet = { desde?: string; hasta?: string; impuesto?: string; jurisdiccion?: string; incluirAnuladas?: string; formato?: string };

@Controller('pagos')
@RequierePermiso('op.ver')
export class ConsultasPagosController {
  constructor(private readonly consultas: ConsultasPagosService) {}

  @Get('pagos-a-realizar')
  pagosARealizar(@Query('fecha') fecha?: string) {
    return this.consultas.pagosARealizar(fecha);
  }

  @Get('retenciones')
  async retenciones(@Query() f: FiltroRet, @Res({ passthrough: true }) res: Response) {
    if (f.formato !== 'xlsx') return this.consultas.retenciones(f);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="retenciones-${f.desde}-${f.hasta}.xlsx"`,
    });
    return new StreamableFile(await this.consultas.retencionesXlsx(f));
  }

  @Get('ordenes/:id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.consultas.pdfOP(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }

  @Get('ordenes/:id/certificados/:retencionId/pdf')
  async certificado(@Param('id', ParseUUIDPipe) id: string, @Param('retencionId', ParseUUIDPipe) retencionId: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.consultas.pdfCertificado(id, retencionId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }
}
