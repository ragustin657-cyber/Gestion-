import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
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

describe('LSD: archivo de conceptos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const archivo = async (s: Awaited<ReturnType<typeof prepararSueldos>>) => {
    const r = await s.http.get('/api/sueldos/lsd/conceptos').buffer(true)
      .parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    return { r, lineas: r.status === 200 ? (r.body as Buffer).toString('latin1').split('\r\n').filter((x) => x) : [] };
  };

  it('archivo de conceptos', async () => {
    const s = await prepararSueldos(app, prisma);
    const { r, lineas } = await archivo(s);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('LSD-conceptos.txt');
    expect(lineas.every((l) => l.length === 195)).toBe(true);
    const de = (codigo: string) => lineas.find((l) => l.slice(6, 16).trim() === codigo)!;
    expect(de('100').startsWith('110000100       Sueldo básico')).toBe(true);
    expect(de('100').slice(166, 167)).toBe('0');
    expect(de('100').slice(167, 186)).toBe('1111111100 1 1 10 0');
    expect(de('500').slice(167, 186)).toBe('0000000000 0 0 00 0');
    expect(de('201').slice(0, 6)).toBe('120003');
    expect(de('300').slice(0, 6)).toBe('520014');
    expect(de('100').slice(186)).toBe(' '.repeat(9));
  });

  it('incluye conceptos inactivos', async () => {
    const s = await prepararSueldos(app, prisma);
    await prisma.concepto.updateMany({ where: { empresaId: s.empresaId, codigo: '120' }, data: { activo: false } });
    const { lineas } = await archivo(s);
    expect(lineas.some((l) => l.slice(6, 16).trim() === '120')).toBe(true);
  });

  it('permisos', async () => {
    const s = await prepararSueldos(app, prisma);
    const u = await otroUsuario(app, prisma, s.empresaId, ['venta.ver']);
    expect((await u.http.get('/api/sueldos/lsd/conceptos')).status).toBe(403);
  });
});
