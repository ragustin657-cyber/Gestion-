import { Global, Module } from '@nestjs/common';
import { CargaPresupuestoService } from './carga.service';
import { ComparacionService } from './comparacion.service';
import { PresupuestosController } from './presupuestos.controller';
import { PresupuestosService } from './presupuestos.service';

@Global()
@Module({
  controllers: [PresupuestosController],
  providers: [PresupuestosService, CargaPresupuestoService, ComparacionService],
  exports: [PresupuestosService, ComparacionService],
})
export class PresupuestosModule {}
