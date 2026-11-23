import { INestApplication } from '@nestjs/common';
import { ArcaSimulado } from '../src/arca/arca-simulado';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('descuentos y bonificaciones en las ventas (E51)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const renglon = (o: Record<string, unknown> = {}) => ({ descripcion: 'Producto', cantidad: 2, precioUnitario: 1000, alicuota: 21, ...o });
  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const emitir = (d: Record<string, unknown>) => v.http.post('/api/ventas/comprobantes', { ...v.datos(d), emitir: true });
    return { ...v, emitir };
  };

  it('factura con bonificación y descuento general: netos, IVA, total y lo que va a ARCA', async () => {
    const x = await escenario();
    const r = await x.emitir({ renglones: [renglon({ bonificacionPct: 10 })], descuentoPct: 5 });
    expect([r.status, r.body.estado]).toEqual([201, 'AUTORIZADO']);
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: r.body.id }, include: { renglones: true } });
    expect([c.netoGravado.toFixed(2), c.iva.toFixed(2), c.total.toFixed(2), c.descuentoPct.toFixed(2)]).toEqual(['1710.00', '359.10', '2069.10', '5.00']);
    expect([c.renglones[0].neto.toFixed(2), c.renglones[0].bonificacionPct.toFixed(2), c.renglones[0].precioUnitario.toFixed(2)]).toEqual(['1710.00', '10.00', '1000.00']);
    expect(ArcaSimulado.ultimaSolicitud(x.empresaId)!.impNeto).toBe('1710.00');
    const det = (await x.http.get(`/api/ventas/comprobantes/${c.id}`)).body;
    expect([Number(det.descuentoPct), Number(det.renglones[0].bonificacionPct)]).toEqual([5, 10]);
  });

  it('sin los campos: igual que hoy', async () => {
    const x = await escenario();
    const r = await x.emitir({ renglones: [renglon()] });
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([c.total.toFixed(2), c.descuentoPct.toFixed(2)]).toEqual(['2420.00', '0.00']);
  });

  it('renglón al 100 %: con otros se emite; solo, error de total; validaciones', async () => {
    const x = await escenario();
    expect((await x.emitir({ renglones: [renglon({ bonificacionPct: 100 }), renglon()] })).status).toBe(201);
    let r = await x.emitir({ renglones: [renglon({ bonificacionPct: 100 })] });
    expect([r.status, r.body.message]).toEqual([400, 'El total del comprobante debe ser mayor a cero']);
    r = await x.emitir({ renglones: [renglon({ bonificacionPct: 10.555 })] });
    expect([r.status, r.body.message]).toEqual([400, 'Hasta 2 decimales']);
    r = await x.emitir({ renglones: [renglon({ bonificacionPct: 101 })] });
    expect([r.status, r.body.message]).toEqual([400, 'Entre 0 y 100']);
    r = await x.emitir({ renglones: [renglon()], descuentoPct: 100 });
    expect([r.status, r.body.message]).toEqual([400, 'Debe ser menor que 100']);
  });

  it('pedido con bonificación: neto bonificado; pendientes de facturar la devuelven; total cero da error', async () => {
    const x = await escenario();
    const p = await x.http.post('/api/ventas/pedidos', { terceroId: x.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', renglones: [renglon({ bonificacionPct: 25 })], confirmar: true });
    expect(p.status).toBe(201);
    expect([Number(p.body.netoGravado), Number(p.body.renglones[0].bonificacionPct)]).toEqual([1500, 25]);
    const pend = (await x.http.get(`/api/ventas/pendientes-facturar?terceroId=${x.clienteRI.id}`)).body;
    expect(pend.pedidos.map((y: { bonificacionPct: string }) => Number(y.bonificacionPct))).toEqual([25]);
    const cero = await x.http.post('/api/ventas/pedidos', { terceroId: x.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', renglones: [renglon({ bonificacionPct: 100 })] });
    expect([cero.status, cero.body.message]).toEqual([400, 'El total del comprobante debe ser mayor a cero']);
  });

  it('nota de crédito sobre una factura con descuento: el tope usa el total final', async () => {
    const x = await escenario();
    const f = await x.emitir({ renglones: [renglon({ bonificacionPct: 10 })], descuentoPct: 5 });
    const mas = await x.emitir({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, renglones: [renglon({ cantidad: 1, precioUnitario: 1710.01, alicuota: 21 })] });
    expect(mas.status).toBe(400);
    const nc = await x.emitir({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, renglones: [renglon({ bonificacionPct: 10 })], descuentoPct: 5 });
    expect([nc.status, Number(nc.body.total)]).toEqual([201, 2069.1]);
  });

  it('en dólares: total en pesos sobre el neto bonificado', async () => {
    const x = await escenario();
    const r = await x.emitir({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [renglon({ precioUnitario: 10, bonificacionPct: 10 })], descuentoPct: 10 });
    expect([r.status, Number(r.body.total)]).toEqual([201, 19.6]);
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(c.totalPesos.toFixed(2)).toBe('19600.00');
  });
});
