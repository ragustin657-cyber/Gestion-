import { INestApplication } from '@nestjs/common';
import { ArcaSimuladoFex } from '../src/arca/arca-simulado-fex';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('factura de exportación (E58)', () => {
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
    const pvExpo = (await v.http.post('/api/empresas/actual/puntos-venta', { numero: 5, descripcion: 'Exportación', exportacion: true })).body as { id: string; numero: number };
    const alta = await v.http.post('/api/terceros', { esCliente: true, razonSocial: 'Acme Inc.', cuit: '55000002126', tipoDocumento: 'OTRO', condicionIva: 'CONSUMIDOR_FINAL', residenteExterior: true, nif: 'US-123456789', paisSire: 212, domicilioExterior: '1 Main St, New York', cuitPais: '55000002126' });
    if (alta.status !== 201) throw new Error(JSON.stringify(alta.body));
    const exterior = alta.body as { id: string };
    await v.cotizacionUsd('2026-11-02', 1000);
    const renglonE = { descripcion: 'Servicio de software', cantidad: 1, precioUnitario: 1000, alicuota: 'EXENTO' };
    const datosE = (o: Record<string, unknown> = {}) => v.datos({ terceroId: exterior.id, puntoVentaId: pvExpo.id, concepto: 'SERVICIOS', fechaServicioDesde: '2026-11-01', fechaServicioHasta: '2026-11-30', fechaVencimientoPago: '2026-12-02', monedaCodigo: 'USD', cotizacion: 1000, tipoExportacion: 'SERVICIOS', paisDestino: 212, formaPago: 'Transferencia', renglones: [renglonE], ...o });
    const crear = (o: Record<string, unknown> = {}) => v.http.post('/api/ventas/comprobantes', datosE(o));
    return { ...v, pvExpo, exterior, renglonE, datosE, crear };
  };

  it('factura E de servicios en el punto de venta de exportación', async () => {
    const x = await escenario();
    const r = await x.crear();
    expect([r.status, r.body.letra, r.body.exportacion, r.body.tipoExportacion]).toEqual([201, 'E', true, 'SERVICIOS']);
    expect(Number(r.body.iva)).toBe(0);
  });

  it('validaciones de exportación', async () => {
    const x = await escenario();
    const msg = async (o: Record<string, unknown>) => { const r = await x.crear(o); return [r.status, r.body.message]; };
    expect(await msg({ puntoVentaId: x.puntoVenta.id })).toEqual([400, 'El punto de venta no es de exportación']);
    const local = await x.http.post('/api/ventas/comprobantes', x.datos({ puntoVentaId: x.pvExpo.id }));
    expect([local.status, local.body.message]).toEqual([400, 'El punto de venta es de exportación: solo emite comprobantes E']);
    expect(await msg({ tipoExportacion: null })).toEqual([400, 'Indique el tipo de exportación']);
    expect(await msg({ paisDestino: null })).toEqual([400, 'Indique el país de destino']);
    expect(await msg({ tipoExportacion: 'BIENES', concepto: 'PRODUCTOS', permisoExistente: 'N' })).toEqual([400, 'Indique el incoterm']);
    expect(await msg({ tipoExportacion: 'BIENES', concepto: 'PRODUCTOS', incoterm: 'FOB', permisoExistente: 'S', permisos: [] })).toEqual([400, 'Cargue los permisos de embarque']);
    expect(await msg({ permisos: [{ numero: '26001EC01000001A', paisDestino: 212 }] })).toEqual([400, 'Los permisos de embarque son solo para bienes']);
    expect(await msg({ renglones: [{ ...x.renglonE, alicuota: 21 }] })).toEqual([400, 'La exportación no lleva IVA: use alícuota exento']);
    expect(await msg({ fce: true })).toEqual([400, 'La factura de crédito MiPyME no admite la letra E']);
    await x.http.patch(`/api/terceros/${x.exterior.id}`, { cuitPais: null });
    expect(await msg({})).toEqual([400, 'El cliente del exterior no tiene CUIT país']);
    const bienes = await x.crear({ tipoExportacion: 'BIENES', concepto: 'PRODUCTOS', incoterm: 'FOB', permisoExistente: 'S', permisos: [{ numero: '26001EC01000001A', paisDestino: 212 }] });
    expect(bienes.status).toBe(400);
  });

  it('bienes con permisos; cliente del exterior sin exportación; nota E contra factura B', async () => {
    const x = await escenario();
    const b = await x.crear({ tipoExportacion: 'BIENES', concepto: 'PRODUCTOS', incoterm: 'FOB', incotermDescripcion: 'Puerto de Buenos Aires', permisoExistente: 'S', permisos: [{ numero: '26001EC01000001A', paisDestino: 212 }] });
    expect([b.status, b.body.letra, b.body.permisos?.length]).toEqual([201, 'E', 1]);
    const sinExpo = await x.http.post('/api/ventas/comprobantes', x.datos({ terceroId: x.exterior.id, exportacion: false, monedaCodigo: 'ARS' }));
    expect([sinExpo.status, sinExpo.body.letra]).toEqual([201, 'B']);
    const fb = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ terceroId: x.exterior.id, exportacion: false, monedaCodigo: 'USD', cotizacion: 1000 }), emitir: true });
    expect(fb.body.estado).toBe('AUTORIZADO');
    const nc = await x.crear({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fb.body.id, renglones: [{ ...x.renglonE, precioUnitario: 10 }] });
    expect([nc.status, nc.body.message]).toEqual([400, 'La nota debe asociarse a una factura E']);
  });

  it('pedido del cliente del exterior con letra E; la facturación por lotes no lo factura', async () => {
    const x = await escenario();
    const ped = await x.http.post('/api/ventas/pedidos', { terceroId: x.exterior.id, fecha: '2026-11-02', monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ articuloId: null, descripcion: 'Producto', cantidad: 2, precioUnitario: 10, alicuota: 'EXENTO' }] });
    expect([ped.status, ped.body.letra]).toEqual([201, 'E']);
    await prisma.pedidoVenta.update({ where: { id: ped.body.id }, data: { estado: 'CONFIRMADO' } });
    const dep = (await x.http.post('/api/depositos', { codigo: 'C', nombre: 'Central' })).body as { id: string };
    const rem = await x.http.post('/api/ventas/remitos', { terceroId: x.exterior.id, puntoVentaId: x.puntoVenta.id, depositoId: dep.id, fecha: '2026-11-03', renglones: [{ pedidoRenglonId: ped.body.renglones[0].id, cantidad: 2 }] });
    expect(rem.status).toBe(201);
    const g = (await x.http.get(`/api/ventas/facturacion-lotes/vista-previa?hasta=2026-11-30&fecha=2026-11-06&terceroIds=${x.exterior.id}`)).body as { problemas: string[] }[];
    expect(g[0].problemas).toContain('El cliente es del exterior: facture la exportación de a una');
  });

  describe('emisión por WSFEX', () => {
    afterEach(() => ArcaSimuladoFex.forzarFalla('', null));
    const emitir = (x: Awaited<ReturnType<typeof escenario>>, o: Record<string, unknown> = {}) => x.http.post('/api/ventas/comprobantes', { ...x.datosE(o), emitir: true });
    const cuentasAsiento = async (origenId: string) => {
      const a = await prisma.asiento.findFirstOrThrow({ where: { origenId }, include: { renglones: true } });
      const cuentas = await prisma.cuentaContable.findMany({ where: { id: { in: a.renglones.map((r) => r.cuentaContableId) } } });
      return a.renglones.map((r) => cuentas.find((c) => c.id === r.cuentaContableId)!.codigo);
    };

    it('factura E autorizada por WSFEX, con numeración propia y sin IVA', async () => {
      const x = await escenario();
      const f = await emitir(x);
      expect([f.status, f.body.estado, f.body.numero, f.body.letra]).toEqual([201, 'AUTORIZADO', 1, 'E']);
      expect(f.body.cae).toBeTruthy();
      const sol = ArcaSimuladoFex.ultimaSolicitud(x.empresaId)!;
      expect(sol).toMatchObject({ cbteTipo: 19, ptoVta: 5, numero: 1, tipoExpo: 2, monedaId: 'DOL', monedaCtz: '1000', cuitPaisCliente: '55000002126', dstCmp: 212, impTotal: '1000.00' });
      expect(sol.items).toHaveLength(1);
      expect(await cuentasAsiento(f.body.id)).not.toContain('2.1.02.001');
      expect((await emitir(x)).body.numero).toBe(2);
      // Las A/B siguen por WSFEv1 con su numeración
      const b = await x.http.post('/api/ventas/comprobantes', { ...x.datos(), emitir: true });
      expect([b.body.estado, b.body.numero, b.body.letra]).toEqual(['AUTORIZADO', 1, 'A']);
    });

    it('nota de crédito E asociada; rechazo; sin conexión y reintento', async () => {
      const x = await escenario();
      const f = await emitir(x);
      const nc = await emitir(x, { tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, renglones: [{ ...x.renglonE, precioUnitario: 200 }] });
      expect([nc.status, nc.body.estado, nc.body.letra]).toEqual([201, 'AUTORIZADO', 'E']);
      expect(ArcaSimuladoFex.ultimaSolicitud(x.empresaId)).toMatchObject({ cbteTipo: 21, asociados: [{ tipo: 19, ptoVta: 5, nro: 1 }] });
      ArcaSimuladoFex.forzarFalla(x.empresaId, 'RECHAZO');
      const r = await emitir(x);
      expect([r.status, r.body.message]).toEqual([400, 'ARCA rechazó el comprobante: (1000) Rechazo simulado de WSFEX']);
      const borrador = (await x.crear()).body;
      ArcaSimuladoFex.forzarFalla(x.empresaId, 'SIN_CONEXION');
      expect((await x.http.post(`/api/ventas/comprobantes/${borrador.id}/emitir`, {})).status).toBe(502);
      expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: borrador.id } })).toMatchObject({ estado: 'PENDIENTE_CAE', numeroReservado: 2 });
      const ok = await x.http.post(`/api/ventas/comprobantes/${borrador.id}/emitir`, {});
      expect([ok.status, ok.body.estado, ok.body.numero]).toEqual([201, 'AUTORIZADO', 2]);
    });

    it('PDF de la factura E; cuenta de ventas de exportación', async () => {
      const x = await escenario();
      const otra = await prisma.cuentaContable.findFirstOrThrow({ where: { codigo: '4.1.02' } }).catch(() => null)
        ?? await prisma.cuentaContable.create({ data: { empresaId: x.empresaId, codigo: '4.1.99', nombre: 'Ventas al exterior', tipo: 'RESULTADO_POSITIVO', imputable: true } as never });
      await prisma.configCuenta.upsert({ where: { empresaId_concepto: { empresaId: x.empresaId, concepto: 'VENTAS_EXPORTACION' } }, create: { empresaId: x.empresaId, concepto: 'VENTAS_EXPORTACION', cuentaContableId: otra.id }, update: { cuentaContableId: otra.id } });
      const f = await emitir(x);
      expect(await cuentasAsiento(f.body.id)).toContain(otra.codigo);
      const pdf = await x.http.get(`/api/ventas/comprobantes/${f.body.id}/pdf`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
      const raw = (pdf.body as Buffer).toString('latin1');
      const texto = raw + [...raw.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('');
      expect(texto).toContain('FACTURA E');
      expect(texto).toContain('Exportaci');
    });
  });
});
