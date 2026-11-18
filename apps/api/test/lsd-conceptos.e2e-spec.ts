import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

interface Concepto { id: string; codigo: string; codigoArca: string; clase: string; tipo: string; parametros: Record<string, unknown>; orden: number; destino: string; activo: boolean }

describe('LSD: conceptos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const conceptos = async (s: Awaited<ReturnType<typeof prepararSueldos>>) => (await s.http.get('/api/sueldos/conceptos')).body as Concepto[];

  it('precarga con códigos ARCA', async () => {
    const s = await prepararSueldos(app, prisma);
    const cs = await conceptos(s);
    expect(Object.fromEntries(cs.map((c) => [c.codigo, c.codigoArca]))).toMatchObject({ 100: '110000', 120: '170001', 210: '550000', 520: '810002' });
  });

  it('alta sin código usa el de defecto', async () => {
    const s = await prepararSueldos(app, prisma);
    const r = await s.http.post('/api/sueldos/conceptos', { codigo: '900', nombre: 'Plus', clase: 'REMUNERATIVO', tipo: 'FIJO', parametros: { importe: 100 }, orden: 900 });
    expect([r.status, r.body.codigoArca]).toEqual([201, '160000']);
  });

  it('código fuera de rango', async () => {
    const s = await prepararSueldos(app, prisma);
    const c = (await conceptos(s)).find((x) => x.codigo === '110')!;
    const { id, codigoArca: _a, ...datos } = c as Concepto & Record<string, unknown>;
    const base = { codigo: datos.codigo, nombre: 'Antigüedad', clase: c.clase, tipo: c.tipo, parametros: c.parametros, orden: c.orden, destino: c.destino };
    const r = await s.http.put(`/api/sueldos/conceptos/${id}`, { ...base, codigoArca: '810000' });
    expect([r.status, r.body.message]).toEqual([400, 'El código ARCA 810000 no corresponde a un concepto remunerativo']);
    expect((await s.http.put(`/api/sueldos/conceptos/${id}`, { ...base, codigoArca: '12345A' })).status).toBe(400);
    const ok = await s.http.put(`/api/sueldos/conceptos/${id}`, { ...base, codigoArca: '160000' });
    expect([ok.status, ok.body.codigoArca]).toEqual([200, '160000']);
    // Sin código en la modificación, conserva el actual
    const sin = await s.http.put(`/api/sueldos/conceptos/${id}`, base);
    expect(sin.body.codigoArca).toBe('160000');
  });
});
