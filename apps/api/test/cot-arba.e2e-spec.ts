import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('COT de ARBA (E57)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const e = await prepararPedidos(app, prisma);
    return e;
  };

  describe('configuración y maestros', () => {
    it('la clave CIT se guarda cifrada y nunca se devuelve', async () => {
      const x = await escenario();
      const r = await x.http.put('/api/ventas/cot/config', { activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: 'secreta', pedirAlConfirmar: false });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', pedirAlConfirmar: false, tieneClave: true });
      expect((await x.http.put('/api/ventas/cot/config', { pedirAlConfirmar: true })).body).toMatchObject({ pedirAlConfirmar: true, tieneClave: true });
      const fila = await prisma.configCot.findFirstOrThrow();
      expect(fila.claveCifrada).toBeTruthy();
      expect(fila.claveCifrada).not.toContain('secreta');
      expect(JSON.stringify((await x.http.get('/api/ventas/cot/config')).body)).not.toContain('secreta');
    });

    it('transportistas, depósito, artículo y cliente con los datos de ARBA', async () => {
      const x = await escenario();
      const t = await x.http.post('/api/transportistas', { cuit: '20-17254359-7', razonSocial: 'Fletes Sur', patentePorDefecto: 'AB123CD' });
      expect([t.status, t.body.razonSocial]).toEqual([201, 'Fletes Sur']);
      const dup = await x.http.post('/api/transportistas', { cuit: '20172543597', razonSocial: 'Otro' });
      expect([dup.status, dup.body.message]).toEqual([409, 'Ya existe un transportista con ese CUIT']);
      expect((await x.http.post('/api/transportistas', { cuit: '20-11111111-1', razonSocial: 'X' })).status).toBe(400);
      expect(((await x.http.get('/api/transportistas')).body as unknown[]).length).toBe(1);
      const dep = await x.http.patch(`/api/depositos/${x.deposito.id}`, { calle: 'Av. Mitre', numero: '100', codigoPostal: '1870', localidad: 'Avellaneda', provincia: 'B', plantaArba: 1, puertaArba: 2 });
      expect(dep.status).toBe(200);
      expect(dep.body).toMatchObject({ provincia: 'B', plantaArba: 1, puertaArba: 2 });
      expect((await x.http.patch(`/api/depositos/${x.deposito.id}`, { provincia: 'O' })).status).toBe(400);
      const art = await x.articulo();
      const a = await x.http.patch(`/api/articulos/${art.id}`, { codigoNomencladorArba: '123456', unidadMedidaArba: '7' });
      expect(a.body).toMatchObject({ codigoNomencladorArba: '123456', unidadMedidaArba: '7' });
      expect((await x.http.patch(`/api/articulos/${art.id}`, { codigoNomencladorArba: '12AB' })).status).toBe(400);
      const c = await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { entregaCalle: 'San Martín', entregaNumero: '50', entregaCodigoPostal: '1900', entregaLocalidad: 'La Plata', entregaProvincia: 'B' });
      expect([c.status, c.body.entregaProvincia]).toEqual([200, 'B']);
    });
  });
});
