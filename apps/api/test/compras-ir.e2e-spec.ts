import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, sesion } from './helpers';

const PERMISOS = ['oc.ver', 'oc.crear', 'oc.aprobar', 'ir.ver', 'ir.crear', 'ir.anular', 'fc.crear'] as const;

describe('informes de recepción', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function preparar() {
    const s = await sesion(app, prisma, { permisos: [...PERMISOS] });
    const d = await datosCompras(prisma, s.empresa.id);
    const oc = await ocAprobada(s.http, prisma, s.empresa.id, d);
    const ir = (cantidad: number, remito = `1-${Math.floor(Math.random() * 1e6)}`, renglonId = oc.renglones[0].id, terceroId = d.proveedorId) =>
      s.http.post('/api/compras/recepciones', { terceroId, fecha: '2026-11-06', remitoNumero: remito, renglones: [{ ordenCompraRenglonId: renglonId, cantidad }] });
    const estado = async () => (await s.http.get(`/api/compras/ordenes/${oc.id}`)).body;
    return { ...s, ...d, oc, ir, estado };
  }

  it('recepción parcial y luego total', async () => {
    const { ir, estado } = await preparar();
    const r1 = await ir(4);
    expect(r1.status).toBe(201);
    expect(r1.body.numero).toBe(1);
    let oc = await estado();
    expect(oc.estado).toBe('PARCIALMENTE_RECIBIDA');
    expect(oc.renglones[0].pendiente).toBe('6');
    await ir(6);
    oc = await estado();
    expect(oc.estado).toBe('CUMPLIDA');
  });

  it('recibir más que lo pendiente → 400', async () => {
    const { ir } = await preparar();
    await ir(4);
    const r = await ir(7);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cantidad recibida (7) supera lo pendiente (6)');
  });

  it('remito duplicado del mismo proveedor → 409, normalizando el formato', async () => {
    const { ir } = await preparar();
    expect((await ir(1, '1-1234')).status).toBe(201);
    const r = await ir(1, '00001-00001234');
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Ese remito ya fue registrado');
  });

  it('remito con formato inválido → 400', async () => {
    const { ir } = await preparar();
    expect((await ir(1, 'abc')).status).toBe(400);
  });

  it('renglón de una OC de otro proveedor → 400; de otra empresa → 404', async () => {
    const a = await preparar();
    const otroProv = await datosCompras(prisma, a.empresa.id);
    const r = await a.ir(1, undefined, undefined, otroProv.proveedorId);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Todos los renglones deben ser del proveedor indicado');
    const b = await preparar();
    expect((await b.ir(1, undefined, a.oc.renglones[0].id)).status).toBe(404);
  });

  it('OC pendiente de aprobación → 400', async () => {
    const { http, proveedorId, articuloId, empresa } = await preparar();
    await prisma.empresa.update({ where: { id: empresa.id }, data: { montoAprobacionOc: 0 } });
    const b = (await http.post('/api/compras/ordenes', { terceroId: proveedorId, fecha: '2026-11-05', monedaCodigo: 'ARS', renglones: [{ articuloId, descripcion: 'x', cantidad: 1, precioUnitario: 1, alicuotaIva: 21 }] })).body;
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const r = await http.post('/api/compras/recepciones', { terceroId: proveedorId, fecha: '2026-11-06', remitoNumero: '1-9', renglones: [{ ordenCompraRenglonId: c.renglones[0].id, cantidad: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La orden de compra no está aprobada');
  });

  it('pendientes de recibir y anulación devuelve la OC a APROBADA', async () => {
    const { http, ir, estado, proveedorId } = await preparar();
    const r = (await ir(10)).body;
    expect((await estado()).estado).toBe('CUMPLIDA');
    expect((await http.get(`/api/compras/ordenes/pendientes-recibir?terceroId=${proveedorId}`)).body).toHaveLength(0);
    expect((await http.post(`/api/compras/recepciones/${r.id}/anular`, { motivo: 'Error de carga' })).status).toBe(200);
    const oc = await estado();
    expect(oc.estado).toBe('APROBADA');
    expect(oc.renglones[0].pendiente).toBe('10');
    const p = (await http.get(`/api/compras/ordenes/pendientes-recibir?terceroId=${proveedorId}`)).body;
    expect(p[0]).toMatchObject({ pendiente: '10' });
    expect((await http.post(`/api/compras/recepciones/${r.id}/anular`, { motivo: 'otra vez' })).status).toBe(409);
  });

  it('pendientes de facturar lista lo recibido', async () => {
    const { http, ir, proveedorId } = await preparar();
    await ir(4);
    const p = (await http.get(`/api/compras/recepciones/pendientes-facturar?terceroId=${proveedorId}`)).body;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ recibido: '4', facturado: '0', pendiente: '4', precioUnitario: '1000' });
  });

  it('dos recepciones simultáneas de 6 sobre 10: una entra y otra no', async () => {
    const { ir, estado } = await preparar();
    const rs = await Promise.all([ir(6), ir(6)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect((await estado()).renglones[0].cantidadRecibida).toBe('6');
  });

  it('lista y detalle; otra empresa no ve', async () => {
    const a = await preparar();
    const r = (await a.ir(2)).body;
    expect((await a.http.get('/api/compras/recepciones')).body.total).toBe(1);
    expect((await a.http.get(`/api/compras/recepciones/${r.id}`)).body.renglones).toHaveLength(1);
    const b = await preparar();
    expect((await b.http.get(`/api/compras/recepciones/${r.id}`)).status).toBe(404);
  });
});
