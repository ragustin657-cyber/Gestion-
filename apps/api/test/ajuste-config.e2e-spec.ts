import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { escenarioAjuste, INDICES_EJEMPLO } from './helpers-ajuste';

describe('ajuste por inflación: configuración y anticuación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function conApertura() {
    const e = await escenarioAjuste(app, prisma);
    await e.indices(INDICES_EJEMPLO);
    await e.apertura([['1.2.01.002', 600, 0], ['1.1.01.002', 400, 0], ['3.1.01', 0, 1000]]);
    return e;
  }

  it('sin configuración responde vacío; lista las cuentas no monetarias con saldo de apertura', async () => {
    const e = await conApertura();
    const vacio = await e.s.http.get('/api/contabilidad/ajuste-inflacion/config');
    expect(vacio.status).toBe(200);
    expect(vacio.body).toEqual({ primerEjercicioId: null, asientoAperturaId: null, anticuacion: [] });
    expect((await e.config({ anticuacion: [] })).status).toBe(200);
    const r = await e.s.http.get('/api/contabilidad/ajuste-inflacion/config');
    expect(r.body.primerEjercicioId).toBe(e.ej.id);
    expect(r.body.anticuacion.map((a: { codigo: string; saldoApertura: string; tramos: unknown[] }) => [a.codigo, a.saldoApertura, a.tramos])).toEqual([
      ['1.2.01.002', '600.00', []], ['3.1.01', '-1000.00', []],
    ]);
  });

  it('guarda los tramos y los devuelve', async () => {
    const e = await conApertura();
    const rodados = await e.s.cuenta('1.2.01.002');
    expect((await e.config({ anticuacion: [{ cuentaContableId: rodados, tramos: [{ anio: 2025, mes: 6, importe: 400 }, { anio: 2025, mes: 12, importe: 200 }] }] })).status).toBe(200);
    const r = await e.s.http.get('/api/contabilidad/ajuste-inflacion/config');
    expect(r.body.anticuacion[0].tramos).toEqual([{ anio: 2025, mes: 6, importe: '400.00' }, { anio: 2025, mes: 12, importe: '200.00' }]);
    // reemplaza todo
    await e.config({ anticuacion: [] });
    expect((await e.s.http.get('/api/contabilidad/ajuste-inflacion/config')).body.anticuacion[0].tramos).toEqual([]);
  });

  it('valida la anticuación', async () => {
    const e = await conApertura();
    const rodados = await e.s.cuenta('1.2.01.002');
    const msj = async (cuentaContableId: string, tramos: unknown[]) => (await e.config({ anticuacion: [{ cuentaContableId, tramos }] })).body.message;
    expect(await msj(rodados, [{ anio: 2025, mes: 6, importe: 700 }])).toBe('La anticuación de 1.2.01.002 supera su saldo de apertura');
    expect(await msj(rodados, [{ anio: 2025, mes: 6, importe: -100 }])).toBe('La anticuación de 1.2.01.002 supera su saldo de apertura');
    expect(await msj(rodados, [{ anio: 2026, mes: 1, importe: 100 }])).toBe('El mes de origen debe ser anterior al inicio del ejercicio');
    expect(await msj(await e.s.cuenta('1.1.01.002'), [{ anio: 2025, mes: 6, importe: 100 }])).toBe('Solo se anticúan cuentas no monetarias con saldo de apertura');
    expect(await msj(await e.s.cuenta('3.2.01'), [{ anio: 2025, mes: 6, importe: 100 }])).toBe('Solo se anticúan cuentas no monetarias con saldo de apertura');
  });

  it('apertura cargada con un asiento manual', async () => {
    const e = await escenarioAjuste(app, prisma);
    const a = await e.asiento('2026-01-01', [['1.2.01.002', 600, 0], ['3.1.01', 0, 600]]);
    expect((await e.config({ asientoAperturaId: a.id, anticuacion: [] })).status).toBe(200);
    const r = await e.s.http.get('/api/contabilidad/ajuste-inflacion/config');
    expect(r.body.asientoAperturaId).toBe(a.id);
    expect(r.body.anticuacion.map((x: { codigo: string; saldoApertura: string }) => [x.codigo, x.saldoApertura])).toEqual([['1.2.01.002', '600.00'], ['3.1.01', '-600.00']]);
    const sig = await e.s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    const otro = await e.asiento('2027-01-05', [['1.2.01.002', 1, 0], ['3.1.01', 0, 1]]);
    expect(sig.status).toBe(201);
    expect((await e.config({ asientoAperturaId: otro.id, anticuacion: [] })).body.message).toBe('El asiento de apertura debe ser del primer ejercicio ajustado');
  });

  it('pide el permiso de cierre para modificar', async () => {
    const e = await conApertura();
    const lector = await otroUsuario(app, prisma, e.s.empresaId, ['plancuentas.ver']);
    expect((await lector.http.get('/api/contabilidad/ajuste-inflacion/config')).status).toBe(200);
    expect((await lector.http.put('/api/contabilidad/ajuste-inflacion/config', { primerEjercicioId: e.ej.id, anticuacion: [] })).status).toBe(403);
  });

  it('un asiento de apertura anulado después de configurarlo no se usa', async () => {
    const e = await escenarioAjuste(app, prisma);
    await e.indices(INDICES_EJEMPLO);
    const a = await e.asiento('2026-01-01', [['1.2.01.002', 600, 0], ['3.1.01', 0, 600]]);
    expect((await e.config({ asientoAperturaId: a.id, anticuacion: [] })).status).toBe(200);
    expect((await e.s.http.post(`/api/contabilidad/asientos/${a.id}/anular`, { fecha: '2026-02-10', motivo: 'Error' })).status).toBe(201);
    const r = await e.s.http.get('/api/contabilidad/ajuste-inflacion/previa?fecha=2026-03-31');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El asiento de apertura está anulado: actualice la configuración');
  });
});
