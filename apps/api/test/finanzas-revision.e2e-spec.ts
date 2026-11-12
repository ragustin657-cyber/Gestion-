import { INestApplication } from '@nestjs/common';
import { saldosAFecha } from '../src/finanzas/saldos';
import { PrismaService } from '../src/prisma/prisma.service';
import type { TxEmpresa } from '../src/prisma/tenant-prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';
import { prepararVentas } from './helpers-ventas';

const f = (s: string) => new Date(`${s}T00:00:00Z`);
type Fila = { egresos: Record<string, string> };

describe('finanzas: correcciones de la revisión', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const proveedores = (r: { filas: Fila[] }) => r.filas.reduce((s, x) => s + Number(x.egresos.proveedores), 0).toFixed(2);

  it('factura en dólares imputada en una OP a otra cotización no se cuenta dos veces', async () => {
    const p = await prepararPagos(app, prisma);
    const fc = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    await prisma.movimientoCuentaCorriente.update({ where: { id: fc.movimientoId }, data: { fechaVencimiento: f('2026-11-20') } });
    await prisma.cotizacion.create({ data: { empresaId: p.empresaId, monedaCodigo: 'USD', fecha: f('2026-11-05'), valor: 900 } });
    await p.opAprobada([{ movimientoId: fc.movimientoId, importe: 121 }]);
    const r = (await p.http.get('/api/tesoreria/flujo?hasta=2026-11-29')).body;
    expect(proveedores(r)).toBe('0.00');
  });

  it('lo imputado en una OP en borrador sigue como pago a proveedores', async () => {
    const p = await prepararPagos(app, prisma);
    const fc = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 20000 });
    await prisma.movimientoCuentaCorriente.update({ where: { id: fc.movimientoId }, data: { fechaVencimiento: f('2026-11-25') } });
    const b = await p.http.post('/api/pagos/ordenes', { terceroId: p.proveedorId, fecha: '2026-11-06', imputaciones: [{ movimientoId: fc.movimientoId, importe: 24200 }] });
    expect(b.body.estado).toBe('BORRADOR');
    const r = (await p.http.get('/api/tesoreria/flujo?hasta=2026-11-29')).body;
    expect(r.filas[3].egresos.proveedores).toBe('24200.00');
  });

  it('una factura con fecha posterior a hoy entra en el flujo', async () => {
    const p = await prepararPagos(app, prisma);
    const fc = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000, fecha: '2026-11-10' });
    await prisma.movimientoCuentaCorriente.update({ where: { id: fc.movimientoId }, data: { fechaVencimiento: f('2026-12-10') } });
    const r = (await p.http.get('/api/tesoreria/flujo?hasta=2026-12-31&agrupar=mes')).body;
    expect(r.filas[1].egresos.proveedores).toBe('1210.00');
  });

  it('control: recibo anulado después de aplicarse y OP en dos partes con dólares', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const rec = (await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-03', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1210 }, aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }] })).body;
    expect((await v.http.post(`/api/ventas/recibos/${rec.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    const deb = await v.movDe(fc.id);
    const tx = prisma as unknown as TxEmpresa;
    expect((await saldosAFecha(tx, 'clientes', f('2026-11-04'))).find((m) => m.movimientoId === deb.id)?.saldoPesos.toFixed(2)).toBe('1210.00');
  });

  it('control: OP en dos partes sobre una factura en dólares', async () => {
    const p = await prepararPagos(app, prisma);
    const fc = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    for (const [importe, fecha] of [[50, '2026-11-03'], [71, '2026-11-04']] as const) {
      const op = await p.opAprobada([{ movimientoId: fc.movimientoId, importe }]);
      expect((await p.pagar(op, [{ tipo: 'EFECTIVO', monedaCodigo: 'USD', importe, cajaId: p.cajaUsd.id }], fecha)).status).toBe(200);
    }
    const tx = prisma as unknown as TxEmpresa;
    const al = async (d: string) => (await saldosAFecha(tx, 'proveedores', f(d))).find((m) => m.movimientoId === fc.movimientoId)?.saldoPesos.toFixed(2);
    expect(await al('2026-11-02')).toBe('121000.00');
    expect(await al('2026-11-03')).toBe('71000.00');
    expect(await al('2026-11-05')).toBeUndefined();
    const mov = await prisma.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: fc.movimientoId } });
    expect(mov.saldoPesos.toFixed(2)).toBe('0.00');
  });
});
