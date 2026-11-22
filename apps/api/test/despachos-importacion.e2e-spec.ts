import { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };
const NUMERO = '26001IC04012345K';

describe('despachos de importación (E41)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await sesionConPlan(app, prisma);
    const datos = (o: Record<string, unknown> = {}) => ({
      numeroDespacho: NUMERO, fechaEmision: '2026-10-15', fechaContable: '2026-10-15',
      renglones: [{ base: 100000, alicuotaIva: 21 }, { base: 50000, alicuotaIva: 10.5 }],
      percepcionIva: 3000, percepcionGanancias: 6000, percepcionesIibb: [{ jurisdiccion: '902', importe: 2500 }], derechosImportacion: 8000, tasaEstadistica: 2000,
      totalDeclarado: 47750, ...o,
    });
    const despacho = (o: Record<string, unknown> = {}) => s.http.post('/api/compras/despachos', datos(o));
    const asiento = async (id: string) => {
      const a = await prisma.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
      const r: Record<string, [string, string]> = {};
      for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toFixed(2), x.haber.toFixed(2)];
      return r;
    };
    return { ...s, despacho, datos, asiento };
  };

  it('carga el despacho: IVA por alícuota, deuda = lo liquidado y asiento de los tributos', async () => {
    const x = await escenario();
    const r = await x.despacho();
    expect(r.status).toBe(201);
    expect([r.body.tipo, r.body.numeroDespacho, r.body.iva, r.body.total, r.body.netoGravado]).toEqual(['DESPACHO_IMPORTACION', NUMERO, '26250', '47750', '150000']);
    const aduana = await prisma.tercero.findFirstOrThrow({ where: { empresaId: x.empresaId, cuit: '33693450239' } });
    expect([aduana.razonSocial, aduana.esProveedor, aduana.condicionIva, aduana.exentoGanancias]).toEqual(['Dirección General de Aduanas', true, 'EXENTO', true]);
    expect(r.body.terceroId).toBe(aduana.id);
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    expect(mov.importe.toFixed(2)).toBe('47750.00');
    const c = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(await x.asiento(c.asientoId!)).toEqual({
      '1.1.03.001': ['26250.00', '0.00'], '1.1.03.002': ['3000.00', '0.00'], '1.1.03.012': ['6000.00', '0.00'], '1.1.03.003': ['2500.00', '0.00'],
      '5.1.02': ['10000.00', '0.00'], '2.1.01.001': ['0.00', '47750.00'],
    });
    // El segundo despacho reusa la Aduana
    expect((await x.despacho({ numeroDespacho: '26001IC04012346L' })).status).toBe(201);
    expect(await prisma.tercero.count({ where: { empresaId: x.empresaId, cuit: '33693450239' } })).toBe(1);
  });

  it('solo IVA', async () => {
    const x = await escenario();
    const r = await x.despacho({ renglones: [{ base: 10000, alicuotaIva: 21 }], percepcionIva: 0, percepcionGanancias: 0, percepcionesIibb: [], derechosImportacion: 0, tasaEstadistica: 0, totalDeclarado: 2100 });
    expect([r.status, r.body.total]).toEqual([201, '2100']);
  });

  it('validaciones', async () => {
    const x = await escenario();
    expect((await x.despacho({ numeroDespacho: '123' })).body.message).toBe('El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)');
    expect((await x.despacho({ letra: 'A' })).body.message).toBe('El despacho no lleva letra ni número de comprobante');
    expect((await x.despacho({ totalDeclarado: 50000 })).status).toBe(400);
    expect((await x.despacho()).status).toBe(201);
    const rep = await x.despacho();
    expect([rep.status, rep.body.message]).toEqual([400, `Ya existe el despacho ${NUMERO}`]);
  });

  it('Aduana existente inactiva: se rechaza sin modificarla', async () => {
    const x = await escenario();
    await prisma.tercero.create({ data: { empresaId: x.empresaId, codigo: 900, razonSocial: 'DGA', cuit: '33693450239', condicionIva: 'EXENTO', esProveedor: true, activo: false } });
    const r = await x.despacho();
    expect([r.status, r.body.message]).toEqual([400, 'El tercero con el CUIT de la Aduana (DGA) no es un proveedor activo: actívelo o márquelo como proveedor']);
  });

  it('con la posición de IVA del mes cerrada no se carga ni se anula', async () => {
    const x = await escenario();
    const r = await x.despacho();
    await x.http.put('/api/impuestos/config', { ...CONFIG, ivaInicioAnio: 2026, ivaInicioMes: 10 });
    expect((await x.http.post('/api/impuestos/posicion-iva/2026/10/cerrar')).status).toBe(201);
    const MSG = 'La posición de IVA de 10/2026 está cerrada: use una fecha de un mes abierto o reabra la posición';
    expect((await x.despacho({ numeroDespacho: '26001IC04012346L' })).body.message).toBe(MSG);
    const an = await x.http.post(`/api/compras/comprobantes/${r.body.id}/anular`, { motivo: 'Error' });
    expect([an.status, an.body.message]).toEqual([400, MSG]);
  });

  it('la orden de pago a la Aduana no lleva retenciones', async () => {
    const x = await escenario();
    const r = await x.despacho({ fechaEmision: '2026-11-02', fechaContable: '2026-11-02' });
    await prisma.empresa.update({ where: { id: x.empresaId }, data: { agenteRetencionGanancias: true, jurisdiccionesIibb: ['902'] } });
    await prisma.tercero.update({ where: { id: r.body.terceroId }, data: { regimenGanancias: '78', exentoGanancias: false } });
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    const op = await x.http.post('/api/pagos/ordenes', { terceroId: r.body.terceroId, fecha: '2026-11-06', imputaciones: [{ movimientoId: mov.id, importe: 47750 }] });
    expect(op.status).toBe(201);
    const ret = await x.http.get(`/api/pagos/ordenes/${op.body.id}/retenciones?fechaPago=2026-11-15`);
    expect(ret.status).toBe(200);
    expect([ret.body.retenciones, ret.body.totalRetenciones]).toEqual([[], '0.00']);
  });

  it('Libro IVA Compras: base en el neto, columnas de Ganancias y otros tributos, total liquidado y nota', async () => {
    const x = await escenario();
    await x.despacho();
    const l = (await x.http.get('/api/compras/libro-iva?desde=2026-10-01&hasta=2026-10-31')).body as { filas: Record<string, unknown>[]; totales: Record<string, string>; notas: string[] };
    const f = l.filas[0];
    expect([f.tipo, f.numero, f.percepcionGanancias, f.otrosTributos, f.total]).toEqual(['DESPACHO_IMPORTACION', NUMERO, '6000.00', '10000.00', '47750.00']);
    expect(f.netoPorAlicuota).toEqual({ '21': '100000.00', '10.5': '50000.00' });
    expect([l.totales.percepcionGanancias, l.totales.otrosTributos]).toEqual(['6000.00', '10000.00']);
    expect(l.notas).toContain('En los despachos de importación el total es lo liquidado por la Aduana; la base imponible no lo integra');
    const xlsx = await x.http.get('/api/compras/libro-iva?desde=2026-10-01&hasta=2026-10-31&formato=xlsx');
    expect(xlsx.status).toBe(200);
    // La posición de IVA del mes toma el IVA y la percepción del despacho
    const p = (await x.http.get('/api/impuestos/posicion-iva?anio=2026&mes=10')).body as { totalCredito: string; percepciones: string };
    expect([p.totalCredito, p.percepciones]).toEqual(['26250.00', '3000.00']);
  });

  it('Libro IVA Digital: código 066, número de despacho, CUIT de la Aduana y tributos', async () => {
    const x = await escenario();
    await x.despacho();
    const g = (await x.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202610' })).body;
    const pres = await prisma.presentacion.findUniqueOrThrow({ where: { id: g.id } });
    const zip = await JSZip.loadAsync(Buffer.from(pres.contenido));
    const [l] = Buffer.from(await zip.file('COMPRAS_CBTE.txt')!.async('uint8array')).toString('latin1').split('\r\n');
    expect([l.slice(8, 11), l.slice(11, 16), l.slice(16, 36), l.slice(36, 52), l.slice(52, 54), l.slice(54, 74)])
      .toEqual(['066', '00000', '0'.repeat(20), NUMERO, '80', '00000000033693450239']);
    expect([l.slice(104, 119), l.slice(149, 164), l.slice(164, 179), l.slice(179, 194), l.slice(237, 238), l.slice(239, 254), l.slice(254, 269)])
      .toEqual(['000000004775000', '000000000300000', '000000000600000', '000000000250000', '2', '000000002625000', '000000001000000']);
    const alic = Buffer.from(await zip.file('COMPRAS_IMPORTACIONES.txt')!.async('uint8array')).toString('latin1').split('\r\n').filter(Boolean);
    // Revisión: las alícuotas del despacho van al archivo de importaciones
    expect(alic).toHaveLength(2);
  });

  it('revisión: dos despachos del mes van al archivo de importaciones identificados por su número', async () => {
    const x = await escenario();
    await x.despacho();
    await x.despacho({ numeroDespacho: '26001IC04012346L', renglones: [{ base: 10000, alicuotaIva: 21 }], percepcionIva: 0, percepcionGanancias: 0, percepcionesIibb: [], derechosImportacion: 0, tasaEstadistica: 0, totalDeclarado: 2100 });
    const g = (await x.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202610' })).body;
    const pres = await prisma.presentacion.findUniqueOrThrow({ where: { id: g.id } });
    const zip = await JSZip.loadAsync(Buffer.from(pres.contenido));
    const leer = async (n: string) => Buffer.from(await zip.file(n)!.async('uint8array')).toString('latin1').split('\r\n').filter(Boolean);
    expect(await leer('COMPRAS_ALICUOTAS.txt')).toEqual([]);
    const imp = await leer('COMPRAS_IMPORTACIONES.txt');
    expect(imp.map((l) => [l.slice(0, 16), l.length])).toEqual([[NUMERO, 50], [NUMERO, 50], ['26001IC04012346L', 50]]);
  });

  it('revisión: el número de despacho se ve en la cuenta corriente, el buscador y la orden de pago', async () => {
    const x = await escenario();
    const r = await x.despacho();
    const cc = (await x.http.get(`/api/compras/cuenta-corriente/${r.body.terceroId}`)).body as { movimientos?: { comprobante: string }[] } | { comprobante: string }[];
    const filas = Array.isArray(cc) ? cc : (cc.movimientos ?? []);
    expect(filas.map((f) => f.comprobante)).toContain(`Despacho ${NUMERO}`);
    const b = (await x.http.get(`/api/compras/buscador?q=${NUMERO}`)).body as { numero: string }[];
    expect(b.map((f) => f.numero)).toContain(`Despacho ${NUMERO}`);
    const pend = (await x.http.get(`/api/pagos/pendientes?terceroId=${r.body.terceroId}`)).body as { descripcion?: string; comprobante?: string }[];
    expect(JSON.stringify(pend)).toContain(`Despacho ${NUMERO}`);
  });

  it('revisión: el control con ARCA no marca los despachos como faltantes', async () => {
    const x = await escenario();
    await x.despacho({ fechaEmision: '2026-11-02', fechaContable: '2026-11-02' });
    const csv = 'Fecha;Tipo;Punto de Venta;Número Desde;Nro. Doc. Emisor;Imp. Neto Gravado;IVA;Imp. Total\n';
    const r = await request(app.getHttpServer()).post('/api/impuestos/control-arca').set('Authorization', `Bearer ${x.token}`)
      .field('sentido', 'RECIBIDOS').field('desde', '2026-11-01').field('hasta', '2026-11-30').attach('archivo', Buffer.from(csv), 'mc.csv');
    expect(r.status).toBe(201);
    expect(r.body.soloSistema).toEqual([]);
  });

  it('pulido E42: el alta del despacho toma el lock de la Aduana (duplicados y primera Aduana simultáneos)', async () => {
    const x = await escenario();
    let soltar!: () => void;
    await new Promise<void>((ok) => {
      void prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `aduana:${x.empresaId}`);
        ok();
        await new Promise<void>((fin) => (soltar = fin));
      }, { timeout: 20000 });
    });
    let listo = false;
    const pedido = x.despacho().then((r) => ((listo = true), r));
    await new Promise((ok) => setTimeout(ok, 600));
    expect(listo).toBe(false);
    soltar();
    expect((await pedido).status).toBe(201);
    // Simultáneos: uno se registra y el otro recibe el mensaje claro; distintos: los dos, con una sola Aduana
    const [a, b] = await Promise.all([x.despacho({ numeroDespacho: '26001IC04012347M' }), x.despacho({ numeroDespacho: '26001IC04012347M' })]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect([a, b].find((r) => r.status === 400)!.body.message).toBe('Ya existe el despacho 26001IC04012347M');
    expect(await prisma.tercero.count({ where: { empresaId: x.empresaId, cuit: '33693450239' } })).toBe(1);
  });

  it('pulido E42: el despacho admite alícuotas de 21 % y 10,5 %', async () => {
    const x = await escenario();
    const r = await x.despacho({ renglones: [{ base: 1000, alicuotaIva: 27 }], percepcionIva: 0, percepcionGanancias: 0, percepcionesIibb: [], derechosImportacion: 0, tasaEstadistica: 0, totalDeclarado: 270 });
    expect([r.status, r.body.message]).toEqual([400, 'El despacho admite alícuotas de 21 % y 10,5 %']);
  });

  it('pulido E42: el Excel del Libro IVA Compras de impuestos muestra el comprobante legible', async () => {
    const x = await escenario();
    await x.despacho();
    const r = await request(app.getHttpServer()).get('/api/impuestos/libro-iva-compras?desde=2026-10-01&hasta=2026-10-31&formato=xlsx').set('Authorization', `Bearer ${x.token}`)
      .buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as unknown as ArrayBuffer);
    const valores: string[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => valores.push(String(c.value))));
    expect(valores).toContain(`Despacho ${NUMERO}`);
  });

  it('pulido E42: anular un despacho de un mes abierto deja contraasiento y la cuenta corriente en cero', async () => {
    const x = await escenario();
    const r = await x.despacho();
    const an = await x.http.post(`/api/compras/comprobantes/${r.body.id}/anular`, { motivo: 'Error' });
    expect(an.status).toBe(200);
    const c = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([c.estado, !!c.asientoAnulacionId]).toEqual(['ANULADO', true]);
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    expect([mov.anulado, mov.saldo.toFixed(2)]).toEqual([true, '0.00']);
  });
});
