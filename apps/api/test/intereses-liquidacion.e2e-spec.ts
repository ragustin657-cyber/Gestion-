import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Nota { id: string; terceroId: string; monedaCodigo: string; total: string; estado: string }

describe('intereses: liquidación', () => {
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
    await v.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 5 });
    const octubre = (o: Record<string, unknown> = {}) => v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-10', ...o });
    const liquidar = (o: Record<string, unknown> = {}, http = v.http) => http.post('/api/ventas/intereses', { anio: 2026, mes: 10, ...o });
    const grupos = async () => (await v.http.get('/api/ventas/intereses?anio=2026&mes=10')).body.grupos as { renglones: { comprobanteId: string }[] }[];
    return { ...v, octubre, liquidar, grupos };
  };

  it('una nota por cliente y moneda', async () => {
    const x = await escenario();
    const vieja = await x.octubre();
    await x.octubre({ fecha: '2026-10-05' });
    const usd = await x.octubre({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
    await x.cotizacionUsd('2026-11-06', 1050);
    const r = await x.liquidar();
    expect(r.status).toBe(201);
    const notas = r.body.notas as Nota[];
    expect(notas.map((n) => [n.monedaCodigo, n.estado]).sort()).toEqual([['ARS', 'AUTORIZADO'], ['USD', 'AUTORIZADO']]);
    const ars = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: notas.find((n) => n.monedaCodigo === 'ARS')!.id }, include: { renglones: true } });
    expect([ars.tipo, ars.comprobanteAsociadoId, ars.renglones.length, ars.vendedorId, ars.aplicarAAsociado]).toEqual(['NOTA_DEBITO', vieja.id, 2, null, false]);
    expect(ars.renglones[0].descripcion).toMatch(/^Intereses por mora FC A 0001-\d{8} \(21 días\)$/);
    const nUsd = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: notas.find((n) => n.monedaCodigo === 'USD')!.id } });
    expect([nUsd.monedaCodigo, nUsd.comprobanteAsociadoId]).toEqual(['USD', usd.id]);
  });

  it('IVA encima y cuenta de intereses', async () => {
    const x = await escenario();
    await x.octubre();
    const rr = await x.liquidar(); if (rr.status !== 201) throw new Error(JSON.stringify(rr.body)); const n = (rr.body.notas as Nota[])[0];
    const nd = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: n.id }, include: { renglones: true } });
    expect([nd.netoGravado.toFixed(2), nd.iva.toFixed(2), nd.total.toFixed(2)]).toEqual(['42.35', '8.89', '51.24']);
    expect(nd.renglones[0].cuentaContableId).toBe(await x.cuenta('4.2.02'));
  });

  it('no se liquida dos veces', async () => {
    const x = await escenario();
    await x.octubre();
    expect((await x.liquidar()).status).toBe(201);
    const r = await x.liquidar();
    expect([r.status, r.body.message]).toEqual([400, 'No hay intereses para liquidar en 10/2026']);
    expect(await x.grupos()).toEqual([]);
  });

  it('excluir', async () => {
    const x = await escenario();
    await x.octubre();
    const otra = await x.octubre({ fecha: '2026-10-05' });
    const n = ((await x.liquidar({ excluir: [otra.id] })).body.notas as Nota[])[0];
    expect(await prisma.comprobanteVentaRenglon.count({ where: { comprobanteId: n.id } })).toBe(1);
    expect((await x.grupos())[0].renglones.map((r) => r.comprobanteId)).toEqual([otra.id]);
  });

  it('nota de crédito libera el mes', async () => {
    const x = await escenario();
    const fc = await x.octubre();
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    const nc = await x.http.post('/api/ventas/comprobantes', x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: n.id, renglones: [{ descripcion: 'Anula intereses', cantidad: 1, precioUnitario: 42.35, alicuota: 21 }], emitir: true }));
    expect(nc.status).toBe(201);
    expect((await x.grupos())[0].renglones.map((r) => r.comprobanteId)).toEqual([fc.id]);
  });

  it('nota de intereses no se modifica', async () => {
    const x = await escenario();
    await x.octubre();
    await x.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 5 });
    // Sin emitir: una nota que quedó en borrador (se simula volviendo el estado)
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    await prisma.comprobanteVenta.update({ where: { id: n.id }, data: { estado: 'PENDIENTE_CAE', numero: null, cae: null } });
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: n.id } });
    const r = await x.http.put(`/api/ventas/comprobantes/${n.id}`, { ...x.datos({ tipo: 'NOTA_DEBITO', comprobanteAsociadoId: c.comprobanteAsociadoId, renglones: [{ descripcion: 'x', cantidad: 1, precioUnitario: 1, alicuota: 21 }] }), version: c.version });
    expect([r.status, r.body.message]).toEqual([400, 'Las notas de débito de intereses no se modifican: elimínela y vuelva a liquidar']);
  });

  it('confirmaciones simultáneas', async () => {
    const x = await escenario();
    await x.octubre();
    const rs = await Promise.all([x.liquidar(), x.liquidar()]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.comprobanteVenta.count({ where: { empresaId: x.empresaId, tipo: 'NOTA_DEBITO' } })).toBe(1);
  });

  it('historial', async () => {
    const x = await escenario();
    await x.octubre();
    await x.liquidar();
    const [l] = (await x.http.get('/api/ventas/intereses/liquidaciones')).body as { numero: number; tasa: string; totales: { ARS?: string }; notas: { estado: string; numero: string | null; cliente: string }[] }[];
    expect([l.numero, l.tasa, l.totales.ARS, l.notas[0].estado, l.notas[0].cliente]).toEqual([1, '5.00', '42.35', 'AUTORIZADO', 'Distribuidora Norte SA']);
    expect(l.notas[0].numero).toMatch(/^ND A 0001-\d{8}$/);
  });

  it('permisos', async () => {
    const x = await escenario();
    await x.octubre();
    const u = await otroUsuario(app, prisma, x.empresaId, ['intereses.liquidar']);
    expect((await x.liquidar({}, u.http)).status).toBe(201);
  });

  it('revisión: la nota en dólares usa la cotización del día', async () => {
    const x = await escenario();
    await x.octubre({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
    await x.cotizacionUsd('2026-11-06', 1100);
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    expect((await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: n.id } })).cotizacion.toFixed(0)).toBe('1100');
  });

  it('revisión: un cliente inactivo no se liquida ni traba al resto', async () => {
    const x = await escenario();
    await x.octubre();
    const otro = (await x.http.post('/api/terceros', { esCliente: true, razonSocial: 'Otro SA', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' })).body as { id: string };
    await x.octubre({ terceroId: otro.id });
    await prisma.tercero.update({ where: { id: x.clienteRI.id }, data: { activo: false } });
    expect((await x.grupos()).length).toBe(1);
    const r = await x.liquidar();
    expect(r.status).toBe(201);
    expect((r.body.notas as Nota[]).map((n) => n.terceroId)).toEqual([otro.id]);
  });

  it('revisión: nota rechazada bloquea hasta eliminarla', async () => {
    const x = await escenario();
    await x.octubre();
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    await prisma.comprobanteVenta.update({ where: { id: n.id }, data: { estado: 'RECHAZADO', numero: null, cae: null } });
    await prisma.movimientoCuentaCorriente.deleteMany({ where: { origenTipo: 'VENTA', origenId: n.id } });
    expect(await x.grupos()).toEqual([]);
    expect((await x.http.delete(`/api/ventas/comprobantes/${n.id}`)).status).toBeLessThan(300);
    expect((await x.grupos()).length).toBe(1);
    const [l] = (await x.http.get('/api/ventas/intereses/liquidaciones')).body as { notas: { estado: string; cliente: string }[] }[];
    expect(l.notas[0].estado).toBe('ELIMINADA');
  });

  it('revisión: una nota de crédito parcial no libera el mes', async () => {
    const x = await escenario();
    await x.octubre();
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    expect((await x.http.post('/api/ventas/comprobantes', x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: n.id, renglones: [{ descripcion: 'Parcial', cantidad: 1, precioUnitario: 10, alicuota: 21 }], emitir: true }))).status).toBe(201);
    expect(await x.grupos()).toEqual([]);
  });

  it('revisión: las notas de intereses no generan intereses', async () => {
    const x = await escenario();
    await x.octubre();
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    // La nota de intereses, vencida en octubre (simulado), no es candidata en ese mes
    await prisma.comprobanteVenta.update({ where: { id: n.id }, data: { fecha: new Date('2026-10-01'), fechaVencimiento: new Date('2026-10-05') } });
    await prisma.liquidacionInteresesRenglon.deleteMany({ where: { notaDebitoId: { not: n.id } } });
    const ids = (await x.grupos()).flatMap((g) => g.renglones.map((r) => r.comprobanteId));
    expect(ids).not.toContain(n.id);
  });
});
