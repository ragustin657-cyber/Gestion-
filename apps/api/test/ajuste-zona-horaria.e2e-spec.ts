import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { escenarioEjemplo } from './helpers-ajuste';

/** Con la base en hora argentina, los asientos del último día del mes deben entrar en el cálculo. */
describe('ajuste por inflación: zona horaria de la base', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const admin = new PrismaClient();
  const base = () => new URL(process.env.DATABASE_URL!).pathname.slice(1);
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`ALTER DATABASE "${base()}" SET timezone = 'America/Argentina/Buenos_Aires'`);
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => {
    await app.close();
    await admin.$executeRawUnsafe(`ALTER DATABASE "${base()}" RESET timezone`);
    await admin.$disconnect();
  });

  it('no duplica el ajuste del último día del mes', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await prisma.$queryRawUnsafe<{ tz: string }[]>('SHOW timezone'))[0]).toEqual({ TimeZone: 'America/Argentina/Buenos_Aires' });
    expect((await e.s.http.post('/api/contabilidad/ajuste-inflacion', { fecha: '2026-03-31' })).status).toBe(201);
    const otra = await e.s.http.post('/api/contabilidad/ajuste-inflacion', { fecha: '2026-03-31' });
    expect(otra.body.message).toBe('No hay diferencias para ajustar');
  });
});
