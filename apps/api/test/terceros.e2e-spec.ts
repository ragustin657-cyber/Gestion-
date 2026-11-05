import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('terceros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const proveedor = {
    razonSocial: 'Ferretería del Sur SRL',
    cuit: '20-12345678-6',
    condicionIva: 'RESPONSABLE_INSCRIPTO',
    esProveedor: true,
    esCliente: false,
  };
  const editor = () => sesion(app, prisma, { permisos: ['tercero.ver', 'tercero.editar'] });

  it('crea proveedor con CUIT normalizado y código 1', async () => {
    const { http } = await editor();
    const r = await http.post('/api/terceros', proveedor);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ cuit: '20123456786', codigo: 1, esProveedor: true });
    expect((await http.post('/api/terceros', { ...proveedor, cuit: '30-71234567-1' })).body.codigo).toBe(2);
  });

  it('CUIT inválido → 400', async () => {
    const { http } = await editor();
    const r = await http.post('/api/terceros', { ...proveedor, cuit: '20-12345678-5' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('CUIT inválido');
  });

  it('debe ser proveedor o cliente', async () => {
    const { http } = await editor();
    const r = await http.post('/api/terceros', { ...proveedor, esProveedor: false, esCliente: false });
    expect(r.status).toBe(400);
  });

  it('CUIT duplicado en la misma empresa → 409; en otra empresa se permite', async () => {
    const a = await editor();
    await a.http.post('/api/terceros', proveedor);
    const r = await a.http.post('/api/terceros', proveedor);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Ya existe un proveedor o cliente con ese CUIT');
    const b = await editor();
    expect((await b.http.post('/api/terceros', proveedor)).status).toBe(201);
  });

  it('filtra por tipo y busca por CUIT parcial o razón social', async () => {
    const { http } = await editor();
    await http.post('/api/terceros', proveedor);
    await http.post('/api/terceros', {
      ...proveedor, razonSocial: 'Cliente Uno SA', cuit: '30-71234567-1', esProveedor: false, esCliente: true,
    });
    const provs = await http.get('/api/terceros?tipo=proveedor');
    expect(provs.body.total).toBe(1);
    expect(provs.body.items[0].razonSocial).toBe('Ferretería del Sur SRL');
    expect((await http.get('/api/terceros?q=7123456')).body.items[0].razonSocial).toBe('Cliente Uno SA');
    expect((await http.get('/api/terceros?q=FERRETER')).body.total).toBe(1);
  });

  it('GET y PATCH de un tercero de otra empresa → 404', async () => {
    const a = await editor();
    const t = (await a.http.post('/api/terceros', proveedor)).body;
    const b = await editor();
    expect((await b.http.get(`/api/terceros/${t.id}`)).status).toBe(404);
    expect((await b.http.patch(`/api/terceros/${t.id}`, { razonSocial: 'Hack' })).status).toBe(404);
    expect((await a.http.get(`/api/terceros/${t.id}`)).body.razonSocial).toBe('Ferretería del Sur SRL');
  });

  it('PUT iibb reemplaza la lista y audita', async () => {
    const { http } = await editor();
    const t = (await http.post('/api/terceros', proveedor)).body;
    await http.put(`/api/terceros/${t.id}/iibb`, [
      { jurisdiccion: '901', alicuotaPercepcion: 1.5, alicuotaRetencion: 1.75, exento: false },
      { jurisdiccion: '902', alicuotaPercepcion: 3, alicuotaRetencion: 2.5, exento: false },
    ]);
    const r = await http.put(`/api/terceros/${t.id}/iibb`, [
      { jurisdiccion: '902', alicuotaPercepcion: 2, alicuotaRetencion: 2, exento: false },
    ]);
    expect(r.status).toBe(200);
    const det = await http.get(`/api/terceros/${t.id}`);
    expect(det.body.iibb).toHaveLength(1);
    expect(det.body.iibb[0]).toMatchObject({ jurisdiccion: '902', alicuotaPercepcion: '2' });
    const aud = await prisma.auditoria.findMany({ where: { entidad: 'Tercero', entidadId: t.id, accion: 'MODIFICAR' } });
    expect(aud.length).toBeGreaterThanOrEqual(2);
  });

  it('solo lectura no puede crear', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['tercero.ver'] });
    expect((await http.post('/api/terceros', proveedor)).status).toBe(403);
  });
});
