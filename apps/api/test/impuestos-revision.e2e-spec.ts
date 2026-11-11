import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, sesionConPlan } from './helpers';
import { periodoConMovimientos } from './helpers-impuestos';

describe('impuestos: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const crudo = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
      const p: Buffer[] = [];
      res.on('data', (c: Buffer) => p.push(c));
      res.on('end', () => cb(null, Buffer.concat(p)));
    });
  const encabezados = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const r: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => r.push(String(c.value))));
    return r;
  };

  it('SICORE no admite la segunda quincena', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.post('/api/impuestos/presentaciones', { tipo: 'SICORE', periodo: '202611', quincena: 2 });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('SICORE solo admite el mes completo o la primera quincena');
  });

  it('el cuadre con el Mayor no cuenta los asientos de cierre ni de apertura', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: v.empresaId } });
    const iva = await v.cuenta('2.1.02.001'), pn = await v.cuenta('3.1.01');
    const max = await prisma.asiento.aggregate({ where: { empresaId: v.empresaId }, _max: { numero: true } });
    await prisma.asiento.create({
      data: {
        empresaId: v.empresaId, numero: (max._max.numero ?? 0) + 1, fecha: new Date('2026-11-01T00:00:00Z'), descripcion: 'Apertura', origenTipo: 'CIERRE_EJERCICIO', origenId: randomUUID(),
        creadoPor: 'x', tipo: 'APERTURA', ejercicioId: ej.id,
        renglones: { create: [{ empresaId: v.empresaId, cuentaContableId: pn, debe: 999, haber: 0 }, { empresaId: v.empresaId, cuentaContableId: iva, debe: 0, haber: 999 }] },
      },
    });
    expect((await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body.advertencias).toEqual([]);
  });

  it('control con ARCA: una compra B coincide aunque ARCA informe neto e IVA', async () => {
    const s = await sesionConPlan(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { condicionIva: 'EXENTO' } });
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const fc = await s.http.post('/api/compras/comprobantes', {
      terceroId: proveedorId, tipo: 'FACTURA', letra: 'B', puntoVenta: 3, numero: 77, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS',
      totalDeclarado: 1210, renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: 1210, alicuotaIva: 21 }],
    });
    expect(fc.status).toBe(201);
    const csv = 'Fecha;Tipo;Punto de Venta;Número Desde;Nro. Doc. Emisor;Imp. Neto Gravado;IVA;Imp. Total\n02/11/2026;6 - Factura B;3;77;30700123452;1.000,00;210,00;1.210,00\n';
    const r = await request(app.getHttpServer()).post('/api/impuestos/control-arca').set('Authorization', `Bearer ${s.token}`)
      .field('sentido', 'RECIBIDOS').field('desde', '2026-11-01').field('hasta', '2026-11-30').attach('archivo', Buffer.from(csv), 'mc.csv');
    expect(r.body).toMatchObject({ coinciden: 1, diferencias: [] });
  });

  it('control con ARCA: las diferencias dicen qué campo difiere', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    await s.http.post('/api/compras/comprobantes', {
      terceroId: proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 3, numero: 78, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS',
      totalDeclarado: 1210, renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21 }],
    });
    const csv = 'Fecha;Tipo;Punto de Venta;Número Desde;Nro. Doc. Emisor;Imp. Neto Gravado;IVA;Imp. Total\n02/11/2026;1;3;78;30700123452;1.100,00;110,00;1.210,00\n';
    const r = await request(app.getHttpServer()).post('/api/impuestos/control-arca').set('Authorization', `Bearer ${s.token}`)
      .field('sentido', 'RECIBIDOS').field('desde', '2026-11-01').field('hasta', '2026-11-30').attach('archivo', Buffer.from(csv), 'mc.csv');
    expect(r.body.diferencias).toEqual([expect.objectContaining({ campos: ['Neto gravado', 'IVA'] })]);
  });

  it('Libro IVA Digital: totales de control por archivo, en pesos, iguales a los libros', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const g = (await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' })).body;
    const ventas = (await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body;
    const compras = (await v.http.get('/api/impuestos/libro-iva-compras?desde=2026-11-01&hasta=2026-11-30')).body;
    const ivaCompras = Object.values(compras.totales.ivaPorAlicuota as Record<string, string>).reduce((s, x) => s + Number(x), 0).toFixed(2);
    expect(g.controles).toEqual({
      ventas: { registros: 4, total: ventas.totales.total, iva: ventas.totales.iva },
      compras: { registros: 1, total: compras.totales.total, iva: ivaCompras },
    });
  });

  it('los libros en Excel incluyen percepciones, impuestos internos, condición de IVA y comprobantes C', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const c = await encabezados((await crudo(v.token, '/api/impuestos/libro-iva-compras?desde=2026-11-01&hasta=2026-11-30&formato=xlsx')).body as Buffer);
    expect(c).toEqual(expect.arrayContaining(['Perc. IVA', 'Perc. IIBB', 'Imp. internos', 'No computable']));
    const vt = await encabezados((await crudo(v.token, '/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30&formato=xlsx')).body as Buffer);
    expect(vt).toEqual(expect.arrayContaining(['Condición IVA', 'No discriminado']));
  });

  it('historial: si no se puede verificar, lo dice en lugar de pedir rectificar', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    await prisma.tercero.update({ where: { id: proveedorId }, data: { situacionIibb: 'CONVENIO', numeroIibb: '9011234567' } });
    const usuario = (await prisma.usuarioEmpresa.findFirstOrThrow({ where: { empresaId: s.empresaId } })).usuarioId;
    const op = await prisma.ordenPago.create({ data: { empresaId: s.empresaId, numero: 1, terceroId: proveedorId, fecha: new Date('2026-11-10T00:00:00Z'), estado: 'PAGADA', fechaPago: new Date('2026-11-10T00:00:00Z'), totalCancelarPesos: 1210, creadoPor: usuario } });
    await prisma.ordenPagoRetencion.create({ data: { empresaId: s.empresaId, ordenPagoId: op.id, impuesto: 'IIBB', jurisdiccion: '901', base: 1000, alicuota: '3', importe: 30, detalle: {}, certificadoNumero: 1 } });
    expect((await s.http.post('/api/impuestos/presentaciones', { tipo: 'AGIP', periodo: '202611' })).status).toBe(201);
    await prisma.tercero.update({ where: { id: proveedorId }, data: { situacionIibb: null } });
    const [fila] = (await s.http.get('/api/impuestos/presentaciones')).body;
    expect(fila.cambiaron).toBeNull();
    expect(fila.error).toContain('Complete la situación de Ingresos Brutos');
  });

  it('las ventas de otro ambiente de ARCA no entran en el libro ni en el Libro IVA Digital', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    await prisma.configArca.updateMany({ where: { empresaId: v.empresaId }, data: { ambiente: 'HOMOLOGACION' } });
    const libro = (await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(libro.filas).toEqual([]);
    expect(libro.advertencias).toContain('Se omitieron 4 comprobantes de venta emitidos en ambiente SIMULADO');
    const g = (await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' })).body;
    expect(g.controles.ventas.registros).toBe(0);
    expect(g.advertencias).toContain('Se omitieron 4 comprobantes de venta emitidos en ambiente SIMULADO');
  });
});
