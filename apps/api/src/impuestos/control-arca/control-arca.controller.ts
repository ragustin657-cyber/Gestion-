import { Body, Controller, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zFecha } from '../../compras/comun';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { Fila, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { ControlArcaService } from './control-arca.service';

const esquema = z.object({ sentido: z.enum(['RECIBIDOS', 'EMITIDOS']), desde: zFecha, hasta: zFecha });

@Controller('impuestos/control-arca')
@RequierePermiso('impuestos.presentar')
export class ControlArcaController {
  constructor(private readonly control: ControlArcaService) {}

  @Post() @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async controlar(
    @Body(new ZodValidationPipe(esquema)) b: z.infer<typeof esquema>, @UploadedFile() archivo: { buffer: Buffer } | undefined,
    @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response,
  ) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const r = await this.control.controlar({ sentido: b.sentido, desde: iso(b.desde), hasta: iso(b.hasta), archivo: archivo?.buffer ?? Buffer.alloc(0) });
    if (formato !== 'xlsx') return r;
    const filas: Fila[] = [
      ...r.soloArca.map((x) => ['En ARCA y no en el sistema', x.fecha, x.tipo, x.puntoVenta, x.numero, x.documento, x.total, null]),
      ...r.soloSistema.map((x) => ['En el sistema y no en ARCA', x.fecha, x.tipo, x.puntoVenta, x.numero, x.documento, null, x.total]),
      ...r.diferencias.map((x) => ['Con diferencias', x.fecha, x.tipo, x.puntoVenta, x.numero, x.documento, x.arca.total, x.sistema.total]),
    ];
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="control-arca-${iso(b.desde)}-${iso(b.hasta)}.xlsx"` });
    return new StreamableFile(await tablaXlsx('Control con Mis Comprobantes', `${b.sentido === 'RECIBIDOS' ? 'Recibidos' : 'Emitidos'} · coinciden ${r.coinciden}`, [
      { titulo: 'Situación', ancho: 28 }, { titulo: 'Fecha', ancho: 12 }, { titulo: 'Tipo', ancho: 6 }, { titulo: 'P. venta', ancho: 9 }, { titulo: 'Número', ancho: 12 },
      { titulo: 'Documento', ancho: 15 }, { titulo: 'Total ARCA', ancho: 15, importe: true }, { titulo: 'Total sistema', ancho: 15, importe: true },
    ], filas));
  }
}
