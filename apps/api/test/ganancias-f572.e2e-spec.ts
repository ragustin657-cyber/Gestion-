import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { f572 } from './helpers-ganancias';
import { prepararSueldos } from './helpers-sueldos';

describe('ganancias: F.572 web', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const e = await s.empleado();
    const importar = (archivos: { nombre: string; xml: string }[], confirmar = false, token = s.token) => {
      let r = request(app.getHttpServer()).post('/api/sueldos/ganancias/f572/importar').set('Authorization', `Bearer ${token}`);
      if (confirmar) r = r.field('confirmar', 'true');
      for (const a of archivos) r = r.attach('archivos', Buffer.from(a.xml, 'utf8'), a.nombre);
      return r;
    };
    const ver = () => s.http.get(`/api/sueldos/ganancias/f572/${e.id}/2026`);
    return { ...s, e, importar, ver };
  };

  it('importa el ejemplo', async () => {
    const x = await escenario();
    const r = await x.importar([{ nombre: '20172543597_2026_presentacion_001.xml', xml: f572() }]);
    expect(r.status).toBe(201);
    expect([r.body.importados.length, r.body.omitidos, r.body.pendientes]).toEqual([1, [], []]);
    const g = (await x.ver()).body;
    expect([g.nroPresentacion, g.origen, g.modificadoAMano]).toEqual([1, 'IMPORTADO', false]);
    expect(g.datos.cargas).toEqual([{ parentesco: 'CONYUGE', documento: '30111222', nombre: 'GOMEZ ANA', mesDesde: 1, mesHasta: 12, porcentaje: 100 }]);
    expect(g.datos.deducciones[0]).toMatchObject({ tipo: 'CUOTAS_MEDICAS', codigo: '1', prestador: 'PREPAGA SA' });
    expect(g.datos.deducciones[0].meses).toHaveLength(12);
    expect(g.datos.deducciones[0].meses[0]).toEqual({ mes: 1, importe: '10000.00' });
    expect(g.datos.otrosEmpleadores[0]).toMatchObject({ cuit: '30700123452', meses: [{ mes: 3, bruta: '500000.00', aportes: '85000.00', retenido: '1000.00' }] });
  });

  it('CUIL inexistente y agente distinto', async () => {
    const x = await escenario();
    const r = await x.importar([{ nombre: 'a.xml', xml: f572({ cuil: '20111111112' }) }, { nombre: 'b.xml', xml: f572({ cuit: '30700000001' }) }, { nombre: 'c.xml', xml: '<no' }]);
    const motivos = Object.fromEntries((r.body.omitidos as { archivo: string; motivo: string }[]).map((o) => [o.archivo, o.motivo]));
    expect(motivos['a.xml']).toBe('Empleado inexistente (CUIL 20111111112)');
    expect(motivos['b.xml']).toBe('El F.572 de Pérez, Juan 1 está dirigido a otro empleador (CUIT 30700000001)');
    expect(motivos['c.xml']).toBe('XML inválido');
  });

  it('presentación repetida y reemplazo', async () => {
    const x = await escenario();
    await x.importar([{ nombre: 'a.xml', xml: f572() }]);
    const r = await x.importar([{ nombre: 'a.xml', xml: f572() }]);
    expect(r.body.omitidos).toEqual([{ archivo: 'a.xml', motivo: 'Presentación 1 ya importada' }]);
    const r2 = await x.importar([{ nombre: 'b.xml', xml: f572({ nro: 2 }) }]);
    expect(r2.body.importados.length).toBe(1);
    expect((await x.ver()).body.nroPresentacion).toBe(2);
  });

  it('no pisa una corrección manual sin confirmar', async () => {
    const x = await escenario();
    await x.importar([{ nombre: 'a.xml', xml: f572() }]);
    const g = (await x.ver()).body;
    const manual = { ...g.datos, deducciones: [] };
    expect((await x.http.put(`/api/sueldos/ganancias/f572/${x.e.id}/2026`, { datos: manual })).status).toBe(200);
    const r = await x.importar([{ nombre: 'b.xml', xml: f572({ nro: 2 }) }]);
    expect([r.body.importados.length, r.body.pendientes]).toEqual([0, [{ archivo: 'b.xml', empleado: 'Pérez, Juan 1' }]]);
    expect((await x.ver()).body.datos.deducciones).toEqual([]);
    const c = await x.importar([{ nombre: 'b.xml', xml: f572({ nro: 2 }) }], true);
    expect(c.body.importados.length).toBe(1);
    const final = (await x.ver()).body;
    expect([final.datos.deducciones.length, final.modificadoAMano, final.nroPresentacion]).toEqual([1, false, 2]);
  });

  it('código de deducción desconocido', async () => {
    const x = await escenario();
    const extra = '<deduccion tipo="99"><nroDoc>1</nroDoc><denominacion>RARO</denominacion><periodos><periodo mesDesde="2" mesHasta="2" montoMensual="5000.00"/></periodos></deduccion>';
    const r = await x.importar([{ nombre: 'a.xml', xml: f572({ extra }) }]);
    expect(r.body.importados[0].avisos).toEqual(['Deducción con código 99 (RARO) sin equivalente: se guarda y no se deduce']);
    const d = (await x.ver()).body.datos.deducciones.find((y: { codigo: string }) => y.codigo === '99');
    expect([d.tipo, d.meses]).toEqual(['OTRA', [{ mes: 2, importe: '5000.00' }]]);
  });

  it('carga manual sin importar', async () => {
    const x = await escenario();
    const datos = { cargas: [], otrosEmpleadores: [], deducciones: [{ tipo: 'ALQUILER', codigo: '', prestador: 'Dueño', meses: [{ mes: 1, importe: '300000.00' }] }] };
    expect((await x.http.put(`/api/sueldos/ganancias/f572/${x.e.id}/2026`, { datos })).status).toBe(200);
    const g = (await x.ver()).body;
    expect([g.origen, g.modificadoAMano, g.datos.deducciones[0].tipo]).toEqual(['MANUAL', true, 'ALQUILER']);
    const mal = await x.http.put(`/api/sueldos/ganancias/f572/${x.e.id}/2026`, { datos: { ...datos, deducciones: [{ ...datos.deducciones[0], meses: [{ mes: 13, importe: '1' }] }] } });
    expect(mal.status).toBe(400);
  });

  it('acumulado previo', async () => {
    const x = await escenario();
    const vacio = (await x.http.get(`/api/sueldos/ganancias/acumulado/${x.e.id}/2026`)).body;
    expect(vacio).toEqual({ bruta: '0.00', aportes: '0.00', retenido: '0.00' });
    expect((await x.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2026`, { bruta: 5000000, aportes: 850000, retenido: 120000 })).status).toBe(200);
    expect((await x.http.get(`/api/sueldos/ganancias/acumulado/${x.e.id}/2026`)).body).toEqual({ bruta: '5000000.00', aportes: '850000.00', retenido: '120000.00' });
  });

  it('permisos', async () => {
    const x = await escenario();
    const u = await otroUsuario(app, prisma, x.empresaId, ['sueldos.ver']);
    expect((await x.importar([{ nombre: 'a.xml', xml: f572() }], false, u.token)).status).toBe(403);
    expect((await u.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2026`, { bruta: 1, aportes: 0, retenido: 0 })).status).toBe(403);
    expect((await u.http.get(`/api/sueldos/ganancias/f572/${x.e.id}/2026`)).status).toBe(200);
  });
});
