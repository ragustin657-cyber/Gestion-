import { Global, Module } from '@nestjs/common';
import { AlcanceSucursalService } from './alcance.service';
import { SucursalesController } from './sucursales.controller';
import { SucursalesService } from './sucursales.service';

@Global()
@Module({
  controllers: [SucursalesController],
  providers: [SucursalesService, AlcanceSucursalService],
  exports: [SucursalesService, AlcanceSucursalService],
})
export class SucursalesModule {}
