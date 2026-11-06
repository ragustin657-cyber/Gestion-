import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('aplicación de cobros y diferencia de cambio', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const saldos = async (prismaMovId: string) => {
    const m = await prisma.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: prismaMovId } });
    return [m.saldo.toString(), m.saldoPesos.toString()];
  };
  async function asientoDe(origenTipo: string, origenId: string) {
    const as = await prisma.asiento.findMany({ where: { origenTipo, origenId }, include: { renglones: true }, orderBy: { numero: 'asc' } });
    return Promise.all(as.map(async (a) => {
      const r: Record<string, [string, string]> = {};
      for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toString(), x.haber.toString()];
      return r;
    }));
  }
  const facturaUsd = (v: Awaited<ReturnType<typeof prepararVentas>>) =>
    v.factura({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });

  it('una NC se aplica sola a su factura al autorizarse', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const nc = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, renglones: [{ descripcion: 'Bonificación', cantidad: 1, precioUnitario: 826.45, alicuota: 21 }], emitir: true }));
    expect(nc.status).toBe(201);
    expect(await saldos((await v.movDe(fc.id)).id)).toEqual(['210', '210']);
    expect(await saldos((await v.movDe(nc.body.id)).id)).toEqual(['0', '0']);
    expect(await prisma.aplicacionCobro.count({ where: { origenTipo: 'VENTA', origenId: nc.body.id } })).toBe(1);
  });

  it('un cobro de Tesorería se aplica a una factura y ya no se puede anular el ingreso', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const { ingreso, mov } = await v.cobro(500);
    const deb = await v.movDe(fc.id);
    const pend = (await v.http.get(`/api/ventas/clientes/${v.clienteRI.id}/pendientes`)).body;
    expect(pend.creditos.map((x: { id: string }) => x.id)).toEqual([mov.id]);
    expect(pend.debitos.map((x: { id: string }) => x.id)).toEqual([deb.id]);
    const r = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-04', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 500 }] });
    expect(r.status).toBe(201);
    expect(await saldos(deb.id)).toEqual(['710', '710']);
    expect(await saldos(mov.id)).toEqual(['0', '0']);
    expect(await prisma.asiento.count({ where: { origenTipo: 'APLICACION_COBRO' } })).toBe(0);
    const an = await v.http.post(`/api/tesoreria/ingresos/${ingreso.id}/anular`, { motivo: 'Error' });
    expect(an.status).toBe(400);
    expect(an.body.message).toBe('El cobro fue aplicado a comprobantes: deshaga primero la aplicación');
  });

  it('factura en USD cobrada en pesos con cotización mayor: diferencia de cambio positiva', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await facturaUsd(v);
    const { mov } = await v.cobro(105000);
    await v.cotizacionUsd('2026-11-05', 1050);
    const deb = await v.movDe(fc.id);
    const r = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 100 }] });
    expect(r.status).toBe(201);
    expect(r.body.diferenciaCambio).toBe('5000');
    expect(await saldos(deb.id)).toEqual(['0', '0']);
    expect(await saldos(mov.id)).toEqual(['0', '0']);
    expect(await asientoDe('APLICACION_COBRO', r.body.id)).toEqual([{ '1.1.02.001': ['5000', '0'], '4.2.01': ['0', '5000'] }]);
  });

  it('con cotización menor: diferencia de cambio negativa', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await facturaUsd(v);
    const { mov } = await v.cobro(95000);
    await v.cotizacionUsd('2026-11-05', 950);
    const r = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: (await v.movDe(fc.id)).id, importe: 100 }] });
    expect(r.body.diferenciaCambio).toBe('-5000');
    expect(await asientoDe('APLICACION_COBRO', r.body.id)).toEqual([{ '5.2.03': ['5000', '0'], '1.1.02.001': ['0', '5000'] }]);
  });

  it('dos cobros parciales a distinta cotización cierran en cero en dólares y en pesos', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await facturaUsd(v);
    const deb = await v.movDe(fc.id);
    const { mov } = await v.cobro(100000);
    await v.cotizacionUsd('2026-11-04', 1100);
    await v.cotizacionUsd('2026-11-05', 900);
    const a1 = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-04', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 50 }] });
    const a2 = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 50 }] });
    expect([a1.body.diferenciaCambio, a2.body.diferenciaCambio]).toEqual(['5000', '-5000']);
    expect(await saldos(deb.id)).toEqual(['0', '0']);
    expect(await saldos(mov.id)).toEqual(['0', '0']);
    const renglones = await prisma.asientoRenglon.findMany({ where: { asiento: { origenTipo: 'APLICACION_COBRO' } } });
    expect(renglones.reduce((t, x) => t + Number(x.debe) - Number(x.haber), 0)).toBe(0);
  });

  it('monedas incompatibles e importes mayores al saldo', async () => {
    const v = await prepararVentas(app, prisma);
    const fcArs = await v.factura();
    const fcUsd = await facturaUsd(v);
    const ncUsd = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fcUsd.id, monedaCodigo: 'USD', cotizacion: 1000, aplicarAAsociado: false, renglones: [{ descripcion: 'x', cantidad: 1, precioUnitario: 10, alicuota: 'EXENTO' }], emitir: true }));
    const r = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: (await v.movDe(ncUsd.body.id)).id, debitoMovId: (await v.movDe(fcArs.id)).id, importe: 5 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La moneda del crédito no coincide con la del comprobante');
    const { mov } = await v.cobro(5000);
    const mayor = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: (await v.movDe(fcArs.id)).id, importe: 1210.01 }] });
    expect(mayor.status).toBe(400);
    expect(mayor.body.message).toBe('El importe supera el saldo disponible');
  });

  it('deshacer una aplicación restituye los saldos y revierte la diferencia de cambio', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await facturaUsd(v);
    const { mov } = await v.cobro(105000);
    await v.cotizacionUsd('2026-11-05', 1050);
    const deb = await v.movDe(fc.id);
    const r = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 60 }] });
    expect(await saldos(deb.id)).toEqual(['40', '40000']);
    expect(await saldos(mov.id)).toEqual(['-42000', '-42000']);
    const d = await v.http.post(`/api/ventas/aplicaciones/${r.body.id}/anular`, {});
    expect(d.status).toBe(200);
    expect(await saldos(deb.id)).toEqual(['100', '100000']);
    expect(await saldos(mov.id)).toEqual(['-105000', '-105000']);
    expect(await prisma.aplicacionCobro.count({ where: { anulada: false } })).toBe(0);
    const contra = await prisma.asiento.findMany({ where: { origenTipo: 'APLICACION_COBRO', origenId: r.body.id } });
    expect(contra).toHaveLength(2);
  });
});
