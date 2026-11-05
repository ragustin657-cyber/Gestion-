import { PrismaClient } from '@prisma/client';
import { limpiarBase } from './helpers';
import { sembrarDemo } from '../src/seed/demo';
import { validarCuit } from '@gestion/shared';

describe('seed demo', () => {
  const prisma = new PrismaClient();
  beforeAll(async () => limpiarBase(prisma as never));
  afterAll(async () => prisma.$disconnect());

  it('crea la empresa demo con CUITs válidos y es idempotente', async () => {
    expect(await sembrarDemo(prisma)).toBe('creada');
    expect(await sembrarDemo(prisma)).toBe('existente');
    const terceros = await prisma.tercero.findMany();
    expect(terceros).toHaveLength(8);
    for (const t of terceros) expect(validarCuit(t.cuit)).toBe(true);
    expect(await prisma.articulo.count()).toBe(10);
    expect(await prisma.rol.count()).toBe(4);
  });
});
