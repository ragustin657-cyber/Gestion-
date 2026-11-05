import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthModule } from './auth/auth.module';
import { EmpresasModule } from './empresas/empresas.module';
import { NumeracionModule } from './numeracion/numeracion.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaludController } from './salud/salud.controller';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    AuditoriaModule,
    NumeracionModule,
    AuthModule,
    EmpresasModule,
    UsuariosModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
