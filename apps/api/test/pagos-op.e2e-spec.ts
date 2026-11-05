import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('órdenes de pago: borrador, imputaciones y aprobación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function preparar() {
    const s = await sesionConPlan(app, prisma);
    const d = await datosCompras(prisma, s.empresaId);
    const op = (extra: Record<string, unknown>) => s.http.post('/api/pagos/ordenes', { terceroId: d.proveedorId, fecha: '2026-11-10', ...extra });
    return { ...s, ...d, op };
  }

  it('OP con una factura: totales, confirmación pendiente con número y retenciones de vista previa', async () => {
    const { http, proveedorId, op } = await preparar();
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    const b = await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 1210 }] });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ estado: 'BORRADOR', numero: null, totalCancelarPesos: '1210' });
    const c = await http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ estado: 'PENDIENTE_APROBACION', numero: 1, netoPagar: '1210', totalRetenciones: '0' });
    expect(Array.isArray(c.body.retenciones)).toBe(true);
  });

  it('factura en USD se pasa a pesos con la cotización de la OP', async () => {
    const { http, proveedorId, op } = await preparar();
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    const b = await op({ cotizacion: 1100, imputaciones: [{ movimientoId: f.movimientoId, importe: 121 }] });
    expect(b.body.totalCancelarPesos).toBe('133100');
    expect(b.body.imputaciones[0].importePesos).toBe('133100');
  });

  it('importe 0 o de signo contrario → 400', async () => {
    const { http, proveedorId, op } = await preparar();
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    expect((await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 0 }] })).status).toBe(400);
    const r = await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: -10 }] });
    expect(r.status).toBe(400);
    expect(r.body.campos['imputaciones.0.importe']).toBe('El importe debe tener el mismo signo que el saldo');
  });

  it('lo comprometido en otra OP abierta limita el disponible', async () => {
    const { http, proveedorId, op } = await preparar();
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 1000 }] });
    const mal = await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 300 }] });
    expect(mal.status).toBe(400);
    expect(mal.body.message).toContain('saldo disponible del comprobante (210');
    expect((await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 210 }] })).status).toBe(201);
    const p = (await http.get(`/api/pagos/pendientes?terceroId=${proveedorId}`)).body;
    expect(p).toEqual([]);
  });

  it('solo anticipo; sin importe → 400', async () => {
    const { op } = await preparar();
    const a = await op({ imputaciones: [], anticipo: { monedaCodigo: 'ARS', importe: 5000 } });
    expect(a.body.totalCancelarPesos).toBe('5000');
    const r = await op({ imputaciones: [] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La orden de pago no tiene importe a pagar');
  });

  it('el creador no aprueba si hay otro aprobador; el otro sí', async () => {
    const { http, proveedorId, op, empresaId } = await preparar();
    const aprobador = await otroUsuario(app, prisma, empresaId, ['op.ver', 'op.aprobar']);
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    const b = (await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 1210 }] })).body;
    const c = (await http.post(`/api/pagos/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const r = await http.post(`/api/pagos/ordenes/${b.id}/aprobar`, { version: c.version });
    expect(r.status).toBe(403);
    const ok = await aprobador.http.post(`/api/pagos/ordenes/${b.id}/aprobar`, { version: c.version });
    expect(ok.body).toMatchObject({ estado: 'APROBADA', aprobadoPor: aprobador.usuario.id });
  });

  it('aprobación automática bajo el límite; rechazo exige motivo', async () => {
    const { http, proveedorId, op, empresaId } = await preparar();
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    const b = (await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 500 }] })).body;
    const c = (await http.post(`/api/pagos/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    expect((await http.post(`/api/pagos/ordenes/${b.id}/rechazar`, { version: c.version })).status).toBe(400);
    await prisma.empresa.update({ where: { id: empresaId }, data: { montoAprobacionOp: 1000000 } });
    const b2 = (await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 100 }] })).body;
    expect((await http.post(`/api/pagos/ordenes/${b2.id}/confirmar`, { version: b2.version })).body.estado).toBe('APROBADA');
  });

  it('anular una aprobada libera lo comprometido', async () => {
    const { http, proveedorId, op, empresaId } = await preparar();
    await prisma.empresa.update({ where: { id: empresaId }, data: { montoAprobacionOp: 1000000 } });
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    const b = (await op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 1210 }] })).body;
    const c = (await http.post(`/api/pagos/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    expect((await http.get(`/api/pagos/pendientes?terceroId=${proveedorId}`)).body).toEqual([]);
    const a = await http.post(`/api/pagos/ordenes/${b.id}/anular`, { version: c.version, motivo: 'No se paga' });
    expect(a.body.estado).toBe('ANULADA');
    expect((await http.get(`/api/pagos/pendientes?terceroId=${proveedorId}`)).body[0]).toMatchObject({ disponible: '1210' });
  });

  it('comprobante de otro proveedor → 400; otra empresa → 404', async () => {
    const a = await preparar();
    const otro = await datosCompras(prisma, a.empresaId);
    const f = await facturaPendiente(a.http, prisma, { proveedorId: otro.proveedorId, neto: 1000 });
    const r = await a.op({ imputaciones: [{ movimientoId: f.movimientoId, importe: 1210 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El comprobante no pertenece al proveedor');
    const ok = (await a.op({ imputaciones: [], anticipo: { monedaCodigo: 'ARS', importe: 10 } })).body;
    const b = await preparar();
    expect((await b.http.get(`/api/pagos/ordenes/${ok.id}`)).status).toBe(404);
  });
});
