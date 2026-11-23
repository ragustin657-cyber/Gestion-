import { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { ArcaSimulado } from '../src/arca/arca-simulado';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

const CBU = '2850590940090418135201';

describe('factura de crédito MiPyME: emisión (E50)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (o: { mipyme?: boolean; cuenta?: boolean } = {}) => {
    const v = await prepararVentas(app, prisma);
    const banco = (await v.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await v.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await v.cuenta('1.1.01.002'), cbu: CBU })).body as { id: string };
    const conf = await v.http.put('/api/arca/config', { ambiente: 'SIMULADO', mipyme: o.mipyme ?? true, cuentaBancariaFceId: o.cuenta === false ? null : cuenta.id, transferenciaFce: 'SCA' });
    if (conf.status !== 200) throw new Error(JSON.stringify(conf.body));
    const emitir = (d: Record<string, unknown>) => v.http.post('/api/ventas/comprobantes', { ...v.datos(d), emitir: true });
    return { ...v, cuenta, emitir };
  };

  it('configuración: MiPyME, cuenta con CBU y transferencia', async () => {
    const x = await escenario();
    expect((await x.http.get('/api/arca/config')).body).toMatchObject({ ambiente: 'SIMULADO', mipyme: true, cuentaBancariaFceId: x.cuenta.id, transferenciaFce: 'SCA' });
    expect((await x.http.put('/api/arca/config', { transferenciaFce: 'XXX' })).status).toBe(400);
  });

  it('FCE A: código 201, numeración propia, vencimiento del pago y opcionales', async () => {
    const x = await escenario();
    const comun = await x.factura();
    expect(comun.numero).toBe(1);
    const r = await x.emitir({ fce: true, fechaVencimiento: '2026-12-15' });
    expect([r.status, r.body.estado, r.body.numero]).toEqual([201, 'AUTORIZADO', 1]);
    const d = ArcaSimulado.ultimaSolicitud(x.empresaId)!;
    expect([d.cbteTipo, d.fchVtoPago, d.opcionales]).toEqual([201, '20261215', [{ id: '2101', valor: CBU }, { id: '27', valor: 'SCA' }]]);
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([c.fce, c.transferenciaFce, c.fechaVencimientoPago?.toISOString().slice(0, 10)]).toEqual([true, 'SCA', '2026-12-15']);
    // ADC en el comprobante
    const adc = await x.emitir({ fce: true, transferenciaFce: 'ADC' });
    expect([adc.body.numero, ArcaSimulado.ultimaSolicitud(x.empresaId)!.opcionales]).toEqual([2, [{ id: '2101', valor: CBU }, { id: '27', valor: 'ADC' }]]);
  });

  it('FCE de servicios: el vencimiento del pago es el del comprobante', async () => {
    const x = await escenario();
    const r = await x.emitir({ fce: true, concepto: 'SERVICIOS', fechaServicioDesde: '2026-10-01', fechaServicioHasta: '2026-10-31', fechaVencimiento: '2026-12-10' });
    expect(r.status).toBe(201);
    expect(ArcaSimulado.ultimaSolicitud(x.empresaId)!.fchVtoPago).toBe('20261210');
  });

  it('notas FCE: código 203/202, asociada y anulación', async () => {
    const x = await escenario();
    const f = await x.emitir({ fce: true });
    const nc = await x.emitir({ tipo: 'NOTA_CREDITO', fce: true, anulacionFce: true, comprobanteAsociadoId: f.body.id });
    expect([nc.status, nc.body.estado]).toEqual([201, 'AUTORIZADO']);
    const d = ArcaSimulado.ultimaSolicitud(x.empresaId)!;
    expect([d.cbteTipo, d.asociados[0].tipo, d.opcionales, d.fchVtoPago]).toEqual([203, 201, [{ id: '22', valor: 'S' }], undefined]);
    const f2 = await x.emitir({ fce: true });
    const nd = await x.emitir({ tipo: 'NOTA_DEBITO', fce: true, comprobanteAsociadoId: f2.body.id });
    expect([nd.status, ArcaSimulado.ultimaSolicitud(x.empresaId)!.cbteTipo, ArcaSimulado.ultimaSolicitud(x.empresaId)!.opcionales]).toEqual([201, 202, [{ id: '22', valor: 'N' }]]);
  });

  it('errores', async () => {
    const x = await escenario({ mipyme: false });
    let r = await x.emitir({ fce: true });
    expect([r.status, r.body.message]).toEqual([400, 'La empresa no está marcada como MiPyME: no puede emitir factura de crédito']);
    const y = await escenario({ cuenta: false });
    r = await y.emitir({ fce: true });
    expect([r.status, r.body.message]).toEqual([400, 'Configure la cuenta bancaria (CBU) para la factura de crédito']);
    const comun = await y.factura();
    await y.http.put('/api/arca/config', { cuentaBancariaFceId: y.cuenta.id });
    r = await y.emitir({ tipo: 'NOTA_CREDITO', fce: true, comprobanteAsociadoId: comun.id });
    expect([r.status, r.body.message]).toEqual([400, 'La nota tiene que ser de la misma clase que la factura: factura de crédito MiPyME o común']);
    const fce = await y.emitir({ fce: true });
    r = await y.emitir({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fce.body.id });
    expect([r.status, r.body.message]).toEqual([400, 'La nota tiene que ser de la misma clase que la factura: factura de crédito MiPyME o común']);
  });

  it('Libro IVA Digital y PDF', async () => {
    const x = await escenario();
    const f = await x.emitir({ fce: true });
    const pdf = await x.http.get(`/api/ventas/comprobantes/${f.body.id}/pdf`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    // El texto del PDF va en hexadecimal: se decodifican los fragmentos
    const texto = [...(pdf.body as Buffer).toString('latin1').matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('');
    expect(texto).toContain('MiPyMEs (FCE)');
    expect(texto).toContain(CBU);
    const g = await x.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' });
    expect(g.status).toBe(201);
    const zipBuf = await x.http.get(`/api/impuestos/presentaciones/${g.body.id}/archivo`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const zip = await JSZip.loadAsync(zipBuf.body as Buffer);
    const vc = (await zip.file('VENTAS_CBTE.txt')!.async('string')).split('\r\n').filter(Boolean);
    expect(vc.map((l) => l.slice(8, 11))).toEqual(['201']);
  });
});
