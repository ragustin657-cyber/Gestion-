import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

const MENSAJE = 'Es el concepto de comisiones de vendedores: debe seguir siendo fijo, sin convenio, para todos los empleados y no de descuento';

describe('pulido 29: sueldos, comisiones y cobranzas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const concepto210 = async (v: Awaited<ReturnType<typeof prepararVentas>>) => {
    const conceptos = (await v.http.get('/api/sueldos/conceptos')).body as Record<string, unknown>[];
    const { id, empresaId: _e, ...c } = conceptos.find((x) => x.codigo === '210')!;
    return { id: id as string, c };
  };

  it('concepto de comisiones configurado', async () => {
    const v = await prepararVentas(app, prisma);
    const { id, c } = await concepto210(v);
    const conv = await prisma.convenio.findFirstOrThrow({ where: { empresaId: v.empresaId } });
    for (const cambio of [{ tipo: 'PORCENTAJE', parametros: { pct: 1, base: 'BASICO_MAS_ANTIGUEDAD' } }, { convenioId: conv.id }, { soloAfiliados: true }, { clase: 'DESCUENTO' }]) {
      const r = await v.http.put(`/api/sueldos/conceptos/${id}`, { ...c, ...cambio });
      expect([JSON.stringify(cambio), r.status, r.body.message]).toEqual([JSON.stringify(cambio), 400, MENSAJE]);
    }
    expect((await v.http.put(`/api/sueldos/conceptos/${id}`, c)).status).toBe(200);
  });

  it('concepto configurado inactivo se edita', async () => {
    const v = await prepararVentas(app, prisma);
    const { id, c } = await concepto210(v);
    await prisma.concepto.update({ where: { id }, data: { activo: false } });
    const r = await v.http.put(`/api/sueldos/conceptos/${id}`, { ...c, nombre: 'Comisiones de venta', activo: false });
    expect(r.status).toBe(200);
  });

  it('creador inválido', async () => {
    const v = await prepararVentas(app, prisma);
    await v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    await prisma.gestionCobranza.create({ data: { empresaId: v.empresaId, terceroId: v.clienteRI.id, fecha: new Date('2026-11-05'), medio: 'MAIL', nota: 'x', creadoPor: '-'.repeat(36) } });
    expect((await v.http.get(`/api/ventas/cobranzas/${v.clienteRI.id}`)).status).toBe(200);
  });
});
