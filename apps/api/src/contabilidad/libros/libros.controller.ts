import { Body, Controller, Get, HttpCode, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zFecha } from '../../compras/comun';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { LibrosService } from './libros.service';

const zFolio = z.number().int().min(1).max(1000000).nullish();
const esquemaDiario = z.object({ desde: zFecha, hasta: zFecha, folioInicial: zFolio });
const esquemaInventarios = z.object({ ejercicioId: z.string().uuid(), folioInicial: zFolio });

@Controller('contabilidad/libros')
@RequierePermiso('contabilidad.cerrar')
export class LibrosController {
  constructor(private readonly libros: LibrosService) {}

  private enviar(res: Response, nombre: string, r: { pdf: Buffer; folioInicial: number; folioFinal: number; advertencia: string | null }) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.setHeader('X-Folio-Inicial', String(r.folioInicial));
    res.setHeader('X-Folio-Final', String(r.folioFinal));
    res.setHeader('Access-Control-Expose-Headers', 'X-Folio-Inicial, X-Folio-Final, X-Advertencia');
    if (r.advertencia) res.setHeader('X-Advertencia', r.advertencia);
    return new StreamableFile(r.pdf);
  }

  @Post('diario') @HttpCode(200)
  async diario(@Body(new ZodValidationPipe(esquemaDiario)) d: z.infer<typeof esquemaDiario>, @Res({ passthrough: true }) res: Response) {
    return this.enviar(res, `libro-diario-${d.desde.toISOString().slice(0, 10)}.pdf`, await this.libros.diario(d.desde, d.hasta, d.folioInicial ?? undefined));
  }

  @Post('inventarios') @HttpCode(200)
  async inventarios(@Body(new ZodValidationPipe(esquemaInventarios)) d: z.infer<typeof esquemaInventarios>, @Res({ passthrough: true }) res: Response) {
    return this.enviar(res, 'libro-inventarios-y-balances.pdf', await this.libros.inventarios(d.ejercicioId, d.folioInicial ?? undefined));
  }

  @Get('emisiones')
  emisiones() {
    return this.libros.emisiones();
  }
}
