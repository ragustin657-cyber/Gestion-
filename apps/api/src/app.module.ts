import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ArticulosModule } from './articulos/articulos.module';
import { MonedasModule } from './monedas/monedas.module';
import { OrganizacionModule } from './organizacion/organizacion.module';
import { TesoreriaMaestrosModule } from './tesoreria/maestros/tesoreria-maestros.module';
import { ConfigComprasModule } from './compras/config/config-compras.module';
import { AsientosModule } from './contabilidad/asientos/asientos.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthModule } from './auth/auth.module';
import { PlanCuentasModule } from './contabilidad/plan-cuentas/plan-cuentas.module';
import { EmpresasModule } from './empresas/empresas.module';
import { NumeracionModule } from './numeracion/numeracion.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaludController } from './salud/salud.controller';
import { TercerosModule } from './terceros/terceros.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    AuditoriaModule,
    NumeracionModule,
    PlanCuentasModule,
    AsientosModule,
    AuthModule,
    EmpresasModule,
    UsuariosModule,
    TercerosModule,
    ArticulosModule,
    MonedasModule,
    OrganizacionModule,
    TesoreriaMaestrosModule,
    ConfigComprasModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
