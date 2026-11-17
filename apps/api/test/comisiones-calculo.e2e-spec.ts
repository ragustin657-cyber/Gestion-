import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Fila { vendedorId: string; nombre: string; renglones: number; neto: string; comision: string; liquidable: boolean; detalle: { tipo: string; comision: string; neto: string }[] }

describe('comisiones: cálculo del mes', () => {
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
    const prov = await v.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Pérez SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    const perez = (await v.http.post('/api/ventas/vendedores', { nombre: 'Pérez', tipo: 'EXTERNO', porcentaje: 3, proveedorId: prov.body.id })).body as { id: string };
    await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { vendedorId: perez.id });
    const recibo = async (fc: { id: string }, importe: number, o: Record<string, unknown> = {}) => {
      const r = await v.http.post('/api/ventas/recibos', {
        terceroId: v.clienteRI.id, fecha: '2026-11-05', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe }, cheques: [], transferencias: [], retenciones: [],
        aplicaciones: [{ comprobanteId: fc.id, importe }], ...o,
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const mes = async (anio = 2026, m = 11) => {
      const r = await v.http.get(`/api/ventas/comisiones?anio=${anio}&mes=${m}`);
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      return r.body.vendedores as Fila[];
    };
    return { ...v, perez, recibo, mes };
  };

  it('recibo total', async () => {
    const x = await escenario();
    await x.recibo(await x.factura(), 1210);
    const [p] = await x.mes();
    expect([p.nombre, p.neto, p.comision, p.renglones, p.liquidable, p.detalle[0].tipo]).toEqual(['Pérez', '1000.00', '30.00', 1, true, 'COBRO']);
  });

  it('recibo parcial', async () => {
    const x = await escenario();
    await x.recibo(await x.factura(), 605);
    const [p] = await x.mes();
    expect([p.neto, p.comision]).toEqual(['500.00', '15.00']);
  });

  it('una NC no comisiona', async () => {
    const x = await escenario();
    const fc = await x.factura();
    const nc = await x.http.post('/api/ventas/comprobantes', x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, renglones: [{ descripcion: 'Bonificación', cantidad: 1, precioUnitario: 500, alicuota: 21 }], emitir: true }));
    expect(nc.status).toBe(201);
    await x.recibo(fc, 605);
    const [p] = await x.mes();
    expect([p.comision, p.renglones]).toEqual(['15.00', 1]);
  });

  it('factura en dólares', async () => {
    const x = await escenario();
    const fc = await x.factura({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
    const { mov } = await x.cobro(110000, '2026-11-05');
    await x.cotizacionUsd('2026-11-05', 1100);
    const deb = await x.movDe(fc.id);
    const ap = await x.http.post('/api/ventas/aplicaciones', { terceroId: x.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 100 }] });
    expect(ap.status).toBe(201);
    const [p] = await x.mes();
    expect([p.neto, p.comision]).toEqual(['100000.00', '3000.00']);
  });

  it('gravado y exento', async () => {
    const x = await escenario();
    const fc = await x.factura({ renglones: [{ descripcion: 'Producto', cantidad: 1, precioUnitario: 1000, alicuota: 21 }, { descripcion: 'Exento', cantidad: 1, precioUnitario: 500, alicuota: 'EXENTO' }] });
    await x.recibo(fc, 1710);
    const [p] = await x.mes();
    expect([p.neto, p.comision]).toEqual(['1500.00', '45.00']);
  });

  it('recibo anulado antes de liquidar', async () => {
    const x = await escenario();
    const r = await x.recibo(await x.factura(), 1210);
    expect((await x.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    expect(await x.mes()).toEqual([]);
  });

  it('cheque rechazado', async () => {
    const x = await escenario();
    const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002') })).body as { id: string };
    const cheque = { tipo: 'FISICO', banco: 'Galicia', numero: '77001', libradorNombre: 'Librador SA', libradorCuit: '30500010912', fechaEmision: '2026-11-01', fechaPago: '2026-11-04', importe: 600 };
    const r = await x.recibo(await x.factura(), 1210, { efectivo: { importe: 610 }, cheques: [cheque] });
    const ch = await prisma.chequeTercero.findFirstOrThrow({ where: { empresaId: x.empresaId, numero: '77001' } });
    expect((await x.http.post('/api/tesoreria/depositos', { fecha: '2026-11-05', cajaId: x.caja.id, cuentaBancariaId: cuenta.id, cheques: [ch.id] })).status).toBe(201);
    expect((await x.http.post(`/api/tesoreria/cheques/${ch.id}/rechazar`, { fecha: '2026-11-05', motivo: 'Sin fondos' })).status).toBe(200);
    expect(r.id).toBeTruthy();
    const [p] = await x.mes();
    expect(p.detalle.map((d) => [d.tipo, d.comision])).toEqual([['COBRO', '30.00'], ['RECHAZO', '-14.88']]);
    expect(p.comision).toBe('15.12');
  });

  it('meses', async () => {
    const x = await escenario();
    const oct = await x.factura({ fecha: '2026-10-10', fechaVencimiento: '2026-11-10' });
    await x.recibo(oct, 1210, { fecha: '2026-10-20' });
    await x.recibo(await x.factura(), 605);
    expect((await x.mes(2026, 10))[0].comision).toBe('30.00');
    expect((await x.mes(2026, 11))[0].comision).toBe('45.00');
    expect(await x.mes(2026, 9)).toEqual([]);
  });

  it('vendedor con total negativo', async () => {
    const x = await escenario();
    const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002') })).body as { id: string };
    const cheque = { tipo: 'FISICO', banco: 'Galicia', numero: '77002', libradorNombre: 'Librador SA', libradorCuit: '30500010912', fechaEmision: '2026-11-01', fechaPago: '2026-11-04', importe: 1210 };
    const fc = await x.factura();
    await x.recibo(fc, 1210, { efectivo: null, cheques: [cheque] });
    // La comisión del cobro ya se liquidó (simulado): queda solo el ajuste por el rechazo
    const ap = await prisma.aplicacionCobro.findFirstOrThrow({ where: { empresaId: x.empresaId, origenTipo: 'RECIBO' } });
    await prisma.liquidacionComisiones.create({ data: { empresaId: x.empresaId, numero: 1, anio: 2026, mes: 10, fecha: new Date('2026-10-31'), creadoPor: 'test', renglones: { create: [{ empresaId: x.empresaId, vendedorId: x.perez.id, tipo: 'COBRO', aplicacionId: ap.id, comprobanteId: fc.id, cobrado: 1210, neto: 1000, porcentaje: 3, comision: 30 }] } } });
    const ch = await prisma.chequeTercero.findFirstOrThrow({ where: { empresaId: x.empresaId, numero: '77002' } });
    await x.http.post('/api/tesoreria/depositos', { fecha: '2026-11-05', cajaId: x.caja.id, cuentaBancariaId: cuenta.id, cheques: [ch.id] });
    expect((await x.http.post(`/api/tesoreria/cheques/${ch.id}/rechazar`, { fecha: '2026-11-05', motivo: 'Sin fondos' })).status).toBe(200);
    const [p] = await x.mes();
    expect([p.comision, p.liquidable, p.detalle.map((d) => d.tipo)]).toEqual(['-30.00', false, ['RECHAZO']]);
  });
});
