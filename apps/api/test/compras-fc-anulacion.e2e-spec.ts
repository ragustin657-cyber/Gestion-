import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, otroUsuario, sesionConPlan } from './helpers';

let numero = 5000;

describe('anulación de comprobantes de compra', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function facturaDesdeRecepcion() {
    const s = await sesionConPlan(app, prisma);
    const d = await datosCompras(prisma, s.empresaId);
    const oc = await ocAprobada(s.http, prisma, s.empresaId, d);
    const ir = (await s.http.post('/api/compras/recepciones', { terceroId: d.proveedorId, fecha: '2026-11-06', remitoNumero: `1-${++numero}`, renglones: [{ ordenCompraRenglonId: oc.renglones[0].id, cantidad: 2 }] })).body;
    const body = {
      terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-07', fechaContable: '2026-11-07',
      monedaCodigo: 'ARS', totalDeclarado: 2420,
      renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'x', cantidad: 2, precioUnitario: 1000, alicuotaIva: 21 }],
    };
    const fc = (await s.http.post('/api/compras/comprobantes', body)).body;
    return { ...s, ...d, oc, ir, fc, body };
  }

  it('anular genera contraasiento, deja saldo 0 y libera cantidades', async () => {
    const { http, fc, ir, oc, proveedorId } = await facturaDesdeRecepcion();
    const r = await http.post(`/api/compras/comprobantes/${fc.id}/anular`, { motivo: 'Cargada por error' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ANULADO');
    const contra = await prisma.asiento.findFirstOrThrow({ where: { anulaAId: fc.asientoId }, include: { renglones: true } });
    expect(contra.id).toBe(r.body.asientoAnulacionId);
    const original = await prisma.asiento.findUniqueOrThrow({ where: { id: fc.asientoId }, include: { renglones: true } });
    for (const o of original.renglones) {
      const c = contra.renglones.find((x) => x.cuentaContableId === o.cuentaContableId)!;
      expect([c.debe.toString(), c.haber.toString()]).toEqual([o.haber.toString(), o.debe.toString()]);
    }
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: fc.id } });
    expect([mov.anulado, mov.saldo.toString(), mov.saldoPesos.toString()]).toEqual([true, '0', '0']);
    expect((await prisma.informeRecepcionRenglon.findUniqueOrThrow({ where: { id: ir.renglones[0].id } })).cantidadFacturada.toString()).toBe('0');
    expect((await prisma.ordenCompraRenglon.findUniqueOrThrow({ where: { id: oc.renglones[0].id } })).cantidadFacturada.toString()).toBe('0');
    const pend = (await http.get(`/api/compras/recepciones/pendientes-facturar?terceroId=${proveedorId}`)).body;
    expect(pend[0]).toMatchObject({ pendiente: '2' });
  });

  it('anular dos veces → 409; sin motivo → 400', async () => {
    const { http, fc } = await facturaDesdeRecepcion();
    expect((await http.post(`/api/compras/comprobantes/${fc.id}/anular`, {})).status).toBe(400);
    await http.post(`/api/compras/comprobantes/${fc.id}/anular`, { motivo: 'x' });
    const r = await http.post(`/api/compras/comprobantes/${fc.id}/anular`, { motivo: 'x' });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('El comprobante ya está anulado');
  });

  it('sin fc.anular → 403', async () => {
    const { fc, empresaId } = await facturaDesdeRecepcion();
    const u = await otroUsuario(app, prisma, empresaId, ['fc.ver', 'fc.crear']);
    expect((await u.http.post(`/api/compras/comprobantes/${fc.id}/anular`, { motivo: 'x' })).status).toBe(403);
  });

  it('después de anular, el mismo número sigue bloqueado (409)', async () => {
    const { http, fc, body } = await facturaDesdeRecepcion();
    await http.post(`/api/compras/comprobantes/${fc.id}/anular`, { motivo: 'x' });
    expect((await http.post('/api/compras/comprobantes', body)).status).toBe(409);
  });

  it('una recepción facturada no se anula hasta anular la factura', async () => {
    const { http, fc, ir } = await facturaDesdeRecepcion();
    const r = await http.post(`/api/compras/recepciones/${ir.id}/anular`, { motivo: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La recepción tiene renglones facturados');
    await http.post(`/api/compras/comprobantes/${fc.id}/anular`, { motivo: 'x' });
    expect((await http.post(`/api/compras/recepciones/${ir.id}/anular`, { motivo: 'x' })).status).toBe(200);
  });
});
