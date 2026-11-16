import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';
import { prepararVentas } from './helpers-ventas';

describe('tarjetas: cobros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Debe y haber por código de cuenta. */
  async function asiento(asientoId: string) {
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: asientoId }, include: { renglones: true } });
    const r: Record<string, [string, string]> = {};
    for (const x of a.renglones) {
      const c = (await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo;
      const [d, h] = r[c] ?? ['0', '0'];
      r[c] = [(Number(d) + Number(x.debe)).toFixed(2), (Number(h) + Number(x.haber)).toFixed(2)];
    }
    return r;
  }

  const ventas = async () => {
    const v = await prepararVentas(app, prisma);
    const banco = (await v.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await v.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await v.cuenta('1.1.01.002') })).body;
    const visa = (await v.http.post('/api/tesoreria/tarjetas', { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: cuenta.id })).body as { id: string };
    const fc = await v.factura();
    const recibo = (o: Record<string, unknown>) => v.http.post('/api/ventas/recibos', {
      terceroId: v.clienteRI.id, fecha: '2026-11-05', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, cheques: [], transferencias: [], retenciones: [],
      aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }], ...o,
    });
    return { ...v, cuenta, visa, fc, recibo };
  };

  it('recibo con cupones', async () => {
    const x = await ventas();
    const r = await x.recibo({ cupones: [{ tarjetaId: x.visa.id, lote: '12', numero: '345', cuotas: 3, importe: 1000 }, { tarjetaId: x.visa.id, importe: 210 }] });
    expect(r.status).toBe(201);
    const rec = await prisma.recibo.findUniqueOrThrow({ where: { id: r.body.id } });
    expect((await asiento(rec.asientoId!))['1.1.02.003']).toEqual(['1210.00', '0.00']);
    const cupones = await prisma.cuponTarjeta.findMany({ where: { empresaId: x.empresaId }, orderBy: { importe: 'desc' } });
    expect(cupones.map((c) => [c.importe.toFixed(2), c.estado, c.cuotas])).toEqual([['1000.00', 'PENDIENTE', 3], ['210.00', 'PENDIENTE', 1]]);
    expect((await x.movDe(x.fc.id)).saldo.toString()).toBe('0');
  });

  it('recibo mixto', async () => {
    const x = await ventas();
    const r = await x.recibo({ efectivo: { importe: 100 }, transferencias: [{ cuentaBancariaId: x.cuenta.id, fecha: '2026-11-05', importe: 200 }], cupones: [{ tarjetaId: x.visa.id, importe: 910 }] });
    expect(r.status).toBe(201);
    const a = await asiento((await prisma.recibo.findUniqueOrThrow({ where: { id: r.body.id } })).asientoId!);
    expect([a['1.1.02.003'][0], a['1.1.01.004'][0], a['1.1.02.001'][1]]).toEqual(['910.00', '200.00', '1210.00']);
    expect((await x.movDe(x.fc.id)).saldo.toString()).toBe('0');
  });

  const tesoreria = async () => {
    const t = await prepararTesoreria(app, prisma);
    const visa = (await t.http.post('/api/tesoreria/tarjetas', { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: t.ars.id })).body as { id: string };
    const ingreso = (o: Record<string, unknown>) => t.http.post('/api/tesoreria/ingresos', { fecha: '2026-11-10', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobranza', ...o });
    return { ...t, visa, ingreso };
  };

  it('ingreso de valores con cupones', async () => {
    const x = await tesoreria();
    const r = await x.ingreso({ cupones: [{ tarjetaId: x.visa.id, importe: 5000 }] });
    expect(r.status).toBe(201);
    expect((await asiento(r.body.asientoId))['1.1.02.003']).toEqual(['5000.00', '0.00']);
    expect(await prisma.cuponTarjeta.findFirstOrThrow({ where: { ingresoId: r.body.id } })).toMatchObject({ estado: 'PENDIENTE', sucursalId: x.cen.id });
  });

  it('caja en dólares', async () => {
    const x = await tesoreria();
    const r = await x.ingreso({ cajaId: x.cajaUsd.id, cupones: [{ tarjetaId: x.visa.id, importe: 5000 }] });
    expect([r.status, r.body.message]).toEqual([400, 'Los cupones de tarjeta se cobran en pesos']);
  });

  it('anular con cupones', async () => {
    const x = await tesoreria();
    const r = await x.ingreso({ cupones: [{ tarjetaId: x.visa.id, importe: 5000 }], cheques: [x.cheque(1000)] });
    expect(r.status).toBe(201);
    expect((await x.http.post(`/api/tesoreria/ingresos/${r.body.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    expect((await prisma.cuponTarjeta.findFirstOrThrow({ where: { ingresoId: r.body.id } })).estado).toBe('ANULADO');
    expect((await prisma.chequeTercero.findFirstOrThrow({ where: { ingresoId: r.body.id } })).estado).toBe('ANULADO');
  });

  it('consulta de cupones', async () => {
    const x = await tesoreria();
    await x.ingreso({ cupones: [{ tarjetaId: x.visa.id, importe: 5000 }, { tarjetaId: x.visa.id, importe: 2500 }] });
    const c = (await x.http.get(`/api/tesoreria/cupones?tarjetaId=${x.visa.id}&estado=PENDIENTE`)).body as { cupones: { importe: string; dias: number; cliente: string }[]; totales: { tarjeta: string; cantidad: number; importe: string }[] };
    expect(c.cupones).toHaveLength(2);
    expect(c.cupones[0].dias).toBeGreaterThanOrEqual(0);
    expect(c.totales).toEqual([{ tarjetaId: x.visa.id, tarjeta: 'Visa crédito', cantidad: 2, importe: '7500.00' }]);
  });
});
