import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

export async function crearApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configurarApp(app);
  await app.init();
  return app;
}

export async function limpiarBase(prisma: PrismaService) {
  const tablas: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' AND tablename <> 'Moneda'`,
  );
  if (tablas.length)
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tablas.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`,
    );
}
