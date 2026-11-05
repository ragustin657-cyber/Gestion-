import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('centros de costo y depósitos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('ABM de centros de costo', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['organizacion.editar'] });
    const r = await http.post('/api/centros-costo', { codigo: 'ADM', nombre: 'Administración' });
    expect(r.status).toBe(201);
    expect((await http.post('/api/centros-costo', { codigo: 'ADM', nombre: 'Otro' })).status).toBe(409);
    const m = await http.patch(`/api/centros-costo/${r.body.id}`, { activo: false });
    expect(m.body.activo).toBe(false);
    expect((await http.get('/api/centros-costo')).body).toHaveLength(1);
  });

  it('ABM de depósitos', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['organizacion.editar'] });
    const r = await http.post('/api/depositos', { codigo: 'CEN', nombre: 'Depósito central', direccion: 'Ruta 8 km 50' });
    expect(r.status).toBe(201);
    expect((await http.get('/api/depositos')).body[0].direccion).toBe('Ruta 8 km 50');
  });
});
