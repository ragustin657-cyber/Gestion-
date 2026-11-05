import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO } from '../src/contexto/contexto';
import { PadronService } from '../src/pagos/padron/padron.service';
import { RetencionesService } from '../src/pagos/retenciones/retenciones.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrisma } from '../src/prisma/tenant-prisma.service';
import { crearApp, datosCompras, limpiarBase, sesionConPlan } from './helpers';

describe('RetencionesService', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await limpiarBase(prisma);
    const carga = await prisma.padronCarga.create({ data: { jurisdiccion: '902', archivo: 'x', creadoPor: 'test' } });
    await app.get(PadronService).procesar(carga.id, '902', readFileSync(`${__dirname}/fixtures/padron-arba.txt`));
  });
  afterAll(async () => app.close());

  async function preparar(condicionIva: 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' = 'RESPONSABLE_INSCRIPTO') {
    const s = await sesionConPlan(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { jurisdiccionesIibb: ['902'] } });
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    await prisma.tercero.update({ where: { id: proveedorId }, data: { regimenGanancias: '94', condicionIva } });
    const usuario = await prisma.usuarioEmpresa.findFirstOrThrow({ where: { empresaId: s.empresaId } });
    const calcular = (fecha: string, bases: string[]) => {
      const cls = app.get(ClsService);
      return cls.run(async () => {
        cls.set(CLAVE_CONTEXTO, { usuarioId: usuario.usuarioId, empresaId: s.empresaId, permisos: [], superadmin: true });
        return await app.get(TenantPrisma).transaccion((tx) =>
          app.get(RetencionesService).calcular(tx, { terceroId: proveedorId, fechaPago: new Date(`${fecha}T00:00:00Z`), bases }));
      });
    };
    return { ...s, proveedorId, calcular };
  }

  it('Ganancias régimen 94 e IIBB por padrón vigente', async () => {
    const { calcular } = await preparar();
    const r = await calcular('2026-11-15', ['100000.00']);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.impuesto === 'GANANCIAS')).toMatchObject({ regimen: '94', base: '100000.00', importe: '656.60' });
    expect(r.find((x) => x.impuesto === 'IIBB')).toMatchObject({ jurisdiccion: '902', alicuota: '1.75', importe: '1750.00' });
  });

  it('padrón no vigente, sin ficha y NO_RETENER → solo Ganancias', async () => {
    const { calcular } = await preparar();
    const r = await calcular('2026-12-10', ['100000.00']);
    expect(r.map((x) => x.impuesto)).toEqual(['GANANCIAS']);
  });

  it('sin padrón usa la ficha del proveedor', async () => {
    const { calcular, proveedorId, empresaId } = await preparar();
    await prisma.terceroIibb.create({ data: { empresaId, terceroId: proveedorId, jurisdiccion: '902', alicuotaPercepcion: 0, alicuotaRetencion: 2 } });
    const r = await calcular('2026-12-10', ['100000.00']);
    expect(r.find((x) => x.impuesto === 'IIBB')).toMatchObject({ alicuota: '2', importe: '2000.00' });
  });

  it('monotributista sin padrón no tiene retenciones', async () => {
    const { calcular } = await preparar('MONOTRIBUTO');
    expect(await calcular('2026-12-10', ['100000.00'])).toEqual([]);
  });

  it('bases que suman ≤ 0 no retienen', async () => {
    const { calcular } = await preparar();
    expect(await calcular('2026-11-15', ['1000.00', '-5000.00'])).toEqual([]);
  });
});
