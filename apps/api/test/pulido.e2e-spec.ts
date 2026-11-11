import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ArcaSimulado } from '../src/arca/arca-simulado';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';
import { periodoConMovimientos } from './helpers-impuestos';
import { prepararVentas } from './helpers-ventas';

describe('entrega 8: pulido para producción', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('un error de configuración de ARCA se informa con su mensaje y no deja una emisión colgada', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    ArcaSimulado.forzarFalla(v.empresaId, 'ERROR_SERVICIO');
    const r = await v.http.post(`/api/ventas/comprobantes/${fc.id}/emitir`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('ARCA rechazó la consulta: (11002) El punto de venta no se encuentra habilitado a usar el presente WS.');
    expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: fc.id } })).toMatchObject({ estado: 'PENDIENTE_CAE', numeroReservado: null, emisionEnCurso: null });
    expect((await v.http.post(`/api/ventas/comprobantes/${fc.id}/emitir`, {})).body.estado).toBe('AUTORIZADO');
  });

  it('una NC pendiente cuenta para el tope de otra NC sobre la misma factura', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const nc = (r: number) => v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, renglones: [{ descripcion: 'x', cantidad: 1, precioUnitario: r, alicuota: 'EXENTO' }] }));
    expect((await nc(1000)).status).toBe(201);
    const segunda = await nc(300);
    expect(segunda.status).toBe(400);
    expect(segunda.body.message).toMatch(/^La nota de crédito supera el saldo de la factura 0001-00000001\. Hay notas de crédito pendientes de CAE sobre esa factura: N° interno \d+ por 1\.000,00\. Edítelas o elimínelas\.$/);
  });

  it('las aplicaciones solo admiten movimientos de clientes', async () => {
    const v = await prepararVentas(app, prisma);
    const { proveedorId } = await datosCompras(prisma, v.empresaId);
    await prisma.tercero.update({ where: { id: proveedorId }, data: { esCliente: true } });
    const compra = await facturaPendiente(v.http, prisma, { proveedorId, neto: 100 });
    const { mov } = await v.cobro(100, '2026-11-03', proveedorId);
    const r = await v.http.post('/api/ventas/aplicaciones', { terceroId: proveedorId, fecha: '2026-11-04', items: [{ creditoMovId: mov.id, debitoMovId: compra.movimientoId, importe: 50 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Solo se aplican comprobantes y cobros de clientes');
  });

  it('el cierre del ejercicio no se frena por una cuenta inactiva con saldo', async () => {
    const s = await sesionConPlan(app, prisma);
    const c = (codigo: string) => s.cuenta(codigo);
    await s.http.post('/api/contabilidad/asientos', { fecha: '2026-03-01', descripcion: 'Aporte', renglones: [{ cuentaContableId: await c('1.1.01.002'), debe: 1000 }, { cuentaContableId: await c('3.1.01'), haber: 1000 }] });
    await s.http.post('/api/contabilidad/asientos', { fecha: '2026-04-01', descripcion: 'Gasto', renglones: [{ cuentaContableId: await c('5.2.01'), debe: 100 }, { cuentaContableId: await c('1.1.01.002'), haber: 100 }] });
    await prisma.cuentaContable.update({ where: { id: await c('5.2.01') }, data: { activa: false } });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    for (const p of ej.periodos.slice(0, 11)) await s.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {});
    await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
    expect(r.body.message).toBeUndefined();
    expect(r.status).toBe(200);
  });

  it('rangos de fechas invertidos y nivel inválido', async () => {
    const s = await sesionConPlan(app, prisma);
    const m = await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${await s.cuenta('1.1.01.002')}&desde=2026-11-10&hasta=2026-11-01`);
    expect(m.status).toBe(400);
    expect(m.body.message).toBe('La fecha desde no puede ser posterior a la fecha hasta');
    const r = await s.http.get('/api/contabilidad/estados/resultados?nivel=abc');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Nivel inválido');
  });

  it('ARBA respeta la periodicidad configurada y un lote vacío no consume número', async () => {
    const s = await sesionConPlan(app, prisma);
    const gen = (quincena?: number) => s.http.post('/api/impuestos/presentaciones', { tipo: 'ARBA', periodo: '202611', quincena });
    const conQ = await gen(1);
    expect(conQ.status).toBe(400);
    expect(conQ.body.message).toBe('ARBA está configurada como mensual: genere el mes completo');
    const vacio = await gen();
    expect(vacio.status).toBe(201);
    expect(vacio.body.nombreArchivo).toContain('LOTE00000');
    expect(vacio.body.advertencias).toContain('Sin retenciones: declare el período sin movimiento en el sitio de ARBA (no hace falta subir el lote)');
    await s.http.put('/api/impuestos/config', { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'QUINCENAL', agipCodigoNorma: '029' });
    const sinQ = await gen();
    expect(sinQ.status).toBe(400);
    expect(sinQ.body.message).toBe('ARBA está configurada como quincenal: indique la quincena');
  });

  it('el número de IIBB se valida según la situación', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const r = await s.http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'CONVENIO', numeroIibb: '123' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.campos)).toContain('numeroIibb');
    expect((await s.http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'SIMPLIFICADO', numeroIibb: '12345678901' })).status).toBe(200);
    expect((await s.http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'CONVENIO', numeroIibb: '30712345671' })).status).toBe(200);
    expect((await s.http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'LOCAL', numeroIibb: '30712345671' })).status).toBe(200);
    expect((await s.http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'NO_INSCRIPTO', numeroIibb: null })).status).toBe(200);
  });

  it('libros IVA: fechas obligatorias y tolerancia de un centavo con el Mayor', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const sin = await v.http.get('/api/impuestos/libro-iva-ventas');
    expect(sin.status).toBe(400);
    const ajuste = async (importe: number) => v.http.post('/api/contabilidad/asientos', {
      fecha: '2026-11-10', descripcion: 'Redondeo', renglones: [{ cuentaContableId: await v.cuenta('5.2.01'), debe: importe }, { cuentaContableId: await v.cuenta('2.1.02.001'), haber: importe }],
    });
    await ajuste(0.01);
    expect((await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body.advertencias).toEqual([]);
    await ajuste(0.01);
    expect((await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body.advertencias).toHaveLength(1);
  });

  it('la huella del Libro IVA Digital es la de los TXT, no la del ZIP', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const g = (await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' })).body;
    const p = await prisma.presentacion.findUniqueOrThrow({ where: { id: g.id } });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(Buffer.from(p.contenido));
    const partes = [];
    for (const n of ['VENTAS_CBTE.txt', 'VENTAS_ALICUOTAS.txt', 'COMPRAS_CBTE.txt', 'COMPRAS_ALICUOTAS.txt']) partes.push(n, Buffer.from(await zip.file(n)!.async('uint8array')).toString('latin1'));
    const { createHash } = await import('node:crypto');
    expect(p.huella).toBe(createHash('sha256').update(partes.join('\n'), 'latin1').digest('hex'));
    // Una presentación guardada antes del cambio (huella del ZIP) no aparece como cambiada
    await prisma.presentacion.update({ where: { id: g.id }, data: { huella: createHash('sha256').update(Buffer.from(p.contenido)).digest('hex') } });
    expect((await v.http.get('/api/impuestos/presentaciones')).body[0].cambiaron).toBe(false);
  });

  it('control con ARCA: una FCE coincide con la factura A cargada', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const c = await facturaPendiente(s.http, prisma, { proveedorId, neto: 1000 });
    const comp = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: c.comprobanteId } });
    const csv = `Fecha;Tipo;Punto de Venta;Número Desde;Nro. Doc. Emisor;Imp. Neto Gravado;IVA;Imp. Total\n02/11/2026;201 - Factura de Crédito Electrónica MiPyMEs (FCE) A;1;${comp.numero};30700123452;1.000,00;210,00;1.210,00\n`;
    const r = await request(app.getHttpServer()).post('/api/impuestos/control-arca').set('Authorization', `Bearer ${s.token}`)
      .field('sentido', 'RECIBIDOS').field('desde', '2026-11-01').field('hasta', '2026-11-30').attach('archivo', Buffer.from(csv), 'mc.csv');
    expect(r.body).toMatchObject({ coinciden: 1, soloArca: [], soloSistema: [] });
  });
});
