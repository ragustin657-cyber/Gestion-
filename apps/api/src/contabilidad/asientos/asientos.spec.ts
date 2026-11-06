import { crearEjercicio } from '../periodos/ejercicios';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AuditoriaModule } from '../../auditoria/auditoria.module';
import { CLAVE_CONTEXTO } from '../../contexto/contexto';
import { NumeracionModule } from '../../numeracion/numeracion.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { cargarPlanModelo } from '../../seed/plan-cuentas-modelo';
import { limpiarBase } from '../../../test/helpers';
import { AsientosModule } from './asientos.module';
import { AsientosService } from './asientos.service';

describe('AsientosService', () => {
  let prisma: PrismaService;
  let tenant: TenantPrisma;
  let cls: ClsService;
  let asientos: AsientosService;
  let A: string;
  let B: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), PrismaModule, NumeracionModule, AuditoriaModule, AsientosModule],
    }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    tenant = mod.get(TenantPrisma);
    cls = mod.get(ClsService);
    asientos = mod.get(AsientosService);
  });
  afterAll(async () => prisma.$disconnect());

  beforeEach(async () => {
    await limpiarBase(prisma);
    const d = { cuit: '30712345671', condicionIva: 'RESPONSABLE_INSCRIPTO' as const };
    A = (await prisma.empresa.create({ data: { razonSocial: 'A', ...d } })).id;
    B = (await prisma.empresa.create({ data: { razonSocial: 'B', ...d } })).id;
    await cargarPlanModelo(prisma, A);
    await cargarPlanModelo(prisma, B);
    await crearEjercicio(prisma, A, new Date('2026-01-01T00:00:00Z'), 1);
    await crearEjercicio(prisma, B, new Date('2026-01-01T00:00:00Z'), 1);
  });

  const como = <T>(empresaId: string, fn: () => Promise<T>) =>
    cls.run(async () => {
      cls.set(CLAVE_CONTEXTO, { usuarioId: '00000000-0000-0000-0000-000000000001', empresaId, permisos: [], superadmin: false, sucursalId: null });
      return await fn();
    });
  const cuenta = async (empresaId: string, codigo: string) =>
    (await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId, codigo } })).id;
  const fecha = new Date('2026-11-05T00:00:00Z');

  it('crea asiento balanceado con número 1 y agrupa renglones de la misma cuenta', async () => {
    const gasto = await cuenta(A, '5.2.01');
    const prov = await cuenta(A, '2.1.01.001');
    const r = await como(A, () =>
      tenant.transaccion((tx) =>
        asientos.generar(tx, {
          fecha, descripcion: 'Prueba', origenTipo: 'TEST', origenId: 'x',
          renglones: [{ cuentaContableId: gasto, debe: '60' }, { cuentaContableId: gasto, debe: '40' }, { cuentaContableId: prov, haber: '100' }],
        }),
      ),
    );
    expect(r.numero).toBe(1);
    const renglones = await prisma.asientoRenglon.findMany({ where: { asientoId: r.id } });
    expect(renglones).toHaveLength(2);
    expect(renglones.find((x) => x.cuentaContableId === gasto)!.debe.toString()).toBe('100');
  });

  it('desbalanceado lanza error y no deja filas', async () => {
    const gasto = await cuenta(A, '5.2.01');
    const prov = await cuenta(A, '2.1.01.001');
    await expect(
      como(A, () => tenant.transaccion((tx) => asientos.generar(tx, {
        fecha, descripcion: 'X', origenTipo: 'TEST', origenId: 'x',
        renglones: [{ cuentaContableId: gasto, debe: '100' }, { cuentaContableId: prov, haber: '99.99' }],
      }))),
    ).rejects.toThrow('no balancea');
    expect(await prisma.asiento.count()).toBe(0);
  });

  it('cuenta no imputable lanza error', async () => {
    const noImp = await cuenta(A, '5.2');
    const prov = await cuenta(A, '2.1.01.001');
    await expect(
      como(A, () => tenant.transaccion((tx) => asientos.generar(tx, {
        fecha, descripcion: 'X', origenTipo: 'TEST', origenId: 'x',
        renglones: [{ cuentaContableId: noImp, debe: '1' }, { cuentaContableId: prov, haber: '1' }],
      }))),
    ).rejects.toThrow('no es imputable');
  });

  it('cuenta de otra empresa lanza error', async () => {
    const gastoB = await cuenta(B, '5.2.01');
    const prov = await cuenta(A, '2.1.01.001');
    await expect(
      como(A, () => tenant.transaccion((tx) => asientos.generar(tx, {
        fecha, descripcion: 'X', origenTipo: 'TEST', origenId: 'x',
        renglones: [{ cuentaContableId: gastoB, debe: '1' }, { cuentaContableId: prov, haber: '1' }],
      }))),
    ).rejects.toThrow();
  });

  it('contraasiento invierte importes y apunta al original; otra empresa no lo ve', async () => {
    const gasto = await cuenta(A, '5.2.01');
    const prov = await cuenta(A, '2.1.01.001');
    const orig = await como(A, () => tenant.transaccion((tx) => asientos.generar(tx, {
      fecha, descripcion: 'X', origenTipo: 'TEST', origenId: 'x',
      renglones: [{ cuentaContableId: gasto, debe: '100' }, { cuentaContableId: prov, haber: '100' }],
    })));
    const contra = await como(A, () => tenant.transaccion((tx) => asientos.contraasiento(tx, orig.id, fecha, 'Anulación')));
    expect(contra.numero).toBe(2);
    const c = await prisma.asiento.findUniqueOrThrow({ where: { id: contra.id }, include: { renglones: true } });
    expect(c.anulaAId).toBe(orig.id);
    expect(c.renglones.find((x) => x.cuentaContableId === gasto)!.haber.toString()).toBe('100');
    expect(await como(B, () => tenant.db.asiento.findMany())).toEqual([]);
  });
});
