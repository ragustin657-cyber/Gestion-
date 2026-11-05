import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export function configurarApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
