import { INestApplication } from '@nestjs/common';
import { ArcaSimuladoFce } from '../src/arca/arca-simulado-fce';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

const CBU = '2850590940090418135201';
const MSG = 'El cliente está obligado a recibir factura de crédito MiPyME desde $ 1.000.000,00: emita una factura de crédito';

describe('factura de crédito MiPyME: obligación del cliente (E50)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => { ArcaSimuladoFce.limpiar(); await app.close(); });

  const escenario = async (o: { mipyme?: boolean; obligado?: boolean } = {}) => {
    const v = await prepararVentas(app, prisma);
    const banco = (await v.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await v.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await v.cuenta('1.1.01.002'), cbu: CBU })).body as { id: string };
    await v.http.put('/api/arca/config', { mipyme: o.mipyme ?? true, cuentaBancariaFceId: cuenta.id });
    if (o.obligado ?? true) ArcaSimuladoFce.obligar(v.empresaId, '20172543597', '1000000.00');
    const emitir = (precio: number, d: Record<string, unknown> = {}) => v.http.post('/api/ventas/comprobantes', { ...v.datos({ renglones: [{ descripcion: 'Producto', cantidad: 1, precioUnitario: precio, alicuota: 21 }], ...d }), emitir: true });
    const consulta = (total?: number, terceroId = v.clienteRI.id) => v.http.get(`/api/ventas/fce/obligacion?terceroId=${terceroId}&fecha=2026-11-02${total ? `&total=${total}` : ''}`);
    return { ...v, emitir, consulta };
  };

  it('obligado: la factura común desde el mínimo da error; por debajo se emite; FCE voluntaria', async () => {
    const x = await escenario();
    let r = await x.emitir(2000000);
    expect([r.status, r.body.message]).toEqual([400, MSG]);
    r = await x.emitir(500000);
    expect([r.status, r.body.estado]).toEqual([201, 'AUTORIZADO']);
    r = await x.emitir(500000, { fce: true });
    expect([r.status, r.body.estado]).toEqual([201, 'AUTORIZADO']);
    r = await x.emitir(2000000, { fce: true });
    expect([r.status, r.body.estado]).toEqual([201, 'AUTORIZADO']);
    // Una sola consulta por día
    expect(ArcaSimuladoFce.consultasObligacion(x.empresaId)).toBe(1);
    const c = await x.consulta(2000000);
    expect(c.body).toMatchObject({ obligado: true, montoMinimo: '1000000.00', corresponde: true, aviso: null });
    expect((await x.consulta(100)).body.corresponde).toBe(false);
  });

  it('no obligado: FCE da error; la común sale', async () => {
    const x = await escenario({ obligado: false });
    const r = await x.emitir(2000000, { fce: true });
    expect([r.status, r.body.message]).toEqual([400, 'El cliente no está obligado a recibir factura de crédito MiPyME']);
    expect((await x.emitir(2000000)).status).toBe(201);
  });

  it('en dólares se compara el total en pesos', async () => {
    const x = await escenario();
    const r = await x.emitir(1000, { monedaCodigo: 'USD', cotizacion: 1500 });
    expect([r.status, r.body.message]).toEqual([400, MSG]);
  });

  it('sin conexión: la consulta guardada del mismo ambiente o la marca manual', async () => {
    const x = await escenario();
    expect((await x.consulta()).body.obligado).toBe(true);
    // La consulta es de ayer
    await prisma.tercero.update({ where: { id: x.clienteRI.id }, data: { fceConsultadoEn: new Date('2026-11-05T15:00:00Z') } });
    ArcaSimuladoFce.forzarSinConexion(x.empresaId, true);
    let c = await x.consulta(2000000);
    expect(c.body).toMatchObject({ obligado: true, corresponde: true, aviso: 'No se pudo consultar ARCA: se usa la consulta del 05/11/2026' });
    expect((await x.emitir(2000000)).body.message).toBe(MSG);
    // Consulta de otro ambiente: no sirve; se usa la marca manual
    await prisma.tercero.update({ where: { id: x.clienteRI.id }, data: { fceConsultadoAmbiente: 'HOMOLOGACION' } });
    c = await x.consulta(2000000);
    expect(c.body).toMatchObject({ obligado: false, corresponde: false, aviso: 'No se pudo consultar ARCA: se usa la marca manual del cliente' });
    expect((await x.emitir(2000000)).status).toBe(201);
    await prisma.tercero.update({ where: { id: x.clienteRI.id }, data: { fceObligadoManual: true } });
    c = await x.consulta(2000000);
    expect(c.body).toMatchObject({ obligado: true, corresponde: true });
  });

  it('empresa no MiPyME y consumidor final: no se consulta', async () => {
    const x = await escenario({ mipyme: false });
    expect((await x.emitir(2000000)).status).toBe(201);
    expect(ArcaSimuladoFce.consultasObligacion(x.empresaId)).toBe(0);
    const y = await escenario();
    expect((await y.consulta(2000000, y.clienteCF.id)).body).toMatchObject({ obligado: false, corresponde: false });
    expect(ArcaSimuladoFce.consultasObligacion(y.empresaId)).toBe(0);
  });

  it('la ficha del cliente guarda la marca manual', async () => {
    const x = await escenario();
    const r = await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { fceObligadoManual: true });
    expect(r.status).toBe(200);
    expect((await prisma.tercero.findUniqueOrThrow({ where: { id: x.clienteRI.id } })).fceObligadoManual).toBe(true);
  });
});
