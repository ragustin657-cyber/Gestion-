import { INestApplication } from '@nestjs/common';
import { PERMISOS } from '@gestion/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('ventas completas: maestros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('el cliente tiene lista de precios', async () => {
    const v = await prepararVentas(app, prisma);
    const lista = await prisma.listaPrecios.create({ data: { empresaId: v.empresaId, nombre: 'Minorista', monedaCodigo: 'ARS', porDefecto: true } });
    expect((await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { listaPreciosId: lista.id })).status).toBe(200);
    expect((await v.http.get(`/api/terceros/${v.clienteRI.id}`)).body.listaPreciosId).toBe(lista.id);
    const mal = await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { listaPreciosId: '00000000-0000-4000-8000-000000000000' });
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('Lista de precios inexistente');
    expect((await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { listaPreciosId: null })).status).toBe(200);
  });

  it('permisos nuevos existen', async () => {
    const v = await prepararVentas(app, prisma);
    expect(PERMISOS['pedido.gestionar']).toBe('Gestionar pedidos y remitos de venta');
    expect(PERMISOS['precios.editar']).toBe('Editar listas de precios');
    const u = await otroUsuario(app, prisma, v.empresaId, ['pedido.gestionar', 'precios.editar']);
    expect((await u.http.get('/api/empresas/actual/puntos-venta')).status).toBe(403);
  });
});
