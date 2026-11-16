import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAMPOS_F931 } from '../src/sueldos/f931-diseno';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

/** Valor del campo n de una línea del F.931. */
function campo(linea: string, n: number): string {
  let pos = 0;
  for (const c of CAMPOS_F931) { if (c.numero === n) return linea.slice(pos, pos + c.largo); pos += c.largo; }
  throw new Error(`campo ${n}`);
}

describe('sueldos: F.931', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (d: Record<string, unknown> = { codigoObraSocial: '125000' }) => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const e = await s.empleado(d);
    const crear = async (tipo: string, anio: number, mes: number) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-28` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const cerrar = async (id: string) => { const r = await s.http.post(`/api/sueldos/liquidaciones/${id}/cerrar`); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); };
    const f931 = (anio: number, mes: number) => s.http.get(`/api/sueldos/f931?anio=${anio}&mes=${mes}`).buffer(true)
      .parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const lineas = (b: Buffer) => b.toString('latin1').split('\r\n').filter((x) => x);
    return { ...s, e, crear, cerrar, f931, lineas };
  };

  it('archivo del ejemplo', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    await x.cerrar(l.id);
    const r = await x.f931(2026, 11);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('F931-202611.txt');
    const ls = x.lineas(r.body as Buffer);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toHaveLength(499);
    expect(campo(ls[0], 1)).toBe('20172543597');
    expect(campo(ls[0], 11)).toBe('125000');
    expect(campo(ls[0], 13)).toBe('  1168965,00');
    expect(campo(ls[0], 41)).toBe('    30,00');
    expect(campo(ls[0], 50)).toBe('004');
    expect(campo(ls[0], 58)).toBe('     7003,68');
    expect(campo(ls[0], 60)).toBe('  1161961,32');
  });

  it('nombre con tildes y obra social faltante', async () => {
    const x = await escenario({ apellido: 'Muñoz Peña', nombre: 'José', codigoObraSocial: '000000' });
    const l = await x.crear('MENSUAL', 2026, 11);
    expect((await x.http.get(`/api/sueldos/liquidaciones/${l.id}`)).body.aviso).toContain('Falta el código de obra social de 1');
    await x.cerrar(l.id);
    const ls = x.lineas((await x.f931(2026, 11)).body as Buffer);
    expect(ls[0]).toHaveLength(499);
    expect(campo(ls[0], 2).startsWith('MUNOZ PENA JOSE')).toBe(true);
    expect(campo(ls[0], 11)).toBe('000000');
  });

  it('mensual y SAC de diciembre', async () => {
    const x = await escenario();
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    await x.http.put('/api/sueldos/parametros', { anio: 2026, mes: 12, baseMaximaAportes: 1000000, detraccion: 7003.68 });
    await x.cerrar((await x.crear('MENSUAL', 2026, 12)).id);
    await x.cerrar((await x.crear('SAC', 2026, 12)).id);
    const ls = x.lineas((await x.f931(2026, 12)).body as Buffer);
    expect(ls).toHaveLength(1);
    expect(campo(ls[0], 14)).toBe('  1500000,00');
    expect(campo(ls[0], 37)).toBe('   568732,50');
    expect(campo(ls[0], 13)).toBe('  1706197,50');
  });

  it('SAC cerrado sin mensual', async () => {
    const x = await escenario();
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    await x.cerrar((await x.crear('SAC', 2026, 12)).id);
    const r = await x.f931(2026, 12);
    expect([r.status, JSON.parse((r.body as Buffer).toString()).message]).toEqual([400, 'La liquidación mensual de 12/2026 no está cerrada']);
  });

  it('sin liquidaciones', async () => {
    const x = await escenario();
    const r = await x.f931(2026, 10);
    expect([r.status, JSON.parse((r.body as Buffer).toString()).message]).toEqual([400, 'No hay liquidaciones cerradas de 10/2026']);
  });
});
