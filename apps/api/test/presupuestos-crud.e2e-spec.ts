import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararPresupuestos } from './helpers-presupuestos';

type Linea = { codigo: string; centroCosto: string | null; importes: Record<string, string>; total: string };

describe('presupuestos: versiones y grilla', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('crea, edita líneas y arma la grilla', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    expect((await p.linea(a.id, '4.1.01', { '2026-11': 1000000 })).status).toBe(200);
    await p.linea(a.id, '5.2.01', { '2026-11': 200000 });
    await p.linea(a.id, '5.2.01', { '2026-11': 100000 }, 'ROS');
    const g = (await p.http.get(`/api/presupuestos/${a.id}/grilla`)).body;
    expect(g.meses).toHaveLength(12);
    expect([g.meses[0], g.meses[11]]).toEqual(['2026-01', '2026-12']);
    expect(g.lineas.map((l: Linea) => [l.codigo, l.centroCosto, l.importes['2026-11'], l.total])).toEqual([
      ['4.1.01', null, '1000000.00', '1000000.00'], ['5.2.01', null, '200000.00', '200000.00'], ['5.2.01', 'Rosario', '100000.00', '100000.00'],
    ]);
    expect(g.totales).toMatchObject({ ingresos: '1000000.00', egresos: '300000.00', resultado: '700000.00' });
    expect(g.totales.porMes['2026-11']).toBe('700000.00');
    await p.linea(a.id, '5.2.01', { '2026-11': 0 }, 'ROS');
    expect((await p.http.get(`/api/presupuestos/${a.id}/grilla`)).body.lineas).toHaveLength(2);
    const lista = (await p.http.get(`/api/presupuestos?ejercicioId=${p.ejercicio.id}`)).body;
    expect(lista).toEqual([expect.objectContaining({ nombre: 'Original 2026', vigente: false, totalIngresos: '1000000.00', totalEgresos: '200000.00' })]);
  });

  it('valida líneas', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    expect((await p.linea(a.id, '1.1.01.001', { '2026-11': 1 })).body.message).toBe('La cuenta 1.1.01.001 no es de resultados');
    expect((await p.linea(a.id, '4.1.01', { '2027-01': 1 })).body.message).toBe('El mes 01/2027 no pertenece al ejercicio');
    expect((await p.linea(a.id, '4.1.01', { '2026-01': -5 })).status).toBe(400);
  });

  it('vigente único y copiar', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    await p.linea(a.id, '4.1.01', { '2026-03': 500 });
    const b = await p.crear('Revisado');
    expect((await p.http.post(`/api/presupuestos/${a.id}/vigente`)).status).toBe(201);
    await p.http.post(`/api/presupuestos/${b.id}/vigente`);
    const vig = async () => (await prisma.presupuesto.findMany({ where: { empresaId: p.empresaId, vigente: true } })).map((x) => x.nombre).sort();
    expect(await vig()).toEqual(['Revisado']);
    // Otro ejercicio: su vigente no se toca
    const sig = (await p.http.post('/api/contabilidad/ejercicios/siguiente')).body;
    const otro = (await p.http.post('/api/presupuestos', { ejercicioId: sig.id, nombre: 'Plan 2027' })).body;
    await p.http.post(`/api/presupuestos/${otro.id}/vigente`);
    await p.http.post(`/api/presupuestos/${a.id}/vigente`);
    expect(await vig()).toEqual(['Original 2026', 'Plan 2027']);
    const c = await p.crear('Copia', { copiarDeId: a.id });
    expect((await p.http.get(`/api/presupuestos/${c.id}/grilla`)).body.lineas[0].importes['2026-03']).toBe('500.00');
    expect((await p.http.delete(`/api/presupuestos/${a.id}`)).body.message).toBe('Marque otro presupuesto como vigente antes de eliminarlo');
    expect((await p.http.delete(`/api/presupuestos/${c.id}`)).status).toBe(200);
    expect((await p.http.post('/api/presupuestos', { ejercicioId: p.ejercicio.id, nombre: 'Revisado' })).status).toBe(400);
  });

  it('permisos', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const u = await otroUsuario(app, prisma, p.empresaId, ['presupuesto.ver']);
    expect((await u.http.get(`/api/presupuestos?ejercicioId=${p.ejercicio.id}`)).status).toBe(200);
    expect((await u.http.post('/api/presupuestos', { ejercicioId: p.ejercicio.id, nombre: 'X' })).status).toBe(403);
  });
});
