import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';
import { prepararTesoreria } from './helpers-tesoreria';
import { prepararVentas } from './helpers-ventas';

describe('pulido 26: tarjetas y comisiones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('fecha de la liquidación de tarjeta', async () => {
    const t = await prepararTesoreria(app, prisma);
    const visa = (await t.http.post('/api/tesoreria/tarjetas', { nombre: 'Visa', tipo: 'CREDITO', cuentaBancariaId: t.ars.id })).body as { id: string };
    const ing = await t.http.post('/api/tesoreria/ingresos', { fecha: '2026-11-05', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobranza', cupones: [{ tarjetaId: visa.id, numero: '1001', importe: 100 }, { tarjetaId: visa.id, numero: '1002', importe: 200 }] });
    const cupones = await prisma.cuponTarjeta.findMany({ where: { ingresoId: ing.body.id } });
    await prisma.cuponTarjeta.updateMany({ where: { ingresoId: ing.body.id, numero: '1001' }, data: { fecha: new Date('2026-11-03') } });
    const r = await t.http.post('/api/tesoreria/liquidaciones-tarjeta', { tarjetaId: visa.id, fecha: '2026-11-04', cuponIds: cupones.map((c) => c.id), arancel: 0, ivaArancel: 0, impuestos: [], neto: 300 });
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación no puede ser anterior al cupón 1002 (05/11/2026)']);
    expect((await t.http.post('/api/tesoreria/liquidaciones-tarjeta', { tarjetaId: visa.id, fecha: '2026-11-05', cuponIds: cupones.map((c) => c.id), arancel: 0, ivaArancel: 0, impuestos: [], neto: 300 })).status).toBe(201);
  });

  it('tarjetas simultáneas', async () => {
    const t = await prepararTesoreria(app, prisma);
    const alta = () => t.http.post('/api/tesoreria/tarjetas', { nombre: 'Visa', tipo: 'CREDITO', cuentaBancariaId: t.ars.id });
    const rs = await Promise.all([alta(), alta()]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(rs.find((r) => r.status === 400)!.body.message).toBe('Ya existe la tarjeta Visa');
  });

  it('concepto de comisiones activo', async () => {
    const v = await prepararVentas(app, prisma);
    const conceptos = (await v.http.get('/api/sueldos/conceptos')).body as Record<string, unknown>[];
    const put = (codigo: string) => {
      const { id, empresaId: _e, ...c } = conceptos.find((x) => x.codigo === codigo)!;
      return v.http.put(`/api/sueldos/conceptos/${id}`, { ...c, activo: false });
    };
    const r = await put('210');
    expect([r.status, r.body.message]).toEqual([400, 'Es el concepto de comisiones de vendedores: elija otro en la configuración de sueldos antes de desactivarlo']);
    expect((await put('130')).status).toBe(200);
  });

  it('pedido con vendedor inactivo del cliente', async () => {
    const e = await prepararPedidos(app, prisma);
    const prov = await e.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Ruiz SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    const ruiz = (await e.http.post('/api/ventas/vendedores', { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: prov.body.id })).body as { id: string };
    await e.http.patch(`/api/terceros/${e.clienteRI.id}`, { vendedorId: ruiz.id });
    await e.http.put(`/api/ventas/vendedores/${ruiz.id}`, { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: prov.body.id, activo: false });
    const p = await e.pedido([e.renglon(null, 1, 1000)]);
    expect((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: p.id } })).vendedorId).toBeNull();
  });

  it('externos del historial', async () => {
    const v = await prepararVentas(app, prisma);
    const categoria = await prisma.categoria.findFirstOrThrow({ where: { empresaId: v.empresaId, nombre: 'Vendedor B' } });
    await v.http.put('/api/sueldos/escalas', { categoriaId: categoria.id, anio: 2026, mes: 11, basico: 1000000 });
    const emp = await v.http.post('/api/sueldos/empleados', { apellido: 'Pérez', nombre: 'Juan', cuil: '20-12345678-6', domicilio: 'x', fechaIngreso: '2021-03-01', categoriaId: categoria.id, afiliadoSindicato: false, obraSocial: 'OSECAC', codigoObraSocial: '125000', formaPago: 'TRANSFERENCIA' });
    const perez = (await v.http.post('/api/ventas/vendedores', { nombre: 'Pérez', tipo: 'EMPLEADO', porcentaje: 3, empleadoId: emp.body.id })).body as { id: string };
    const prov = await v.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Ruiz SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    const ruiz = (await v.http.post('/api/ventas/vendedores', { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: prov.body.id })).body as { id: string };
    await v.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-28' });
    for (const vendedorId of [perez.id, ruiz.id]) {
      const fc = await v.factura({ vendedorId });
      await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-05', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1210 }, cheques: [], transferencias: [], retenciones: [], aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }] });
    }
    const l = await v.http.post('/api/ventas/comisiones', { anio: 2026, mes: 11 });
    expect(l.status).toBe(201);
    const externos = async () => ((await v.http.get('/api/ventas/comisiones/liquidaciones')).body as { externos: { vendedorId: string; nombre: string }[] }[])[0].externos;
    expect(await externos()).toEqual([{ vendedorId: ruiz.id, nombre: 'Ruiz' }]);
    expect((await v.http.post(`/api/ventas/comisiones/liquidaciones/${l.body.id}/anular`, { motivo: 'x' })).status).toBe(201);
    expect(await externos()).toEqual([{ vendedorId: ruiz.id, nombre: 'Ruiz' }]);
  });
});
