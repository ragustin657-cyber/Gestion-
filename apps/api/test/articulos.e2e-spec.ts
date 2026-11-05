import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('artículos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const art = { codigo: 'TOR-001', descripcion: 'Tornillo 8mm', unidad: 'UN', alicuotaIva: 21 };

  it('crea artículo con cuenta de compra imputable', async () => {
    const { http, cuenta } = await sesionConPlan(app, prisma);
    const r = await http.post('/api/articulos', { ...art, cuentaCompraId: await cuenta('5.2.01') });
    expect(r.status).toBe(201);
    expect(r.body.alicuotaIva).toBe('21');
  });

  it('alícuota inexistente → 400', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.post('/api/articulos', { ...art, alicuotaIva: 19 });
    expect(r.status).toBe(400);
    expect(r.body.campos.alicuotaIva).toBe('Alícuota de IVA inválida');
  });

  it('cuenta no imputable → 400', async () => {
    const { http, cuenta } = await sesionConPlan(app, prisma);
    const r = await http.post('/api/articulos', { ...art, cuentaCompraId: await cuenta('5.2') });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cuenta contable debe ser imputable');
  });

  it('código duplicado → 409 y búsqueda', async () => {
    const { http } = await sesionConPlan(app, prisma);
    await http.post('/api/articulos', art);
    expect((await http.post('/api/articulos', art)).status).toBe(409);
    const l = await http.get('/api/articulos?q=tornillo');
    expect(l.body.total).toBe(1);
  });
});
