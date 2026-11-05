import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DEMO } from '../src/seed/demo';
import { sembrarCompleto } from '../src/seed/demo-completo';

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    /* sin .env */
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const r = await sembrarCompleto(app);
    console.log(r === 'creada'
      ? `Empresa demo creada. Ingresá con ${DEMO.email} / ${DEMO.password} (aprobador: ${DEMO.aprobador} / ${DEMO.passwordAprobador})`
      : 'La empresa demo ya existía; no se modificó nada.');
  } finally {
    await app.close();
  }
}

void main();
