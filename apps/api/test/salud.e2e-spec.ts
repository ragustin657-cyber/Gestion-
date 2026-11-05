import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp } from './helpers';

describe('salud', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await crearApp()));
  afterAll(async () => app.close());

  it('GET /api/salud responde ok', async () => {
    const r = await request(app.getHttpServer()).get('/api/salud');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
