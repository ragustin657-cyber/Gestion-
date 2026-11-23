import { INestApplication } from '@nestjs/common';
import { ArcaSimuladoFce } from '../src/arca/arca-simulado-fce';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

const CBU = '2850590940090418135201';
type Fila = { id: string; estado: string; cbteTipo: number; numero: number; fechaLimite: string | null; diasRestantes: number | null; motivosRechazo: string[]; comprobanteVentaId: string | null; cliente: string | null; notas: { id: string; tipo: string }[] };

describe('factura de crédito MiPyME: emitidas (E50)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => { ArcaSimuladoFce.limpiar(); await app.close(); });

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const banco = (await v.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await v.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await v.cuenta('1.1.01.002'), cbu: CBU })).body as { id: string };
    await v.http.put('/api/arca/config', { mipyme: true, cuentaBancariaFceId: cuenta.id });
    ArcaSimuladoFce.obligar(v.empresaId, '20172543597', '1.00');
    const emitir = async (d: Record<string, unknown> = {}) => {
      const r = await v.http.post('/api/ventas/comprobantes', { ...v.datos({ fce: true, ...d }), emitir: true });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string; numero: number };
    };
    const lista = async (q = '') => { const r = await v.http.get(`/api/ventas/fce${q}`); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body as { filas: Fila[]; aviso: string | null }; };
    return { ...v, emitir, lista };
  };

  it('actualizar desde ARCA: pendiente emparejada, plazo de 30 días, notas debajo', async () => {
    const x = await escenario();
    const f = await x.emitir();
    const nd = await x.emitir({ tipo: 'NOTA_DEBITO', comprobanteAsociadoId: f.id });
    const r = await x.http.post('/api/ventas/fce/actualizar');
    expect([r.status, r.body.actualizadas]).toEqual([201, 1]);
    const { filas } = await x.lista();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ estado: 'PENDIENTE', cbteTipo: 201, numero: 1, fechaLimite: '2026-12-02', diasRestantes: 26, comprobanteVentaId: f.id, cliente: 'Distribuidora Norte SA' });
    expect(filas[0].notas.map((n) => n.id)).toEqual([nd.id]);
  });

  it('rechazada: estado y motivos; la nota de anulación sale; sobre aceptada no', async () => {
    const x = await escenario();
    const f = await x.emitir();
    const cuit = (await prisma.empresa.findUniqueOrThrow({ where: { id: x.empresaId } })).cuit.replace(/\D/g, '');
    ArcaSimuladoFce.fijarEstado(x.empresaId, { cuitEmisor: cuit, cbteTipo: 201, ptoVta: 1, numero: 1 }, 'RECHAZADA', ['Mercadería dañada']);
    await x.http.post('/api/ventas/fce/actualizar');
    expect((await x.lista('?estado=RECHAZADA')).filas.map((y) => [y.estado, y.motivosRechazo])).toEqual([['RECHAZADA', ['Mercadería dañada']]]);
    expect((await x.lista('?estado=PENDIENTE')).filas).toHaveLength(0);
    const nc = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ fce: true, tipo: 'NOTA_CREDITO', anulacionFce: true, comprobanteAsociadoId: f.id }), emitir: true });
    expect([nc.status, nc.body.estado]).toEqual([201, 'AUTORIZADO']);
    const g = await x.emitir();
    ArcaSimuladoFce.fijarEstado(x.empresaId, { cuitEmisor: cuit, cbteTipo: 201, ptoVta: 1, numero: g.numero }, 'ACEPTADA');
    await x.http.post('/api/ventas/fce/actualizar');
    const mal = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ fce: true, tipo: 'NOTA_CREDITO', anulacionFce: true, comprobanteAsociadoId: g.id }), emitir: true });
    expect([mal.status, mal.body.message]).toEqual([400, 'La factura de crédito está aceptada: no se puede anular']);
    // Una nota sin anulación sí
    const ok = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ fce: true, tipo: 'NOTA_CREDITO', anulacionFce: false, comprobanteAsociadoId: g.id, renglones: [{ descripcion: 'Bonificación', cantidad: 1, precioUnitario: 100, alicuota: 21 }] }), emitir: true });
    expect([ok.status, ok.body.message]).toEqual([201, undefined]);
  });

  it('sin conexión: el botón da error; el listado devuelve lo guardado con aviso; no reconsulta si es reciente', async () => {
    const x = await escenario();
    await x.emitir();
    await x.http.post('/api/ventas/fce/actualizar');
    ArcaSimuladoFce.forzarSinConexion(x.empresaId, true);
    const r = await x.http.post('/api/ventas/fce/actualizar');
    expect([r.status, r.body.message]).toEqual([400, 'No se pudo consultar ARCA: tiempo de espera agotado (simulado)']);
    // Consulta reciente: el listado no vuelve a consultar (no hay aviso de conexión)
    expect((await x.lista()).aviso).toBeNull();
    await prisma.fceRegistro.updateMany({ data: { consultadoEn: new Date('2026-11-06T10:00:00Z') } });
    const l = await x.lista();
    expect([l.filas.length, l.aviso]).toEqual([1, 'No se pudo consultar ARCA: tiempo de espera agotado (simulado)']);
  });

  it('otro ambiente: las filas no se mezclan; permisos', async () => {
    const x = await escenario();
    await x.emitir();
    await x.http.post('/api/ventas/fce/actualizar');
    await prisma.fceRegistro.updateMany({ data: { ambiente: 'HOMOLOGACION' } });
    expect((await x.lista()).filas).toHaveLength(1);
    expect(await prisma.fceRegistro.count({ where: { ambiente: 'SIMULADO' } })).toBe(1);
  });
});
