import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './comun/prisma-exception.filter';

export function configurarApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();
  // Detrás de un proxy (TRUST_PROXY=1 o la cantidad de saltos): req.ip toma la IP real del cliente para el límite de login (E36)
  if (process.env.TRUST_PROXY) (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
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
