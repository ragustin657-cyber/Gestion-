import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaludController } from './salud/salud.controller';

@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } }), PrismaModule, AuthModule],
  controllers: [SaludController],
})
export class AppModule {}
