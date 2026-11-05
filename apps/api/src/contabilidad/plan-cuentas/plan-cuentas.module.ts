import { Global, Module } from '@nestjs/common';
import { PlanCuentasController } from './plan-cuentas.controller';
import { PlanCuentasService } from './plan-cuentas.service';

@Global()
@Module({ controllers: [PlanCuentasController], providers: [PlanCuentasService], exports: [PlanCuentasService] })
export class PlanCuentasModule {}
