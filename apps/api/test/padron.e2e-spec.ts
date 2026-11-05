import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PadronService } from '../src/pagos/padron/padron.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

const FIX = `${__dirname}/fixtures`;

describe('padrones de IIBB', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const subir = (token: string, archivo: string, jurisdiccion = '902') =>
    request(app.getHttpServer()).post('/api/padrones').set('Authorization', `Bearer ${token}`).field('jurisdiccion', jurisdiccion).attach('archivo', `${FIX}/${archivo}`);

  async function esperar(http: { get: (u: string) => Promise<{ body: { estado: string } }> }, id: string) {
    for (let i = 0; i < 50; i++) {
      const r = await http.get(`/api/padrones/${id}`);
      if (r.body.estado !== 'PROCESANDO') return r.body;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('la carga no terminó');
  }

  it('carga ARBA, consulta alícuota vigente y recarga sin duplicar', async () => {
    const { token, http } = await sesion(app, prisma, { superadmin: true });
    const r = await subir(token, 'padron-arba.txt');
    expect(r.status).toBe(202);
    expect(await esperar(http, r.body.id)).toMatchObject({ estado: 'COMPLETA', filas: 5, periodo: '2026-11' });
    const padron = app.get(PadronService);
    expect(await padron.alicuotaRetencion('902', '30700123452', new Date('2026-11-15T00:00:00Z'))).toBe('1.75');
    expect(await padron.alicuotaRetencion('902', '30700123452', new Date('2026-12-01T00:00:00Z'))).toBeNull();
    const fila = await prisma.padronIibb.findFirstOrThrow({ where: { cuit: '30700123452' } });
    expect(fila.alicuotaPercepcion?.toString()).toBe('2');
    const r2 = await subir(token, 'padron-arba.txt');
    await esperar(http, r2.body.id);
    expect(await prisma.padronIibb.count({ where: { jurisdiccion: '902' } })).toBe(5);
  });

  it('carga AGIP', async () => {
    const { token, http } = await sesion(app, prisma, { superadmin: true });
    const r = await subir(token, 'padron-agip.txt', '901');
    expect(await esperar(http, r.body.id)).toMatchObject({ estado: 'COMPLETA', filas: 5 });
    expect(await app.get(PadronService).alicuotaRetencion('901', '30711223343', new Date('2026-11-10T00:00:00Z'))).toBe('1.5');
  });

  it('archivo con línea inválida queda en ERROR y conserva el padrón anterior', async () => {
    const { token, http } = await sesion(app, prisma, { superadmin: true });
    await esperar(http, (await subir(token, 'padron-arba.txt')).body.id);
    const r = await subir(token, 'padron-arba-malo.txt');
    const c = await esperar(http, r.body.id);
    expect(c.estado).toBe('ERROR');
    expect((c as unknown as { error: string }).error).toContain('Línea 2 inválida');
    expect(await prisma.padronIibb.count({ where: { jurisdiccion: '902' } })).toBe(5);
    expect((await http.get('/api/padrones')).body).toHaveLength(2);
  });

  it('sin permiso → 403; jurisdicción no soportada → 400', async () => {
    const s = await sesion(app, prisma, { permisos: ['op.ver'] });
    expect((await subir(s.token, 'padron-arba.txt')).status).toBe(403);
    const ok = await sesion(app, prisma, { superadmin: true });
    expect((await subir(ok.token, 'padron-arba.txt', '904')).status).toBe(400);
  });
});
