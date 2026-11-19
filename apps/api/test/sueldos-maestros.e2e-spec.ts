import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: maestros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('empresa nueva trae Comercio', async () => {
    const s = await prepararSueldos(app, prisma);
    const convenios = (await s.http.get('/api/sueldos/convenios')).body;
    expect(convenios).toEqual([expect.objectContaining({ nombre: 'Comercio (CCT 130/75)', horasMensuales: 200 })]);
    expect(convenios[0].categorias).toHaveLength(21);
    expect(convenios[0].categorias.map((c: { nombre: string }) => c.nombre)).toContain('Vendedor B');
    const conceptos = (await s.http.get('/api/sueldos/conceptos')).body as { codigo: string; tipo: string; parametros: Record<string, unknown>; soloAfiliados: boolean }[];
    expect(conceptos.map((c) => c.codigo)).toEqual(['100', '110', '120', '130', '131', '140', '150', '151', '210', '500', '510', '520', '530', '540', '560', '561']);
    expect(conceptos.find((c) => c.codigo === '120')).toMatchObject({ tipo: 'PORCENTAJE', parametros: { pct: 8.33, base: 'BASICO_MAS_ANTIGUEDAD', pierdeConAusencia: true } });
    expect(conceptos.find((c) => c.codigo === '540')).toMatchObject({ soloAfiliados: true, parametros: { pct: 2, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' } });
  });

  it('escalas a mano e importadas', async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const r = await s.http.post(`/api/sueldos/escalas/importar?convenioId=${s.convenio.id}`).attach('archivo', Buffer.from('Categoría;MM/AAAA;Básico\nVendedor A;12/2026;1.050.000,50\n'), 'e.csv');
    expect(r.status).toBe(201);
    const dic = (await s.http.get(`/api/sueldos/escalas?convenioId=${s.convenio.id}&anio=2026&mes=12`)).body as { categoria: string; basico: string | null }[];
    expect(dic.find((x) => x.categoria === 'Vendedor A')!.basico).toBe('1050000.50');
    expect(dic.find((x) => x.categoria === 'Vendedor B')!.basico).toBe('1000000.00'); // vigente más reciente (noviembre)
    const mal = await s.http.post(`/api/sueldos/escalas/importar?convenioId=${s.convenio.id}`).attach('archivo', Buffer.from('Categoría;MM/AAAA;Básico\nGerente;12/2026;1\n'), 'e.csv');
    expect([mal.status, mal.body.errores]).toEqual([400, [{ linea: 2, mensaje: 'Categoría inexistente: Gerente' }]]);
  });

  it('empleados', async () => {
    const s = await prepararSueldos(app, prisma);
    const e = await s.empleado();
    expect(e.legajo).toBe(1);
    expect((await s.empleado()).legajo).toBe(2);
    const cat = await s.categoria('Vendedor B');
    const mal = await s.http.post('/api/sueldos/empleados', { apellido: 'X', nombre: 'Y', cuil: '20-12345678-5', domicilio: 'x', fechaIngreso: '2026-01-01', categoriaId: cat.id, afiliadoSindicato: false, obraSocial: 'x', formaPago: 'EFECTIVO' });
    expect(mal.body.message).toBe('CUIL inválido');
    expect((await s.http.put(`/api/sueldos/empleados/${e.id}`, { fechaEgreso: '2026-11-10' })).body.fechaEgreso).toBe('2026-11-10');
    expect((await s.http.get('/api/sueldos/empleados')).body).toHaveLength(2);
  });

  it('conceptos editables', async () => {
    const s = await prepararSueldos(app, prisma);
    const c = (await s.http.get('/api/sueldos/conceptos')).body.find((x: { codigo: string }) => x.codigo === '120');
    const r = await s.http.put(`/api/sueldos/conceptos/${c.id}`, { ...c, parametros: { ...c.parametros, pct: 10 } });
    expect(r.body.parametros.pct).toBe(10);
    expect((await s.http.post('/api/sueldos/conceptos', { codigo: '999', nombre: 'X', clase: 'REMUNERATIVO', tipo: 'OTRO', parametros: {}, orden: 999 })).status).toBe(400);
  });

  it('permisos', async () => {
    const s = await prepararSueldos(app, prisma);
    const u = await otroUsuario(app, prisma, s.empresaId, ['sueldos.ver']);
    expect((await u.http.get('/api/sueldos/empleados')).status).toBe(200);
    expect((await u.http.post('/api/sueldos/empleados', {})).status).toBe(403);
  });
});
