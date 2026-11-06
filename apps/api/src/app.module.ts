import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ArticulosModule } from './articulos/articulos.module';
import { MonedasModule } from './monedas/monedas.module';
import { OrganizacionModule } from './organizacion/organizacion.module';
import { SucursalesModule } from './tesoreria/sucursales/sucursales.module';
import { TesoreriaOperacionesModule } from './tesoreria/tesoreria-operaciones.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { ArcaModule } from './arca/arca.module';
import { ConciliacionModule } from './conciliacion/conciliacion.module';
import { TesoreriaMaestrosModule } from './tesoreria/maestros/tesoreria-maestros.module';
import { ConfigComprasModule } from './compras/config/config-compras.module';
import { AsientosModule } from './contabilidad/asientos/asientos.module';
import { ComprasModule } from './compras/compras.module';
import { PagosModule } from './pagos/pagos.module';
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
    SucursalesModule,
    TesoreriaMaestrosModule,
    ConfigComprasModule,
    ComprasModule,
    PagosModule,
    TesoreriaOperacionesModule,
    ConciliacionModule,
    ContabilidadModule,
    ArcaModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
