import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('stock: maestros y configuración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('plan modelo con cuentas y conceptos de stock', async () => {
    const s = await sesionConPlan(app, prisma);
    const c = (codigo: string) => prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo } });
    expect((await c('1.1.05')).imputable).toBe(false);
    expect((await c('1.1.05.001')).monetaria).toBe(false);
    expect((await c('2.1.01.003')).monetaria).toBe(true);
    expect((await c('4.2.04')).nombre).toBe('Sobrantes de inventario');
    expect((await c('5.2.06')).nombre).toBe('Faltantes de inventario');
    const cuentas = (await s.http.get('/api/compras/config')).body.cuentas as { concepto: string; cuentaContableId: string }[];
    const de = (concepto: string) => cuentas.find((x) => x.concepto === concepto)?.cuentaContableId;
    expect(de('MERCADERIAS')).toBe((await c('1.1.05.001')).id);
    expect(de('MERCADERIA_A_FACTURAR')).toBe((await c('2.1.01.003')).id);
    expect(de('SOBRANTES_INVENTARIO')).toBe((await c('4.2.04')).id);
    expect(de('FALTANTES_INVENTARIO')).toBe((await c('5.2.06')).id);
    expect(de('COSTO_MERCADERIAS_VENDIDAS')).toBe((await c('5.1.01')).id);
  });

  it('controla stock en artículos', async () => {
    const s = await sesionConPlan(app, prisma);
    const a = await s.http.post('/api/articulos', { codigo: 'A1', descripcion: 'Lámpara', alicuotaIva: 21, controlaStock: true });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ controlaStock: true, stockCantidad: '0', stockValor: '0', costoPromedio: '0' });
    const sv = await s.http.post('/api/articulos', { codigo: 'S1', descripcion: 'Flete', alicuotaIva: 21, esServicio: true, controlaStock: true });
    expect(sv.status).toBe(400);
    expect(sv.body.message).toBe('Un servicio no controla stock');
    const deposito = await prisma.deposito.create({ data: { empresaId: s.empresaId, codigo: 'CEN', nombre: 'Central' } });
    await prisma.movimientoStock.create({
      data: { empresaId: s.empresaId, fecha: new Date('2026-11-02T00:00:00Z'), articuloId: a.body.id, depositoId: deposito.id, tipo: 'INICIAL', cantidad: 1, costoUnitario: 1, importe: 1, origenTipo: 'X', origenId: 'x', creadoPor: 'test' },
    });
    const off = await s.http.patch(`/api/articulos/${a.body.id}`, { controlaStock: false });
    expect(off.status).toBe(400);
    expect(off.body.message).toBe('El artículo tiene movimientos de stock');
    expect((await s.http.patch(`/api/articulos/${a.body.id}`, { esServicio: true })).body.message).toBe('Un servicio no controla stock');
  });

  it('depósito por defecto del punto de venta', async () => {
    const s = await sesionConPlan(app, prisma);
    const pv = (await s.http.post('/api/empresas/actual/puntos-venta', { numero: 3, descripcion: 'Mostrador' })).body;
    const deposito = await prisma.deposito.create({ data: { empresaId: s.empresaId, codigo: 'CEN', nombre: 'Central' } });
    expect((await s.http.patch(`/api/empresas/actual/puntos-venta/${pv.id}`, { depositoId: deposito.id })).status).toBe(200);
    const lista = (await s.http.get('/api/empresas/actual/puntos-venta')).body as { id: string; depositoId: string | null }[];
    expect(lista.find((p) => p.id === pv.id)!.depositoId).toBe(deposito.id);
    const mal = await s.http.patch(`/api/empresas/actual/puntos-venta/${pv.id}`, { depositoId: '00000000-0000-4000-8000-000000000000' });
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('Depósito inexistente');
  });

  it('configuración de stock', async () => {
    const s = await sesionConPlan(app, prisma);
    expect((await s.http.get('/api/stock/config')).body).toEqual({ stockNegativo: 'BLOQUEAR' });
    expect((await s.http.put('/api/stock/config', { stockNegativo: 'AVISAR' })).status).toBe(200);
    expect((await s.http.get('/api/stock/config')).body).toEqual({ stockNegativo: 'AVISAR' });
    expect((await s.http.put('/api/stock/config', { stockNegativo: 'X' })).status).toBe(400);
    const lector = await otroUsuario(app, prisma, s.empresaId, ['stock.ver']);
    expect((await lector.http.get('/api/stock/config')).status).toBe(200);
    expect((await lector.http.put('/api/stock/config', { stockNegativo: 'BLOQUEAR' })).status).toBe(403);
  });
});
