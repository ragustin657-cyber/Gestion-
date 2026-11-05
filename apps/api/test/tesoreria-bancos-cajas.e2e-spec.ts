import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('movimientos bancarios, transferencias internas, movimientos de caja y arqueos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('gasto bancario: egreso del banco y asiento contra la cuenta elegida', async () => {
    const t = await prepararTesoreria(app, prisma);
    const r = await t.http.post('/api/tesoreria/movimientos-bancarios', {
      fecha: '2026-11-12', cuentaBancariaId: t.ars.id, tipo: 'GASTO', cuentaContableId: await t.cuenta('5.2.02'), concepto: 'Mantenimiento de cuenta', importe: 1200,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ numero: 1, tipo: 'GASTO' });
    expect(await t.saldoBanco(t.ars.id)).toBe(-1200);
    expect(await t.asiento(r.body.asientoId)).toEqual({ '5.2.02': ['1200', '0'], '1.1.01.002': ['0', '1200'] });
    const ing = await t.http.post('/api/tesoreria/movimientos-bancarios', {
      fecha: '2026-11-12', cuentaBancariaId: t.ars.id, tipo: 'INGRESO', cuentaContableId: await t.cuenta('4.2.01'), concepto: 'Intereses', importe: 200,
    });
    expect(await t.asiento(ing.body.asientoId)).toEqual({ '1.1.01.002': ['200', '0'], '4.2.01': ['0', '200'] });
    expect((await t.http.get('/api/tesoreria/movimientos-bancarios')).body.total).toBe(2);
    const cero = await t.http.post('/api/tesoreria/movimientos-bancarios', {
      fecha: '2026-11-12', cuentaBancariaId: t.ars.id, tipo: 'GASTO', cuentaContableId: await t.cuenta('5.2.02'), concepto: 'x', importe: 0,
    });
    expect(cero.status).toBe(400);
    expect(cero.body.campos.importe).toBeTruthy();
  });

  it('transferencia de pesos a dólares con diferencia de cambio', async () => {
    const t = await prepararTesoreria(app, prisma);
    const padre = await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: t.empresaId, codigo: '1.1.01' } });
    const bancoUsd = await prisma.cuentaContable.create({ data: { empresaId: t.empresaId, codigo: '1.1.01.006', nombre: 'Banco en dólares', padreId: padre.id, imputable: true, tipo: 'ACTIVO' } });
    await t.http.patch(`/api/tesoreria/cuentas-bancarias/${t.usd.id}`, { cuentaContableId: bancoUsd.id });
    await prisma.cotizacion.create({ data: { empresaId: t.empresaId, monedaCodigo: 'USD', fecha: new Date('2026-11-12T00:00:00Z'), valor: 1000 } });
    const r = await t.http.post('/api/tesoreria/transferencias-internas', {
      fecha: '2026-11-12', origen: { cuentaBancariaId: t.ars.id }, destino: { cuentaBancariaId: t.usd.id }, importeOrigen: 1050000, importeDestino: 1000, concepto: 'Compra de dólares',
    });
    expect(r.status).toBe(201);
    expect(await t.saldoBanco(t.ars.id)).toBe(-1050000);
    expect(await t.saldoBanco(t.usd.id)).toBe(1000);
    expect(await t.asiento(r.body.asientoId)).toEqual({ '1.1.01.006': ['1000000', '0'], '5.2.03': ['50000', '0'], '1.1.01.002': ['0', '1050000'] });
    expect(r.body.cotizacion).toBe('1050');
  });

  it('transferencia en la misma moneda: importes iguales; de caja a banco', async () => {
    const t = await prepararTesoreria(app, prisma);
    await t.ingresar({ efectivo: 5000 });
    const distinta = await t.http.post('/api/tesoreria/transferencias-internas', {
      fecha: '2026-11-12', origen: { cajaId: t.cajaCen.id }, destino: { cuentaBancariaId: t.ars.id }, importeOrigen: 1000, importeDestino: 999,
    });
    expect(distinta.status).toBe(400);
    const igual = await t.http.post('/api/tesoreria/transferencias-internas', {
      fecha: '2026-11-12', origen: { cajaId: t.cajaCen.id }, destino: { cajaId: t.cajaCen.id }, importeOrigen: 1, importeDestino: 1,
    });
    expect(igual.status).toBe(400);
    const saldo = await t.http.post('/api/tesoreria/transferencias-internas', {
      fecha: '2026-11-12', origen: { cajaId: t.cajaCen.id }, destino: { cuentaBancariaId: t.ars.id }, importeOrigen: 6000, importeDestino: 6000,
    });
    expect(saldo.status).toBe(400);
    expect(saldo.body.message).toBe('Saldo insuficiente en la caja');
    const ok = await t.http.post('/api/tesoreria/transferencias-internas', {
      fecha: '2026-11-12', origen: { cajaId: t.cajaCen.id }, destino: { cuentaBancariaId: t.ars.id }, importeOrigen: 1000, importeDestino: 1000,
    });
    expect(ok.status).toBe(201);
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(4000);
    expect(await t.saldoBanco(t.ars.id)).toBe(1000);
    expect(await t.asiento(ok.body.asientoId)).toEqual({ '1.1.01.002': ['1000', '0'], '1.1.01.001': ['0', '1000'] });
    expect((await t.http.get('/api/tesoreria/transferencias-internas')).body.total).toBe(1);
  });

  it('movimientos de caja: ingreso, egreso mayor al saldo y alcance por sucursal', async () => {
    const t = await prepararTesoreria(app, prisma);
    const base = { fecha: '2026-11-12', cajaId: t.cajaRos.id, cuentaContableId: await t.cuenta('5.2.01'), concepto: 'Viáticos' };
    const ing = await t.rosario.post('/api/tesoreria/movimientos-caja', { ...base, tipo: 'INGRESO', cuentaContableId: await t.cuenta('4.2.01'), concepto: 'Fondo', importe: 2000 });
    expect(ing.status).toBe(201);
    expect(await t.asiento(ing.body.asientoId)).toEqual({ '1.1.01.001': ['2000', '0'], '4.2.01': ['0', '2000'] });
    const mucho = await t.rosario.post('/api/tesoreria/movimientos-caja', { ...base, tipo: 'EGRESO', importe: 2000.01 });
    expect(mucho.status).toBe(400);
    expect(mucho.body.message).toBe('Saldo insuficiente en la caja');
    const eg = await t.rosario.post('/api/tesoreria/movimientos-caja', { ...base, tipo: 'EGRESO', importe: 500 });
    expect(eg.status).toBe(201);
    expect(await t.asiento(eg.body.asientoId)).toEqual({ '5.2.01': ['500', '0'], '1.1.01.001': ['0', '500'] });
    expect(await t.saldoCaja(t.cajaRos.id)).toBe(1500);
    const ajena = await t.rosario.post('/api/tesoreria/movimientos-caja', { ...base, cajaId: t.cajaCen.id, tipo: 'INGRESO', importe: 1 });
    expect(ajena.status).toBe(404);
    const cero = await t.rosario.post('/api/tesoreria/movimientos-caja', { ...base, tipo: 'INGRESO', importe: 0 });
    expect(cero.status).toBe(400);
    expect(cero.body.campos.importe).toBeTruthy();
    expect((await t.rosario.get('/api/tesoreria/movimientos-caja')).body.total).toBe(2);
    expect((await t.rosario.post('/api/tesoreria/movimientos-bancarios', {
      fecha: '2026-11-12', cuentaBancariaId: t.ars.id, tipo: 'GASTO', cuentaContableId: await t.cuenta('5.2.02'), concepto: 'x', importe: 1,
    })).status).toBe(403);
  });

  it('arqueo con faltante, con sobrante y sin diferencia', async () => {
    const t = await prepararTesoreria(app, prisma);
    await t.ingresar({ efectivo: 10000 });
    const sinMotivo = await t.http.post('/api/tesoreria/arqueos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, contado: 9800 });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.campos.motivo).toBeTruthy();
    expect((await t.http.post('/api/tesoreria/arqueos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, contado: -1 })).status).toBe(400);

    const falt = await t.http.post('/api/tesoreria/arqueos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, contado: 9800, motivo: 'Error de vuelto' });
    expect(falt.status).toBe(201);
    expect(falt.body).toMatchObject({ saldoSistema: '10000', contado: '9800', diferencia: '-200' });
    expect(await t.asiento(falt.body.asientoId)).toEqual({ '5.2.04': ['200', '0'], '1.1.01.001': ['0', '200'] });
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(9800);
    expect(await prisma.movimientoCaja.count({ where: { arqueoId: falt.body.id } })).toBe(1);

    const sobr = await t.http.post('/api/tesoreria/arqueos', { fecha: '2026-11-13', cajaId: t.cajaCen.id, contado: 9900, motivo: 'Cobro no registrado' });
    expect(sobr.body.diferencia).toBe('100');
    expect(await t.asiento(sobr.body.asientoId)).toEqual({ '1.1.01.001': ['100', '0'], '5.2.04': ['0', '100'] });

    const asientos = await prisma.asiento.count();
    const igual = await t.http.post('/api/tesoreria/arqueos', { fecha: '2026-11-14', cajaId: t.cajaCen.id, contado: 9900 });
    expect(igual.status).toBe(201);
    expect(igual.body).toMatchObject({ diferencia: '0', asientoId: null });
    expect(await prisma.asiento.count()).toBe(asientos);
    expect((await t.http.get(`/api/tesoreria/arqueos?cajaId=${t.cajaCen.id}`)).body.total).toBe(3);
  });
});
