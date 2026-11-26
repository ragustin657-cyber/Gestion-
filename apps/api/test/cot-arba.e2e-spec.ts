import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { ArbaCotSimulado } from '../src/ventas/remitos/cot/cliente-cot';
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
    const activar = (o: Record<string, unknown> = {}) => e.http.put('/api/ventas/cot/config', { activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: 'secreta', ...o });
    const depositoEn = (provincia: string) => e.http.patch(`/api/depositos/${e.deposito.id}`, { calle: 'Av. Mitre', numero: '100', codigoPostal: '1870', localidad: 'Avellaneda', provincia, plantaArba: 1, puertaArba: 2 });
    const entregaEn = (provincia: string) => e.http.patch(`/api/terceros/${e.clienteRI.id}`, { entregaCalle: 'San Martín', entregaNumero: '50', entregaCodigoPostal: '1900', entregaLocalidad: 'La Plata', entregaProvincia: provincia });
    const articuloArba = async () => {
      const a = await e.articulo(false);
      await e.http.patch(`/api/articulos/${a.id}`, { codigoNomencladorArba: '123456', unidadMedidaArba: '7' });
      return a;
    };
    /** Pedido confirmado de 10 a 1000 con 10 % de bonificación y su remito. */
    const remitoDePedido = async (o: Record<string, unknown> = {}) => {
      const art = await articuloArba();
      const p = await e.pedido([{ ...e.renglon(art.id, 10, 1000), bonificacionPct: 10 } as ReturnType<typeof e.renglon>], { confirmar: true });
      const r = await e.remito([e.dePedido(p.renglones[0].id, 10)], o);
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return { art, remito: r.body as Record<string, any> };
    };
    return { ...e, activar, depositoEn, entregaEn, articuloArba, remitoDePedido };
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

  describe('traslado en el remito', () => {
    it('sin COT activo no hay estado; activo: propone el destino, la salida y el importe sin IVA', async () => {
      const x = await escenario();
      const { remito: r0 } = await x.remitoDePedido();
      expect(r0.cotEstado).toBeNull();
      await x.activar();
      await x.depositoEn('B');
      await x.entregaEn('B');
      const { remito } = await x.remitoDePedido();
      expect(remito).toMatchObject({ cotEstado: 'SIN_PEDIR', trasladoCalle: 'San Martín', trasladoProvincia: 'B', importeDeclarado: '9000' });
      expect(remito.fechaSalida.slice(0, 10)).toBe('2026-11-03');
      expect(remito.horaSalida).toMatch(/^\d{4}$/);
    });

    it('no corresponde fuera de la provincia; editar el destino lo recalcula; sin domicilio se crea igual', async () => {
      const x = await escenario();
      await x.activar();
      await x.depositoEn('C');
      await x.entregaEn('C');
      const { remito } = await x.remitoDePedido();
      expect(remito.cotEstado).toBe('NO_CORRESPONDE');
      const ed = await x.http.put(`/api/ventas/remitos/${remito.id}/traslado`, { calle: 'Calle 7', numero: '1', codigoPostal: '1900', localidad: 'La Plata', provincia: 'B', patente: 'AB123CD' });
      expect([ed.status, ed.body.cotEstado, ed.body.patente]).toEqual([200, 'SIN_PEDIR', 'AB123CD']);
      await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { entregaCalle: null, entregaNumero: null, entregaCodigoPostal: null, entregaLocalidad: null, entregaProvincia: null });
      await x.depositoEn('B');
      const { remito: sin } = await x.remitoDePedido();
      expect([sin.cotEstado, sin.trasladoCalle]).toEqual(['SIN_PEDIR', null]);
      await prisma.remito.update({ where: { id: remito.id }, data: { cotEstado: 'OTORGADO', cot: '1234567890123456' } });
      const otor = await x.http.put(`/api/ventas/remitos/${remito.id}/traslado`, { patente: 'AA111AA' });
      expect([otor.status, otor.body.message]).toEqual([400, 'El remito ya tiene COT otorgado']);
    });

    it('devolución: el origen es el cliente y el destino el depósito', async () => {
      const x = await escenario();
      await x.activar();
      await x.depositoEn('C');
      await x.entregaEn('B');
      const { remito } = await x.remitoDePedido();
      const d = await x.http.post('/api/ventas/remitos/devoluciones', { terceroId: x.clienteRI.id, puntoVentaId: x.puntoVenta.id, fecha: '2026-11-04', renglones: [{ remitoRenglonOrigenId: remito.renglones[0].id, cantidad: 2 }] });
      expect(d.status).toBe(201);
      // Origen en B (cliente) y destino en C (depósito): corresponde
      expect(d.body).toMatchObject({ cotEstado: 'SIN_PEDIR', trasladoProvincia: 'B', importeDeclarado: '1800' });
    });
  });

  describe('pedido del COT', () => {
    afterEach(() => ArbaCotSimulado.limpiar());
    const listo = async (x: Awaited<ReturnType<typeof escenario>>, o: Record<string, unknown> = {}) => {
      await x.activar(o);
      await x.depositoEn('B');
      await x.entregaEn('B');
      return (await x.remitoDePedido({ traslado: { patente: 'AB123CD' } })).remito;
    };

    it('validaciones antes de enviar', async () => {
      const x = await escenario();
      await x.http.put('/api/ventas/cot/config', { activo: true, ambiente: 'SIMULADO' });
      await x.depositoEn('B');
      await x.entregaEn('B');
      const { remito } = await x.remitoDePedido();
      let r = await x.http.post(`/api/ventas/remitos/${remito.id}/cot`, {});
      expect([r.status, r.body.message]).toEqual([400, 'Configure el usuario y la clave CIT de ARBA']);
      await x.activar();
      r = await x.http.post(`/api/ventas/remitos/${remito.id}/cot`, {});
      expect([r.status, r.body.message]).toEqual([400, 'Falta la patente del vehículo']);
      const sinNom = await x.articulo(false);
      const p = await x.pedido([x.renglon(sinNom.id, 1)], { confirmar: true });
      const r2 = (await x.remito([x.dePedido(p.renglones[0].id, 1)], { traslado: { patente: 'AB123CD' } })).body;
      r = await x.http.post(`/api/ventas/remitos/${r2.id}/cot`, {});
      expect([r.status, r.body.message]).toEqual([400, `El artículo ${sinNom.codigo} no tiene código del nomenclador de ARBA`]);
      await x.http.patch(`/api/depositos/${x.deposito.id}`, { plantaArba: null });
      r = await x.http.post(`/api/ventas/remitos/${remito.id}/cot`, {});
      expect([r.status, r.body.message]).toEqual([400, 'El depósito no tiene el domicilio de ARBA completo (planta, puerta y domicilio)']);
    });

    it('otorgado, rechazado, sin conexión y reintento', async () => {
      const x = await escenario();
      const remito = await listo(x);
      const ok = await x.http.post(`/api/ventas/remitos/${remito.id}/cot`, {});
      expect([ok.status, ok.body.cotEstado]).toEqual([201, 'OTORGADO']);
      expect(ok.body.cot).toMatch(/^\d{16}$/);
      expect(ArbaCotSimulado.ultimoArchivo(x.empresaId)?.contenido).toContain('|R000100000001|');
      const otra = (await x.remitoDePedido({ traslado: { patente: 'AB123CD' } })).remito;
      ArbaCotSimulado.forzarFalla(x.empresaId, 'RECHAZO');
      const rech = await x.http.post(`/api/ventas/remitos/${otra.id}/cot`, {});
      expect([rech.status, rech.body.cotEstado]).toEqual([201, 'RECHAZADO']);
      expect(rech.body.cotMensaje).toContain('Rechazo simulado');
      ArbaCotSimulado.forzarFalla(x.empresaId, 'SIN_CONEXION');
      const sc = await x.http.post(`/api/ventas/remitos/${otra.id}/cot`, {});
      expect([sc.status, sc.body.message]).toEqual([502, 'No se pudo conectar con ARBA: el COT quedó pendiente']);
      expect((await prisma.remito.findUniqueOrThrow({ where: { id: otra.id } })).cotEstado).toBe('PENDIENTE');
      ArbaCotSimulado.forzarFalla(x.empresaId, null);
      expect((await x.http.post(`/api/ventas/remitos/${otra.id}/cot`, {})).body.cotEstado).toBe('OTORGADO');
    });

    it('pedir al confirmar; archivo; carga manual; anulación con aviso; PDF', async () => {
      const x = await escenario();
      await x.activar({ pedirAlConfirmar: true });
      await x.depositoEn('B');
      await x.entregaEn('B');
      ArbaCotSimulado.forzarFalla(x.empresaId, 'SIN_CONEXION');
      const { remito } = await x.remitoDePedido({ traslado: { patente: 'AB123CD' } });
      expect(remito.cotEstado).toBe('PENDIENTE');
      ArbaCotSimulado.forzarFalla(x.empresaId, null);
      const { remito: auto } = await x.remitoDePedido({ traslado: { patente: 'AB123CD' } });
      expect(auto.cotEstado).toBe('OTORGADO');
      const arch = await x.http.get(`/api/ventas/remitos/${remito.id}/cot/archivo`);
      expect(arch.status).toBe(200);
      expect(arch.headers['content-type']).toContain('text/plain');
      expect(arch.text.startsWith('01|')).toBe(true);
      expect((await x.http.put(`/api/ventas/remitos/${remito.id}/cot`, { cot: '12' })).status).toBe(400);
      const man = await x.http.put(`/api/ventas/remitos/${remito.id}/cot`, { cot: '1234567890123456' });
      expect([man.status, man.body.cotEstado, man.body.cot]).toEqual([200, 'OTORGADO', '1234567890123456']);
      const pdf = await x.pdfTexto(`/api/ventas/remitos/${remito.id}/pdf`);
      const texto = pdf.texto + [...pdf.texto.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('');
      expect(texto).toContain('1234567890123456');
      const an = await x.http.post(`/api/ventas/remitos/${remito.id}/anular`, { motivo: 'error' });
      expect(an.status).toBe(201);
      expect(an.body.advertencias).toEqual(['Anule también el COT 1234567890123456 en la web de ARBA']);
    });
  });
});
