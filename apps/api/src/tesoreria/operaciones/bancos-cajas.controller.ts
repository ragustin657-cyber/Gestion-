import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { BancosService } from './bancos.service';
import { CajasService } from './cajas.service';
import {
  DatosArqueo, DatosMovimientoBancario, DatosMovimientoCaja, DatosTransferenciaInterna,
  esquemaArqueo, esquemaMovimientoBancario, esquemaMovimientoCaja, esquemaTransferenciaInterna,
} from './dto';

type Pagina = { pagina?: string; porPagina?: string };

@Controller('tesoreria')
export class BancosCajasController {
  constructor(
    private readonly bancos: BancosService,
    private readonly cajas: CajasService,
  ) {}

  @Get('movimientos-bancarios') @RequierePermiso('tesoreria.ver')
  movimientosBancarios(@Query() q: Pagina & { cuentaBancariaId?: string }) {
    return this.bancos.listarMovimientos(q);
  }

  @Post('movimientos-bancarios') @RequierePermiso('tesoreria.aceptar')
  movimientoBancario(@Body(new ZodValidationPipe(esquemaMovimientoBancario)) d: DatosMovimientoBancario) {
    return this.bancos.movimiento(d);
  }

  @Get('transferencias-internas') @RequierePermiso('tesoreria.ver')
  transferencias(@Query() q: Pagina) {
    return this.bancos.listarTransferencias(q);
  }

  @Post('transferencias-internas') @RequierePermiso('tesoreria.aceptar')
  transferencia(@Body(new ZodValidationPipe(esquemaTransferenciaInterna)) d: DatosTransferenciaInterna) {
    return this.bancos.transferencia(d);
  }

  @Get('movimientos-caja') @RequierePermiso('tesoreria.ver')
  movimientosCaja(@Query() q: Pagina & { cajaId?: string }) {
    return this.cajas.listarMovimientos(q);
  }

  @Post('movimientos-caja') @RequierePermiso('tesoreria.operar')
  movimientoCaja(@Body(new ZodValidationPipe(esquemaMovimientoCaja)) d: DatosMovimientoCaja) {
    return this.cajas.movimiento(d);
  }

  @Get('arqueos') @RequierePermiso('tesoreria.ver')
  arqueos(@Query() q: Pagina & { cajaId?: string }) {
    return this.cajas.listarArqueos(q);
  }

  @Post('arqueos') @RequierePermiso('tesoreria.operar')
  arqueo(@Body(new ZodValidationPipe(esquemaArqueo)) d: DatosArqueo) {
    return this.cajas.arqueo(d);
  }
}
