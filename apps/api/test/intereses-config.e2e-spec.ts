import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('intereses: configuración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('configurar la tasa', async () => {
    const v = await prepararVentas(app, prisma);
    expect((await v.http.get('/api/ventas/intereses/configuracion')).body).toEqual({ tasaMensual: null, descripcion: 'Intereses por mora' });
    expect((await v.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 5 })).status).toBe(200);
    expect((await v.http.get('/api/ventas/intereses/configuracion')).body.tasaMensual).toBe('5.00');
    const r = await v.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 0 });
    expect([r.status, r.body.message]).toEqual([400, 'Tasa inválida']);
  });

  it('cliente sin intereses', async () => {
    const v = await prepararVentas(app, prisma);
    expect((await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { sinIntereses: true })).status).toBe(200);
    expect((await prisma.tercero.findUniqueOrThrow({ where: { id: v.clienteRI.id } })).sinIntereses).toBe(true);
  });

  it('empresa nueva trae la cuenta de intereses', async () => {
    const v = await prepararVentas(app, prisma);
    const cfg = await prisma.configCuenta.findFirstOrThrow({ where: { empresaId: v.empresaId, concepto: 'INTERESES_GANADOS' } });
    expect(cfg.cuentaContableId).toBe(await v.cuenta('4.2.02'));
  });

  it('permisos', async () => {
    const v = await prepararVentas(app, prisma);
    const u = await otroUsuario(app, prisma, v.empresaId, ['venta.ver']);
    expect((await u.http.get('/api/ventas/intereses/configuracion')).status).toBe(403);
  });
});
