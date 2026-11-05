import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { formatearNumero } from '@gestion/shared';
import { CLAVE_CONTEXTO } from '../contexto/contexto';
import { limpiarBase } from '../../test/helpers';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { NumeracionService } from './numeracion.service';

describe('NumeracionService', () => {
  let prisma: PrismaService;
  let tenant: TenantPrisma;
  let cls: ClsService;
  let numeracion: NumeracionService;
  let A: string;
  let B: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), PrismaModule],
      providers: [NumeracionService],
    }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    tenant = mod.get(TenantPrisma);
    cls = mod.get(ClsService);
    numeracion = mod.get(NumeracionService);
  });
  afterAll(async () => prisma.$disconnect());

  beforeEach(async () => {
    await limpiarBase(prisma);
    const d = { cuit: '30712345671', condicionIva: 'RESPONSABLE_INSCRIPTO' as const };
    A = (await prisma.empresa.create({ data: { razonSocial: 'A', ...d } })).id;
    B = (await prisma.empresa.create({ data: { razonSocial: 'B', ...d } })).id;
  });

  const siguiente = (empresaId: string, tipo: string, pv: number) =>
    cls.run(() => {
      cls.set(CLAVE_CONTEXTO, { usuarioId: 'u', empresaId, permisos: [], superadmin: false });
      return tenant.transaccion((tx) => numeracion.siguiente(tx, tipo, pv));
    });

  it('empieza en 1 y avanza', async () => {
    expect(await siguiente(A, 'OC', 1)).toBe(1);
    expect(await siguiente(A, 'OC', 1)).toBe(2);
  });

  it('talonarios de distinto tipo, punto de venta o empresa son independientes', async () => {
    await siguiente(A, 'OC', 1);
    expect(await siguiente(A, 'OP', 1)).toBe(1);
    expect(await siguiente(A, 'OC', 2)).toBe(1);
    expect(await siguiente(B, 'OC', 1)).toBe(1);
  });

  it('20 pedidos concurrentes no repiten número', async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => siguiente(A, 'OC', 1)));
    expect([...nums].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('formatearNumero', () => expect(formatearNumero(1, 42)).toBe('0001-00000042'));
});
