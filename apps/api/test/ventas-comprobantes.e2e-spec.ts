import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('comprobantes de venta: alta, edición y eliminación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('alta de una factura B a consumidor final queda pendiente de CAE, sin cuenta corriente ni asiento', async () => {
    const v = await prepararVentas(app, prisma);
    const r = await v.http.post('/api/ventas/comprobantes', v.datos({
      terceroId: v.clienteCF.id,
      renglones: [{ descripcion: 'Mixto', cantidad: 2, precioUnitario: 100.125, alicuota: 21 }, { descripcion: 'Exento', cantidad: 1, precioUnitario: 10, alicuota: 'EXENTO' }],
    }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ estado: 'PENDIENTE_CAE', numero: null, letra: 'B', tipo: 'FACTURA', netoGravado: '200.25', exento: '10', iva: '42.05', total: '252.3', totalPesos: '252.3', cotizacion: '1' });
    expect(r.body.renglones).toHaveLength(2);
    expect(r.body.ivas).toEqual([expect.objectContaining({ alicuota: '21', base: '200.25', importe: '42.05' })]);
    expect(await prisma.movimientoCuentaCorriente.count({ where: { origenId: r.body.id } })).toBe(0);
    expect(await prisma.asiento.count({ where: { origenId: r.body.id } })).toBe(0);
    const cuentaVentas = await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: v.empresaId, codigo: '4.1.01' } });
    expect(r.body.renglones[0].cuentaContableId).toBe(cuentaVentas.id);
  });

  it('validaciones', async () => {
    const v = await prepararVentas(app, prisma);
    const dni = (await v.http.post('/api/terceros', { esCliente: true, razonSocial: 'Con DNI', cuit: '30123456', tipoDocumento: 'DNI', condicionIva: 'RESPONSABLE_INSCRIPTO' })).body;
    const a = await v.http.post('/api/ventas/comprobantes', v.datos({ terceroId: dni.id }));
    expect(a.status).toBe(400);
    expect(a.body.message).toBe('El cliente no tiene CUIT válido para una factura A');

    const servicios = await v.http.post('/api/ventas/comprobantes', v.datos({ concepto: 'SERVICIOS' }));
    expect(servicios.status).toBe(400);
    expect(JSON.stringify(servicios.body.campos)).toContain('fechaServicioDesde');

    const manual = (await v.http.post('/api/empresas/actual/puntos-venta', { numero: 9, electronico: false })).body;
    const pv = await v.http.post('/api/ventas/comprobantes', v.datos({ puntoVentaId: manual.id }));
    expect(pv.status).toBe(400);
    expect(pv.body.message).toBe('El punto de venta no es electrónico');

    const nc = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO' }));
    expect(nc.status).toBe(400);
    expect(JSON.stringify(nc.body.campos)).toContain('comprobanteAsociadoId');

    const usd = await v.http.post('/api/ventas/comprobantes', v.datos({ monedaCodigo: 'USD' }));
    expect(usd.status).toBe(400);
    expect(usd.body.message).toBe('No hay cotización de USD para el 02/11/2026');
    const conCot = await v.http.post('/api/ventas/comprobantes', v.datos({ monedaCodigo: 'USD', cotizacion: 1000 }));
    expect(conCot.body).toMatchObject({ total: '1210', totalPesos: '1210000', cotizacion: '1000' });
  });

  it('NC con asociado de otro cliente', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    await prisma.comprobanteVenta.update({ where: { id: fc.id }, data: { estado: 'AUTORIZADO', numero: 1, cae: '1' } });
    const r = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', terceroId: v.clienteCF.id, comprobanteAsociadoId: fc.id }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El comprobante asociado es de otro cliente');
  });

  it('edición con control de versión y eliminación de un pendiente', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    const ok = await v.http.put(`/api/ventas/comprobantes/${fc.id}`, { ...v.datos({ renglones: [{ descripcion: 'Otro', cantidad: 2, precioUnitario: 500, alicuota: 10.5 }] }), version: fc.version });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ total: '1105', version: fc.version + 1 });
    expect(ok.body.renglones).toHaveLength(1);
    const vieja = await v.http.put(`/api/ventas/comprobantes/${fc.id}`, { ...v.datos(), version: fc.version });
    expect(vieja.status).toBe(409);
    expect((await v.http.delete(`/api/ventas/comprobantes/${fc.id}`)).status).toBe(200);
    expect(await prisma.comprobanteVenta.count()).toBe(0);
  });
});
