import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('índices de inflación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const importar = (token: string, texto: string) =>
    request(app.getHttpServer()).post('/api/indices-inflacion/importar').set('Authorization', `Bearer ${token}`).attach('archivo', Buffer.from(texto), 'indices.csv');

  it('solo el superadmin carga índices', async () => {
    const s = await sesion(app, prisma, { permisos: ['contabilidad.cerrar'] });
    expect((await s.http.put('/api/indices-inflacion/2025/12', { valor: 80 })).status).toBe(403);
    expect((await importar(s.token, '2025-12;80')).status).toBe(403);
    expect((await s.http.delete('/api/indices-inflacion/2025/12')).status).toBe(403);
    expect((await s.http.get('/api/indices-inflacion')).status).toBe(200);
  });

  it('importa, actualiza, lista y borra', async () => {
    const s = await sesion(app, prisma, { superadmin: true });
    expect((await s.http.put('/api/indices-inflacion/2025/12', { valor: 80 })).status).toBe(200);
    expect((await s.http.put('/api/indices-inflacion/2025/13', { valor: 80 })).status).toBe(400);
    expect((await s.http.put('/api/indices-inflacion/2025/11', { valor: 0 })).status).toBe(400);
    const r = await importar(s.token, '2025-12;81\n2026-01;100');
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ creados: 1, actualizados: 1 });
    const lista = () => s.http.get('/api/indices-inflacion').then((x) => x.body.map((i: { anio: number; mes: number; valor: string }) => ({ anio: i.anio, mes: i.mes, valor: i.valor })));
    expect(await lista()).toEqual([{ anio: 2026, mes: 1, valor: '100' }, { anio: 2025, mes: 12, valor: '81' }]);
    const mala = await importar(s.token, '2026-02;110\n2026-03;0');
    expect(mala.status).toBe(400);
    expect(mala.body.message).toBe('Línea 2: valor inválido');
    expect(await lista()).toHaveLength(2);
    expect((await s.http.delete('/api/indices-inflacion/2025/12')).status).toBe(200);
    expect(await lista()).toEqual([{ anio: 2026, mes: 1, valor: '100' }]);
    expect((await importar(s.token, '')).body.message).toBe('El archivo no tiene índices');
  });
});
