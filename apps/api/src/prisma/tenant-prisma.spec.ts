import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { limpiarBase } from '../../test/helpers';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';
import { TenantPrisma } from './tenant-prisma.service';

describe('TenantPrisma', () => {
  let prisma: PrismaService;
  let tenant: TenantPrisma;
  let cls: ClsService;
  let empresaA: string;
  let empresaB: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), PrismaModule],
    }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    tenant = mod.get(TenantPrisma);
    cls = mod.get(ClsService);
  });
  afterAll(async () => prisma.$disconnect());

  beforeEach(async () => {
    await limpiarBase(prisma);
    const datos = { cuit: '30712345671', condicionIva: 'RESPONSABLE_INSCRIPTO' as const };
    empresaA = (await prisma.empresa.create({ data: { razonSocial: 'A', ...datos } })).id;
    empresaB = (await prisma.empresa.create({ data: { razonSocial: 'B', ...datos } })).id;
  });

  function como<T>(empresaId: string | null, fn: () => Promise<T>): Promise<T> {
    return cls.run(async () => {
      const ctx: ContextoRequest = { usuarioId: 'u', empresaId, permisos: [], superadmin: false };
      cls.set(CLAVE_CONTEXTO, ctx);
      return fn();
    });
  }

  const crearRolEnA = () =>
    como(empresaA, () => tenant.db.rol.create({ data: { nombre: 'X', permisos: [] } as never }));

  it('create sin empresaId guarda la empresa del contexto', async () => {
    const rol = await crearRolEnA();
    expect(rol.empresaId).toBe(empresaA);
  });

  it('listar desde otra empresa no ve los datos', async () => {
    await crearRolEnA();
    expect(await como(empresaB, () => tenant.db.rol.findMany())).toEqual([]);
    expect(await como(empresaA, () => tenant.db.rol.findMany())).toHaveLength(1);
  });

  it('findUnique por id desde otra empresa devuelve null', async () => {
    const rol = await crearRolEnA();
    expect(await como(empresaB, () => tenant.db.rol.findUnique({ where: { id: rol.id } }))).toBeNull();
  });

  it('update y delete desde otra empresa fallan como no encontrado', async () => {
    const rol = await crearRolEnA();
    await expect(
      como(empresaB, () => tenant.db.rol.update({ where: { id: rol.id }, data: { nombre: 'Y' } })),
    ).rejects.toMatchObject({ code: 'P2025' });
    await expect(
      como(empresaB, () => tenant.db.rol.delete({ where: { id: rol.id } })),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect((await prisma.rol.findUnique({ where: { id: rol.id } }))?.nombre).toBe('X');
  });

  it('transacción conserva el filtro', async () => {
    await crearRolEnA();
    const roles = await como(empresaB, () => tenant.transaccion((tx) => tx.rol.findMany()));
    expect(roles).toEqual([]);
  });

  it('sin empresa en el contexto lanza ForbiddenException', async () => {
    await expect(como(null, () => tenant.db.rol.findMany())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
