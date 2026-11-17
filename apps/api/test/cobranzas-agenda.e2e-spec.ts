import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Fila { terceroId: string; cliente: string; vencido: string; porVencer: string; aFavor: string; dias: number; proximaAccion: string | null; accionAtrasada: boolean; promesa: { fecha: string; importe: string; estado: string } | null }

describe('cobranzas: agenda y ficha', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const vencida = (o: Record<string, unknown> = {}) => v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-31', ...o });
    const gestion = async (terceroId: string, d: Record<string, unknown>) => {
      const r = await v.http.post(`/api/ventas/cobranzas/${terceroId}/gestiones`, { medio: 'LLAMADO', nota: 'Llamé', ...d });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const agenda = async (q = '') => (await v.http.get(`/api/ventas/cobranzas${q}`)).body.clientes as Fila[];
    const cliente = async (razonSocial: string, cuit: string) => (await v.http.post('/api/terceros', { esCliente: true, razonSocial, cuit, condicionIva: 'RESPONSABLE_INSCRIPTO', telefono: '4444-0000' })).body as { id: string };
    const recibo = async (fc: { id: string }, importe: number, o: Record<string, unknown> = {}) => {
      const r = await v.http.post('/api/ventas/recibos', {
        terceroId: v.clienteRI.id, fecha: '2026-11-06', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe }, cheques: [], transferencias: [], retenciones: [], aplicaciones: [{ comprobanteId: fc.id, importe }], ...o,
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    return { ...v, vencida, gestion, agenda, cliente, recibo };
  };

  it('agenda: vencido, por vencer y días', async () => {
    const x = await escenario();
    await x.vencida();
    await x.factura({ fecha: '2026-11-02', fechaVencimiento: '2026-12-01' });
    const [f] = await x.agenda();
    expect([f.cliente, f.vencido, f.porVencer, f.aFavor, f.dias]).toEqual(['Distribuidora Norte SA', '1210.00', '1210.00', '0.00', 6]);
  });

  it('NC parcial', async () => {
    const x = await escenario();
    const fc = await x.vencida();
    const nc = await x.http.post('/api/ventas/comprobantes', x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, renglones: [{ descripcion: 'Bonif', cantidad: 1, precioUnitario: 500, alicuota: 21 }], emitir: true }));
    expect(nc.status).toBe(201);
    expect((await x.agenda())[0].vencido).toBe('605.00');
  });

  it('a favor o por vencer no aparece', async () => {
    const x = await escenario();
    await x.cobro(500, '2026-11-03');
    const otro = await x.cliente('Por Vencer SA', '30-71234567-1');
    await x.factura({ terceroId: otro.id, fecha: '2026-11-02', fechaVencimiento: '2026-12-01' });
    expect(await x.agenda()).toEqual([]);
    await x.vencida();
    const [f] = await x.agenda();
    expect([f.cliente, f.vencido, f.aFavor]).toEqual(['Distribuidora Norte SA', '1210.00', '-500.00']);
  });

  it('factura en dólares', async () => {
    const x = await escenario();
    await x.vencida({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
    expect((await x.agenda())[0].vencido).toBe('100000.00');
  });

  it('orden y filtros', async () => {
    const x = await escenario();
    const b = await x.cliente('Beta SA', '30-71234567-1');
    const c = await x.cliente('Gamma SA', '30-70123456-8');
    await x.vencida();
    await x.vencida({ terceroId: b.id });
    await x.vencida({ terceroId: c.id, fecha: '2026-09-01', fechaVencimiento: '2026-09-30' });
    await x.gestion(x.clienteRI.id, { fecha: '2026-11-04', proximaAccion: '2026-11-05' });
    await x.gestion(b.id, { fecha: '2026-11-04', promesaFecha: '2026-11-05', promesaImporte: 1210 });
    const todos = await x.agenda();
    expect(todos.map((f) => f.cliente)).toEqual(['Distribuidora Norte SA', 'Beta SA', 'Gamma SA']);
    expect([todos[0].accionAtrasada, todos[1].promesa?.estado, todos[2].dias]).toEqual([true, 'INCUMPLIDA', 37]);
    expect((await x.agenda('?soloHoy=true')).map((f) => f.cliente)).toEqual(['Distribuidora Norte SA']);
    expect((await x.agenda('?incumplidas=true')).map((f) => f.cliente)).toEqual(['Beta SA']);
    expect((await x.agenda('?minDias=30')).map((f) => f.cliente)).toEqual(['Gamma SA']);
    expect((await x.agenda('?q=gam')).map((f) => f.cliente)).toEqual(['Gamma SA']);
  });

  it('promesa cumplida con un recibo', async () => {
    const x = await escenario();
    const fc = await x.vencida();
    await x.gestion(x.clienteRI.id, { promesaFecha: '2026-11-10', promesaImporte: 1210 });
    const otra = await x.vencida();
    await x.recibo(fc, 1210);
    expect(otra.id).toBeTruthy();
    expect((await x.agenda())[0].promesa).toEqual({ fecha: '2026-11-10', importe: '1210.00', estado: 'CUMPLIDA' });
  });

  it('cheque rechazado', async () => {
    const x = await escenario();
    const fc = await x.vencida();
    await x.vencida();
    await x.gestion(x.clienteRI.id, { promesaFecha: '2026-11-10', promesaImporte: 1210 });
    const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002') })).body as { id: string };
    const cheque = { tipo: 'FISICO', banco: 'Galicia', numero: '88001', libradorNombre: 'Librador SA', libradorCuit: '30500010912', fechaEmision: '2026-11-01', fechaPago: '2026-11-05', importe: 1210 };
    await x.recibo(fc, 1210, { efectivo: null, cheques: [cheque] });
    expect((await x.agenda())[0].promesa?.estado).toBe('CUMPLIDA');
    const ch = await prisma.chequeTercero.findFirstOrThrow({ where: { empresaId: x.empresaId, numero: '88001' } });
    expect((await x.http.post('/api/tesoreria/depositos', { fecha: '2026-11-06', cajaId: x.caja.id, cuentaBancariaId: cuenta.id, cheques: [ch.id] })).status).toBe(201);
    expect((await x.http.post(`/api/tesoreria/cheques/${ch.id}/rechazar`, { fecha: '2026-11-06', motivo: 'Sin fondos' })).status).toBe(200);
    expect((await x.agenda())[0].promesa?.estado).toBe('PENDIENTE');
  });

  it('promesa reemplazada', async () => {
    const x = await escenario();
    const fc = await x.vencida();
    await x.vencida();
    await x.gestion(x.clienteRI.id, { fecha: '2026-11-04', promesaFecha: '2026-11-05', promesaImporte: 500 });
    await x.recibo(fc, 500, { fecha: '2026-11-05' });
    await x.gestion(x.clienteRI.id, { fecha: '2026-11-06', promesaFecha: '2026-11-20', promesaImporte: 700 });
    const ficha = (await x.http.get(`/api/ventas/cobranzas/${x.clienteRI.id}`)).body as { gestiones: { promesaImporte: string; promesaEstado: string }[] };
    expect(ficha.gestiones.map((g) => [g.promesaImporte, g.promesaEstado])).toEqual([['700.00', 'PENDIENTE'], ['500.00', 'CUMPLIDA']]);
    expect((await x.agenda())[0].promesa?.importe).toBe('700.00');
  });

  it('ficha', async () => {
    const x = await escenario();
    const otro = await x.cliente('Ficha SA', '30-71234567-1');
    await x.factura({ terceroId: otro.id, fecha: '2026-11-02', fechaVencimiento: '2026-12-01' });
    await x.vencida({ terceroId: otro.id });
    await x.gestion(otro.id, { fecha: '2026-11-05', nota: 'Primera' });
    await x.gestion(otro.id, { nota: 'Segunda' });
    const f = (await x.http.get(`/api/ventas/cobranzas/${otro.id}`)).body as { cliente: { telefono: string }; vencido: string; comprobantes: { vencido: boolean; dias: number }[]; gestiones: { nota: string }[] };
    expect(f.cliente.telefono).toBe('4444-0000');
    expect(f.vencido).toBe('1210.00');
    expect(f.comprobantes.map((c) => [c.vencido, c.dias])).toEqual([[true, 6], [false, 0]]);
    expect(f.gestiones.map((g) => g.nota)).toEqual(['Segunda', 'Primera']);
  });

  it('permisos de consulta', async () => {
    const x = await escenario();
    const g = await otroUsuario(app, prisma, x.empresaId, ['cobranzas.gestionar']);
    expect((await g.http.get('/api/ventas/cobranzas')).status).toBe(200);
    expect((await g.http.get(`/api/ventas/cobranzas/${x.clienteRI.id}`)).status).toBe(200);
    const n = await otroUsuario(app, prisma, x.empresaId, ['tesoreria.ver']);
    expect((await n.http.get('/api/ventas/cobranzas')).status).toBe(403);
  });
});
