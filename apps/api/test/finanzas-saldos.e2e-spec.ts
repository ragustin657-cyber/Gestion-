import { INestApplication } from '@nestjs/common';
import { saldosAFecha } from '../src/finanzas/saldos';
import { PrismaService } from '../src/prisma/prisma.service';
import type { TxEmpresa } from '../src/prisma/tenant-prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';
import { prepararVentas } from './helpers-ventas';

const f = (s: string) => new Date(`${s}T00:00:00Z`);

describe('finanzas: saldo pendiente a una fecha', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tx: TxEmpresa;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
    tx = prisma as unknown as TxEmpresa;
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Con corte hoy, cada movimiento no anulado tiene el saldo actual. */
  const controlAHoy = async (tipo: 'clientes' | 'proveedores', origenes: string[]) => {
    const calc = new Map((await saldosAFecha(tx, tipo, f('2026-11-06'))).map((m) => [m.movimientoId, m.saldoPesos.toFixed(2)]));
    const movs = await prisma.movimientoCuentaCorriente.findMany({ where: { anulado: false, origenTipo: { in: origenes } } });
    expect(movs.length).toBeGreaterThan(0);
    for (const m of movs) expect([m.origenTipo, calc.get(m.id) ?? '0.00']).toEqual([m.origenTipo, m.saldoPesos.toFixed(2)]);
  };

  it('factura cobrada después del corte', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-05' });
    const r = await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-03', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1210 }, aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }] });
    expect(r.status).toBe(201);
    const deb = await v.movDe(fc.id);
    const al = async (corte: string) => (await saldosAFecha(tx, 'clientes', f(corte))).find((m) => m.movimientoId === deb.id)?.saldoPesos.toFixed(2);
    expect(await al('2026-10-31')).toBe('1210.00');
    expect(await al('2026-11-05')).toBeUndefined();
    expect(await al('2026-09-30')).toBeUndefined();
  });

  it('control a hoy: clientes', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-03', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 500 }, aplicaciones: [{ comprobanteId: fc.id, importe: 500 }] });
    const f2 = await v.factura();
    await v.factura({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f2.id, renglones: [{ descripcion: 'Bonificación', cantidad: 1, precioUnitario: 200, alicuota: 21 }] });
    // Cobro aplicado y luego desaplicado: su aplicación anulada no cuenta
    const f3 = await v.factura();
    const { mov } = await v.cobro(300);
    const ap = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-04', items: [{ creditoMovId: mov.id, debitoMovId: (await v.movDe(f3.id)).id, importe: 300 }] });
    expect((await v.http.post(`/api/ventas/aplicaciones/${ap.body.id}/anular`, {})).status).toBe(200);
    // Factura en dólares cobrada en pesos con otra cotización (diferencia de cambio)
    const usd = await v.factura({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Producto', cantidad: 1, precioUnitario: 100, alicuota: 21 }] });
    const cobroUsd = await v.cobro(105000);
    await v.cotizacionUsd('2026-11-05', 1050);
    await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: cobroUsd.mov.id, debitoMovId: (await v.movDe(usd.id)).id, importe: 60 }] });
    await controlAHoy('clientes', ['VENTA', 'RECIBO', 'COBRO']);
  });

  it('control a hoy: proveedores', async () => {
    const p = await prepararPagos(app, prisma);
    const f1 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 10000 });
    const op = await p.opAprobada([{ movimientoId: f1.movimientoId, importe: 5000 }]);
    expect((await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 5000, cuentaBancariaId: p.ars.id }], '2026-11-03')).status).toBe(200);
    const f2 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 2000 });
    const op2 = await p.opAprobada([{ movimientoId: f2.movimientoId, importe: 2420 }]);
    const pagada = (await p.pagar(op2, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 2420, cuentaBancariaId: p.ars.id }], '2026-11-04')).body;
    expect((await p.http.post(`/api/pagos/ordenes/${pagada.id}/anular`, { version: pagada.version, motivo: 'Error' })).status).toBe(200);
    await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    await controlAHoy('proveedores', ['COMPRA', 'ANTICIPO']);
    const antes = (await saldosAFecha(tx, 'proveedores', f('2026-11-02'))).find((m) => m.movimientoId === f1.movimientoId)!;
    expect(antes.saldoPesos.toFixed(2)).toBe('12100.00');
  });
});
