import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararBienes } from './helpers-bienes';
import { prepararVentas } from './helpers-ventas';

describe('bienes de uso: bajas y ventas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const b = await prepararBienes(app, prisma, v);
    const { bien } = await b.facturaBien({ neto: 1200000 });
    const venta = (o: Record<string, unknown> = {}) => v.datos({ fecha: '2026-10-15', fechaVencimiento: '2026-11-15', renglones: [{ bienUsoId: bien.id, descripcion: 'Camioneta', cantidad: 1, precioUnitario: 1100000, alicuota: 21 }], ...o });
    return { v, b, bien, venta };
  };

  it('venta del ejemplo', async () => {
    const { v, b, bien, venta } = await escenario();
    await b.generar('2026-09');
    const r = await v.http.post('/api/ventas/comprobantes', { ...venta(), emitir: true });
    expect(r.body.estado).toBe('AUTORIZADO');
    expect((await b.http.get(`/api/bienes-uso/${bien.id}`)).body).toMatchObject({ estado: 'BAJA', motivoBaja: 'VENTA', fechaBaja: '2026-10-15' });
    expect(await b.saldo('4.2.05')).toBe('-40000.00');
    expect(await b.saldo('1.2.01.002')).toBe('0.00');
    expect(await b.saldo('1.2.02.002')).toBe('0.00');
    expect(await b.saldo('4.1.01')).toBe('0.00');
    expect((await v.http.get('/api/informes/ventas?desde=2026-10-01&hasta=2026-10-31&agrupar=cliente')).body.totales.ventas).toBe('0.00');
    expect((await b.http.get('/api/bienes-uso/amortizacion/previa?mes=2026-12')).body.total).toBe('0.00');
  });

  it('venta sin la amortización previa', async () => {
    const { v, b, venta } = await escenario();
    await b.generar('2026-08');
    expect((await v.http.post('/api/ventas/comprobantes', venta())).body.message).toBe('Genere primero la amortización de 09/2026');
  });

  it('bien en dos comprobantes y notas de crédito', async () => {
    const { v, b, venta } = await escenario();
    await b.generar('2026-09');
    expect((await v.http.post('/api/ventas/comprobantes', venta())).status).toBe(201);
    expect((await v.http.post('/api/ventas/comprobantes', venta())).body.message).toBe('El bien N° 1 ya está en otro comprobante');
    const f = await v.factura();
    const nc = await v.http.post('/api/ventas/comprobantes', venta({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.id, fecha: '2026-11-03', fechaVencimiento: '2026-11-03' }));
    expect(nc.body.message).toBe('Una nota de crédito no puede vender un bien de uso');
  });

  it('rechazo de ARCA deja el bien activo', async () => {
    const { v, b, bien, venta } = await escenario();
    await b.generar('2026-09');
    const r = (await v.http.post('/api/ventas/comprobantes', venta())).body;
    await prisma.comprobanteVenta.update({ where: { id: r.id }, data: { estado: 'RECHAZADO' } });
    expect((await b.http.get(`/api/bienes-uso/${bien.id}`)).body.estado).toBe('ACTIVO');
    const otro = await v.http.post('/api/ventas/comprobantes', { ...venta(), emitir: true });
    expect(otro.body.estado).toBe('AUTORIZADO');
  });

  it('baja manual y anulación', async () => {
    const { b, bien } = await escenario();
    await b.generar('2026-09');
    const r = await b.http.post(`/api/bienes-uso/${bien.id}/baja`, { fecha: '2026-10-15', motivo: 'DESUSO' });
    expect(r.status).toBe(201);
    const asiento = await prisma.asiento.findUniqueOrThrow({ where: { id: r.body.asientoBajaId }, include: { renglones: true } });
    expect(asiento.renglones.every((x) => x.fechaOrigen?.toISOString().slice(0, 10) === '2026-03-01')).toBe(true);
    expect([await b.saldo('1.2.02.002'), await b.saldo('5.2.08'), await b.saldo('1.2.01.002')]).toEqual(['0.00', '1060000.00', '0.00']);
    expect((await b.http.post(`/api/bienes-uso/${bien.id}/baja`, { fecha: '2026-10-20', motivo: 'ROBO' })).body.message).toBe('El bien ya está dado de baja');
    expect((await b.http.post(`/api/bienes-uso/${bien.id}/baja/anular`)).status).toBe(201);
    expect((await b.http.get(`/api/bienes-uso/${bien.id}`)).body.estado).toBe('ACTIVO');
    expect(await b.saldo('5.2.08')).toBe('0.00');
    await b.generar('2026-10');
    expect((await b.http.post(`/api/bienes-uso/${bien.id}/baja`, { fecha: '2026-10-15', motivo: 'DESUSO' })).body.message).toBe('El bien tiene amortizaciones posteriores a la baja');
  });

  it('vida útil cumplida', async () => {
    const { b } = await escenario();
    const rubro = await b.rubro('Equipos de computación');
    const r = await b.http.post('/api/bienes-uso', { origen: 'INICIAL', descripcion: 'PC vieja', rubroId: rubro.id, fechaAlta: '2023-01-10', valorOrigen: 3600, amortizacionInicial: 3600, fechaAmortizacionInicial: '2025-12-31' });
    expect(r.status).toBe(201);
    expect((await b.http.get('/api/bienes-uso/amortizacion/previa?mes=2026-10')).body.filas.map((f: { descripcion: string }) => f.descripcion)).toEqual(['Camioneta']);
    const baja = await b.http.post(`/api/bienes-uso/${r.body.id}/baja`, { fecha: '2026-10-15', motivo: 'DESUSO' });
    expect(baja.status).toBe(201);
    expect(await b.saldo('5.2.08')).toBe('0.00');
    expect(await b.saldo('1.2.02.003')).toBe('3600.00');
    expect(await b.saldo('1.2.01.003')).toBe('-3600.00');
  });
});
