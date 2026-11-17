import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('comisiones: revisión final', () => {
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
    const categoria = await prisma.categoria.findFirstOrThrow({ where: { empresaId: v.empresaId, nombre: 'Vendedor B' } });
    for (const mes of [10, 11]) await v.http.put('/api/sueldos/escalas', { categoriaId: categoria.id, anio: 2026, mes, basico: 1000000 });
    const emp = await v.http.post('/api/sueldos/empleados', {
      apellido: 'Pérez', nombre: 'Juan', cuil: '20-12345678-6', domicilio: 'San Martín 100', fechaIngreso: '2021-03-01', categoriaId: categoria.id,
      afiliadoSindicato: true, obraSocial: 'OSECAC', codigoObraSocial: '125000', formaPago: 'TRANSFERENCIA',
    });
    const empleadoId = emp.body.id as string;
    const perez = (await v.http.post('/api/ventas/vendedores', { nombre: 'Pérez', tipo: 'EMPLEADO', porcentaje: 3, empleadoId })).body as { id: string };
    const prov = await v.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Ruiz SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    const ruiz = (await v.http.post('/api/ventas/vendedores', { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: prov.body.id })).body as { id: string };
    await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { vendedorId: perez.id });
    const recibo = async (fc: { id: string }, importe: number, fecha = '2026-11-05') => {
      const r = await v.http.post('/api/ventas/recibos', {
        terceroId: v.clienteRI.id, fecha, puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe }, cheques: [], transferencias: [], retenciones: [], aplicaciones: [{ comprobanteId: fc.id, importe }],
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const mensual = async (mes = 11) => (await v.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes, fechaPago: `2026-${mes}-28` })).body as { id: string };
    const confirmar = (mes = 11) => v.http.post('/api/ventas/comisiones', { anio: 2026, mes });
    return { ...v, empleadoId, perez, ruiz, recibo, mensual, confirmar };
  };

  it('empleado sin recibo en el mes: no se pierde la comisión', async () => {
    const x = await escenario();
    // Egreso en octubre (final cerrada): en noviembre ya no tiene recibo en la mensual
    const f = await x.http.post('/api/sueldos/egresos', { empleadoId: x.empleadoId, causa: 'RENUNCIA', fechaEgreso: '2026-10-20', preavisoOtorgado: true, fechaPago: '2026-10-25' });
    expect(f.status).toBe(201);
    const fin = await prisma.liquidacion.findFirstOrThrow({ where: { empresaId: x.empresaId, tipo: 'FINAL' } });
    expect((await x.http.post(`/api/sueldos/liquidaciones/${fin.id}/cerrar`)).status).toBe(201);
    await x.mensual();
    await x.recibo(await x.factura(), 1210);
    const r = await x.confirmar();
    expect([r.status, r.body.message]).toEqual([400, 'La comisión de Pérez, Juan no se puede cargar en la liquidación de 11/2026: el empleado no tiene recibo o el concepto de comisiones no se le aplica']);
    expect(await prisma.liquidacionComisiones.count({ where: { empresaId: x.empresaId } })).toBe(0);
  });

  it('no se elimina una liquidación de sueldos con comisiones cargadas', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.recibo(await x.factura(), 1210);
    expect((await x.confirmar()).status).toBe(201);
    const r = await x.http.delete(`/api/sueldos/liquidaciones/${m.id}`);
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación tiene comisiones cargadas: anule primero la liquidación de comisiones de 11/2026']);
  });

  it('cobro anulado después de un rechazo ya liquidado: se descuenta solo lo pagado neto', async () => {
    const x = await escenario();
    const fc = await x.factura({ vendedorId: x.ruiz.id });
    const { mov } = await x.cobro(1210, '2026-11-03');
    const deb = await x.movDe(fc.id);
    expect((await x.http.post('/api/ventas/aplicaciones', { terceroId: x.clienteRI.id, fecha: '2026-11-04', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 1210 }] })).status).toBe(201);
    const ap = await prisma.aplicacionCobro.findFirstOrThrow({ where: { empresaId: x.empresaId, debitoMovId: deb.id } });
    // Pagados: el cobro (50) en octubre y un rechazo (−20) en noviembre; después se deshace la aplicación
    const liq = (mes: number, tipo: 'COBRO' | 'RECHAZO', comision: number, chequeId: string | null = null, numero = mes) =>
      prisma.liquidacionComisiones.create({ data: { empresaId: x.empresaId, numero, anio: 2026, mes, fecha: new Date(Date.UTC(2026, mes, 0)), creadoPor: 't', renglones: { create: [{ empresaId: x.empresaId, vendedorId: x.ruiz.id, tipo, aplicacionId: ap.id, comprobanteId: fc.id, chequeId, cobrado: 1210, neto: 1000, porcentaje: 5, comision }] } } });
    await liq(9, 'COBRO', 50);
    await liq(10, 'RECHAZO', -20, '00000000-0000-0000-0000-000000000001');
    await prisma.aplicacionCobro.update({ where: { id: ap.id }, data: { anulada: true } });
    const [p] = (await x.http.get('/api/ventas/comisiones?anio=2026&mes=11')).body.vendedores;
    expect(p.detalle.map((d: { tipo: string; comision: string }) => [d.tipo, d.comision])).toEqual([['ANULACION', '-30.00']]);
  });

  it('concepto de comisiones con convenio: inválido', async () => {
    const x = await escenario();
    const cfg = (await x.http.get('/api/sueldos/configuracion')).body;
    const conv = await prisma.convenio.findFirstOrThrow({ where: { empresaId: x.empresaId } });
    const c = await prisma.concepto.create({ data: { empresaId: x.empresaId, convenioId: conv.id, codigo: '211', nombre: 'Comisiones Comercio', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', orden: 211 } });
    const body = { cuentaSueldosId: cfg.cuentaSueldosId, cuentaContribucionesId: cfg.cuentaContribucionesId, cuentaSueldosAPagarId: cfg.cuentaSueldosAPagarId, cuentaCargasSocialesId: cfg.cuentaCargasSocialesId, cuentaRetencionesSindicalesId: cfg.cuentaRetencionesSindicalesId, conceptoComisionesId: c.id };
    const r = await x.http.put('/api/sueldos/configuracion', body);
    expect([r.status, r.body.message]).toEqual([400, 'Concepto de comisiones inválido: debe ser fijo, activo, no de descuento, sin convenio y para todos los empleados']);
  });

  it('un vendedor inactivo no traba la edición del cliente', async () => {
    const x = await escenario();
    const p = await prisma.tercero.findFirstOrThrow({ where: { razonSocial: 'Ruiz SRL' } });
    await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { vendedorId: x.ruiz.id });
    await x.http.put(`/api/ventas/vendedores/${x.ruiz.id}`, { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: p.id, activo: false });
    const r = await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { telefono: '4444-5555', vendedorId: x.ruiz.id });
    expect(r.status).toBe(200);
  });

  it('rendimiento: la consulta indexa los renglones liquidados', async () => {
    const x = await escenario();
    const m = await x.mensual();
    for (let i = 0; i < 3; i++) await x.recibo(await x.factura(), 1210);
    expect((await x.confirmar()).status).toBe(201);
    expect(m.id).toBeTruthy();
    await x.recibo(await x.factura(), 1210);
    const [p] = (await x.http.get('/api/ventas/comisiones?anio=2026&mes=11')).body.vendedores;
    expect([p.renglones, p.comision]).toEqual([1, '30.00']);
  });
});
