import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('comisiones: liquidación mensual', () => {
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
    if (emp.status !== 201) throw new Error(JSON.stringify(emp.body));
    const empleadoId = emp.body.id as string;
    const perez = (await v.http.post('/api/ventas/vendedores', { nombre: 'Pérez', tipo: 'EMPLEADO', porcentaje: 3, empleadoId })).body as { id: string };
    const prov = await v.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Ruiz SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    const ruiz = (await v.http.post('/api/ventas/vendedores', { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: prov.body.id })).body as { id: string };
    await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { vendedorId: perez.id });
    const c210 = await prisma.concepto.findFirstOrThrow({ where: { empresaId: v.empresaId, codigo: '210' } });
    const recibo = async (fc: { id: string }, importe: number, fecha = '2026-11-05') => {
      const r = await v.http.post('/api/ventas/recibos', {
        terceroId: v.clienteRI.id, fecha, puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe }, cheques: [], transferencias: [], retenciones: [], aplicaciones: [{ comprobanteId: fc.id, importe }],
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    /** Ventas de noviembre: Pérez 30 (1.210 cobrados) y Ruiz 50 (factura de 1.000 + IVA con Ruiz). */
    const ventasNoviembre = async () => {
      await recibo(await v.factura(), 1210);
      await recibo(await v.factura({ vendedorId: ruiz.id }), 1210);
    };
    const mensual = async (mes = 11) => (await v.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes, fechaPago: `2026-${mes}-28` })).body as { id: string };
    const confirmar = (mes = 11, http = v.http) => http.post('/api/ventas/comisiones', { anio: 2026, mes });
    const reciboSueldo = async (liquidacionId: string) => {
      const l = (await v.http.get(`/api/sueldos/liquidaciones/${liquidacionId}`)).body as { recibos: { empleadoId: string; renglones: { codigo: string; importe: string }[] }[] };
      return l.recibos.find((r) => r.empleadoId === empleadoId)!;
    };
    return { ...v, empleadoId, perez, ruiz, c210, recibo, ventasNoviembre, mensual, confirmar, reciboSueldo };
  };

  it('confirmar carga la novedad', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.ventasNoviembre();
    const r = await x.confirmar();
    expect(r.status).toBe(201);
    expect(r.body.vendedores.map((y: { nombre: string; comision: string }) => [y.nombre, y.comision])).toEqual([['Pérez', '30.00'], ['Ruiz', '50.00']]);
    const nov = await prisma.novedad.findMany({ where: { liquidacionId: m.id } });
    expect(nov.map((n) => [n.empleadoId, n.conceptoId, n.importe?.toFixed(2), n.detalle, n.liquidacionComisionesId])).toEqual([[x.empleadoId, x.c210.id, '30.00', 'Comisiones 11/2026', r.body.id]]);
    expect((await x.reciboSueldo(m.id)).renglones.find((y) => y.codigo === '210')?.importe).toBe('30.00');
    expect((await x.http.get('/api/ventas/comisiones?anio=2026&mes=11')).body.vendedores).toEqual([]);
  });

  it('no se liquida dos veces', async () => {
    const x = await escenario();
    await x.mensual();
    await x.ventasNoviembre();
    await x.confirmar();
    const r = await x.confirmar();
    expect([r.status, r.body.message]).toEqual([400, 'Las comisiones de 11/2026 ya están liquidadas']);
  });

  it('confirmaciones simultáneas', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.ventasNoviembre();
    const rs = await Promise.all([x.confirmar(), x.confirmar()]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.novedad.count({ where: { liquidacionId: m.id } })).toBe(1);
  });

  it('novedades manuales después', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.ventasNoviembre();
    await x.confirmar();
    const put = await x.http.put(`/api/sueldos/liquidaciones/${m.id}/novedades`, { empleadoId: x.empleadoId, novedades: [{ tipo: 'IMPORTE', conceptoId: x.c210.id, importe: 100 }] });
    expect(put.status).toBe(200);
    expect(await prisma.novedad.count({ where: { liquidacionId: m.id, liquidacionComisionesId: { not: null } } })).toBe(1);
    expect((await x.reciboSueldo(m.id)).renglones.find((y) => y.codigo === '210')?.importe).toBe('130.00');
  });

  it('mensual cerrada o inexistente', async () => {
    const x = await escenario();
    await x.ventasNoviembre();
    const r = await x.confirmar();
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación mensual de sueldos de 11/2026 no está en borrador: créela o reábrala antes de confirmar las comisiones']);
    const m = await x.mensual();
    expect((await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`)).status).toBe(201);
    expect((await x.confirmar()).status).toBe(400);
  });

  it('empleado con final en borrador', async () => {
    const x = await escenario();
    await x.ventasNoviembre();
    const f = await x.http.post('/api/sueldos/egresos', { empleadoId: x.empleadoId, causa: 'RENUNCIA', fechaEgreso: '2026-11-15', preavisoOtorgado: true, fechaPago: '2026-11-19' });
    expect(f.status).toBe(201);
    const fin = await prisma.liquidacion.findFirstOrThrow({ where: { empresaId: x.empresaId, tipo: 'FINAL' } });
    expect((await x.confirmar()).status).toBe(201);
    expect((await prisma.novedad.findFirstOrThrow({ where: { liquidacionComisionesId: { not: null } } })).liquidacionId).toBe(fin.id);
  });

  it('ajuste por anulación en el mes siguiente', async () => {
    const x = await escenario();
    await x.mensual(10);
    const fc = await x.factura({ fecha: '2026-10-10', fechaVencimiento: '2026-11-10' });
    const r = await x.recibo(fc, 1210, '2026-10-20');
    expect((await x.confirmar(10)).status).toBe(201);
    expect((await x.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    const [p] = (await x.http.get('/api/ventas/comisiones?anio=2026&mes=11')).body.vendedores;
    expect([p.comision, p.liquidable, p.detalle.map((d: { tipo: string }) => d.tipo)]).toEqual(['-30.00', false, ['ANULACION']]);
  });

  it('orden', async () => {
    const x = await escenario();
    await x.mensual(10);
    await x.mensual(11);
    await x.recibo(await x.factura({ fecha: '2026-10-10', fechaVencimiento: '2026-11-10' }), 1210, '2026-10-20');
    expect((await x.confirmar(10)).status).toBe(201);
    await x.ventasNoviembre();
    expect((await x.confirmar(11)).status).toBe(201);
    const sep = await x.confirmar(9);
    expect([sep.status, sep.body.message]).toEqual([400, 'Ya hay una liquidación de comisiones de un mes posterior']);
    const oct = await prisma.liquidacionComisiones.findFirstOrThrow({ where: { empresaId: x.empresaId, mes: 10 } });
    const an = await x.http.post(`/api/ventas/comisiones/liquidaciones/${oct.id}/anular`, { motivo: 'x' });
    expect([an.status, an.body.message]).toEqual([400, 'Anule primero la liquidación de comisiones de 11/2026']);
  });

  it('anular', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.ventasNoviembre();
    const l = (await x.confirmar()).body as { id: string };
    const an = await x.http.post(`/api/ventas/comisiones/liquidaciones/${l.id}/anular`, { motivo: 'Error' });
    expect(an.status).toBe(201);
    expect(await prisma.novedad.count({ where: { liquidacionId: m.id } })).toBe(0);
    expect((await prisma.liquidacionComisiones.findUniqueOrThrow({ where: { id: l.id } })).estado).toBe('ANULADA');
    expect(await prisma.liquidacionComisionesRenglon.count({ where: { liquidacionId: l.id, anulado: false } })).toBe(0);
    expect((await x.http.get('/api/ventas/comisiones?anio=2026&mes=11')).body.vendedores).toHaveLength(2);
    expect((await x.confirmar()).status).toBe(201);
    const lista = (await x.http.get('/api/ventas/comisiones/liquidaciones')).body as { estado: string; total: string }[];
    expect(lista.map((y) => [y.estado, y.total])).toEqual([['CONFIRMADA', '80.00'], ['ANULADA', '80.00']]);
  });

  it('PDF del externo', async () => {
    const x = await escenario();
    await x.mensual();
    await x.ventasNoviembre();
    const l = (await x.confirmar()).body as { id: string };
    const r = await x.http.get(`/api/ventas/comisiones/liquidaciones/${l.id}/pdf?vendedorId=${x.ruiz.id}`);
    expect([r.status, r.headers['content-type']]).toEqual([200, 'application/pdf']);
  });

  it('permisos', async () => {
    const x = await escenario();
    await x.mensual();
    await x.ventasNoviembre();
    const u = await otroUsuario(app, prisma, x.empresaId, ['venta.ver']);
    expect((await x.confirmar(11, u.http)).status).toBe(403);
    expect((await u.http.get('/api/ventas/comisiones?anio=2026&mes=11')).status).toBe(200);
  });
});
