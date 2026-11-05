import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './comun/prisma-exception.filter';

export function configurarApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();
}

async function bootstrap() {
  try {
    process.loadEnvFile();
  } catch {
    /* sin archivo .env: se usan las variables del entorno */
  }
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
