import { Body, Controller, Get, Put } from '@nestjs/common';
import { ModoStockNegativo } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ConfigStockService } from './config-stock.service';

const esquemaConfig = z.object({ stockNegativo: z.nativeEnum(ModoStockNegativo) });

@Controller('stock')
export class StockController {
  constructor(private readonly config: ConfigStockService) {}

  @Get('config')
  @RequierePermiso('stock.ver')
  obtenerConfig() {
    return this.config.obtener();
  }

  @Put('config')
  @RequierePermiso('stock.operar')
  guardarConfig(@Body(new ZodValidationPipe(esquemaConfig)) d: z.infer<typeof esquemaConfig>) {
    return this.config.guardar(d.stockNegativo);
  }
}
