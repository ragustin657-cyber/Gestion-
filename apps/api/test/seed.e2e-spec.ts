import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { validarCuit } from '@gestion/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { sembrarCompleto } from '../src/seed/demo-completo';
import { limpiarBase } from './helpers';

describe('seed demo', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await mod.init();
    prisma = app.get(PrismaService);
    await limpiarBase(prisma);
  });
  afterAll(async () => app.close());

  it('crea la empresa demo con maestros y circuito de compras; es idempotente', async () => {
    expect(await sembrarCompleto(app)).toBe('creada');
    expect(await sembrarCompleto(app)).toBe('existente');

    const terceros = await prisma.tercero.findMany();
    expect(terceros).toHaveLength(9);
    for (const t of terceros) expect(validarCuit(t.cuit)).toBe(true);
    expect(await prisma.articulo.count()).toBe(10);
    expect(await prisma.rol.count()).toBe(5);
    expect(await prisma.usuario.findUnique({ where: { email: 'aprobador@demo.com' } })).not.toBeNull();

    const ocs = await prisma.ordenCompra.findMany();
    expect(ocs).toHaveLength(5);
    expect(new Set(ocs.map((o) => o.estado))).toEqual(new Set(['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'PARCIALMENTE_RECIBIDA', 'CUMPLIDA']));
    expect(await prisma.comprobanteCompra.count()).toBe(3);

    expect(await prisma.usuario.findUnique({ where: { email: 'tesorero@demo.com' } })).not.toBeNull();
    const ops = await prisma.ordenPago.findMany();
    expect(new Set(ops.map((o) => o.estado))).toEqual(new Set(['PAGADA', 'APROBADA', 'PENDIENTE_APROBACION']));
    expect(await prisma.ordenPagoRetencion.count({ where: { certificadoNumero: { not: null } } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.padronIibb.count({ where: { jurisdiccion: '902' } })).toBe(3);

    for (const a of await prisma.asiento.findMany({ include: { renglones: true } })) {
      const debe = a.renglones.reduce((s, r) => s + Math.round(Number(r.debe) * 100), 0);
      const haber = a.renglones.reduce((s, r) => s + Math.round(Number(r.haber) * 100), 0);
      expect(debe).toBe(haber);
    }
  });
});
