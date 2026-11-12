import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararBienes } from './helpers-bienes';

describe('bienes de uso: altas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('factura con renglón de rubro exige el bien', async () => {
    const b = await prepararBienes(app, prisma);
    const r = await b.factura({ neto: 1000, bien: null });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Indique el bien de uso del renglón 1');
  });

  it('alta desde factura', async () => {
    const b = await prepararBienes(app, prisma);
    const { bien } = await b.facturaBien({ neto: 1200000 });
    const r = (await b.http.get(`/api/bienes-uso/${bien.id}`)).body;
    expect(r).toMatchObject({ numero: 1, origen: 'FACTURA', valorOrigen: '1200000.00', vidaUtilMeses: 60, fechaAlta: '2026-03-15', descripcion: 'Camioneta', estado: 'ACTIVO' });
    const usd = await b.facturaBien({ neto: 1000, moneda: 'USD', cotizacion: 1000, fecha: '2026-04-10', bien: { descripcion: 'Notebook', vidaUtilMeses: 24 }, cuenta: '1.2.01.003' });
    expect(usd.bien).toMatchObject({ numero: 2, vidaUtilMeses: 24 });
    expect(usd.bien.valorOrigen.toFixed(2)).toBe('1000000.00');
    expect((await b.http.get('/api/bienes-uso')).body.map((x: { numero: number }) => x.numero)).toEqual([1, 2]);
  });

  it('anular factura sin amortizaciones elimina el bien', async () => {
    const b = await prepararBienes(app, prisma);
    const { comprobanteId, bien } = await b.facturaBien({ neto: 1200000 });
    expect((await b.http.post(`/api/compras/comprobantes/${comprobanteId}/anular`, { motivo: 'Error de carga' })).status).toBe(200);
    expect(await prisma.bienUso.count({ where: { id: bien.id } })).toBe(0);
  });


  it('alta manual con asiento', async () => {
    const b = await prepararBienes(app, prisma);
    const rodados = await b.rubro('Rodados');
    const base = { origen: 'MANUAL', descripcion: 'Utilitario aportado', rubroId: rodados.id, fechaAlta: '2026-05-10', valorOrigen: 500000 };
    expect((await b.http.post('/api/bienes-uso', { ...base, cuentaContrapartidaId: await b.cuenta('1.2.01.002') })).status).toBe(400);
    const r = await b.http.post('/api/bienes-uso', { ...base, cuentaContrapartidaId: await b.cuenta('3.1.01') });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ origen: 'MANUAL', vidaUtilMeses: 60 });
    expect(await b.saldo('1.2.01.002')).toBe('500000.00');
    expect(await b.saldo('3.1.01')).toBe('-500000.00');
  });

  it('carga inicial sin asiento', async () => {
    const b = await prepararBienes(app, prisma);
    const rodados = await b.rubro('Rodados');
    const base = { origen: 'INICIAL', descripcion: 'Auto', rubroId: rodados.id, fechaAlta: '2024-03-10', valorOrigen: 1200000, fechaAmortizacionInicial: '2026-02-28' };
    expect((await b.http.post('/api/bienes-uso', { ...base, amortizacionInicial: 1300000 })).status).toBe(400);
    const r = await b.http.post('/api/bienes-uso', { ...base, amortizacionInicial: 600000 });
    expect(r.status).toBe(201);
    expect(r.body.asientoAltaId).toBeNull();
    expect(await b.saldo('1.2.01.002')).toBe('0.00');
  });

  it('edición', async () => {
    const b = await prepararBienes(app, prisma);
    const { bien } = await b.facturaBien({ neto: 1200000 });
    const r = await b.http.put(`/api/bienes-uso/${bien.id}`, { descripcion: 'Camioneta 4x4', vidaUtilMeses: 48 });
    expect(r.body).toMatchObject({ descripcion: 'Camioneta 4x4', vidaUtilMeses: 48 });
  });

  it('valida residual', async () => {
    const b = await prepararBienes(app, prisma);
    const rodados = await b.rubro('Rodados');
    const r = await b.http.post('/api/bienes-uso', { origen: 'MANUAL', descripcion: 'x', rubroId: rodados.id, fechaAlta: '2026-05-10', valorOrigen: 1000, valorResidual: 1000, cuentaContrapartidaId: await b.cuenta('3.1.01') });
    expect(r.body.message).toBe('El valor residual debe ser menor que el valor de origen');
    expect((await b.factura({ neto: 1000, bien: { descripcion: 'x', valorResidual: 2000 } })).body.message).toBe('El valor residual debe ser menor que el valor de origen');
  });

  it('elimina un alta manual y su asiento', async () => {
    const b = await prepararBienes(app, prisma);
    const rodados = await b.rubro('Rodados');
    const r = await b.http.post('/api/bienes-uso', { origen: 'MANUAL', descripcion: 'x', rubroId: rodados.id, fechaAlta: '2026-05-10', valorOrigen: 1000, cuentaContrapartidaId: await b.cuenta('3.1.01') });
    expect((await b.http.delete(`/api/bienes-uso/${r.body.id}`)).status).toBe(200);
    expect(await b.saldo('1.2.01.002')).toBe('0.00');
    const f = await b.facturaBien({ neto: 1000 });
    expect((await b.http.delete(`/api/bienes-uso/${f.bien.id}`)).body.message).toBe('Un bien dado de alta por factura se elimina anulando la factura');
  });
});
