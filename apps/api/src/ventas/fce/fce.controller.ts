import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { esUuid } from '../../comun/esquemas';
import { ObligacionFceService } from './obligacion.service';
import { FceRegistroService } from './registro.service';

const ESTADOS = ['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'ACEPTADA_TACITA'];

@Controller('ventas/fce')
export class FceVentasController {
  constructor(private readonly obligacion: ObligacionFceService, private readonly registro: FceRegistroService) {}

  /** FCE emitidas con su estado en el registro de ARCA (E50 §5). */
  @Get()
  @RequierePermiso('venta.ver')
  listar(@Query('estado') estado?: string) {
    if (estado && !ESTADOS.includes(estado)) throw new BadRequestException('Estado inválido');
    return this.registro.listar('EMISOR', estado || undefined);
  }

  @Post('actualizar')
  @RequierePermiso('venta.ver')
  actualizar() {
    return this.registro.actualizar('EMISOR');
  }

  /** ¿Corresponde factura de crédito MiPyME? (E50) */
  @Get('obligacion')
  @RequierePermiso('venta.emitir')
  consultar(@Query() q: { terceroId?: string; fecha?: string; total?: string }) {
    if (!q.terceroId || !esUuid(q.terceroId)) throw new BadRequestException('Indique el cliente');
    if (!q.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha)) throw new BadRequestException('Fecha inválida');
    if (q.total !== undefined && q.total !== '' && Number.isNaN(Number(q.total))) throw new BadRequestException('Total inválido');
    return this.obligacion.consultar(q.terceroId, q.fecha, q.total);
  }
}

const esquemaRechazo = z.object({
  motivos: z.array(z.string().trim().min(1)).min(1, 'Indique al menos un motivo'),
  texto: z.string().trim().max(250, 'Hasta 250 caracteres').default(''),
});

/** Facturas de crédito MiPyME recibidas (E50 §6). */
@Controller('compras/fce')
export class FceComprasController {
  constructor(private readonly registro: FceRegistroService) {}

  @Get()
  @RequierePermiso('fc.ver')
  listar(@Query('estado') estado?: string) {
    if (estado && !ESTADOS.includes(estado)) throw new BadRequestException('Estado inválido');
    return this.registro.listar('RECEPTOR', estado || undefined);
  }

  @Post('actualizar')
  @RequierePermiso('fc.ver')
  actualizar() {
    return this.registro.actualizar('RECEPTOR');
  }

  @Get('motivos')
  @RequierePermiso('fc.ver')
  motivos() {
    return this.registro.motivos();
  }

  @Post(':id/aceptar')
  @RequierePermiso('fc.crear')
  aceptar(@Param('id', ParseUUIDPipe) id: string) {
    return this.registro.responder(id, { acepta: true });
  }

  @Post(':id/rechazar')
  @RequierePermiso('fc.crear')
  rechazar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRechazo)) b: z.infer<typeof esquemaRechazo>) {
    return this.registro.responder(id, { acepta: false, motivos: b.motivos, texto: b.texto });
  }
}
