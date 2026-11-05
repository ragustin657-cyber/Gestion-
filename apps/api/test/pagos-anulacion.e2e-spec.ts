import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase, otroUsuario } from './helpers';
import { prepararPagos } from './helpers-pagos';

describe('anulación de órdenes de pago pagadas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function pagoCombinado() {
    const p = await prepararPagos(app, prisma, { regimen: '94', iibb: 2 });
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 121000 }]);
    const r = await p.pagar(op, [
      { tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 100000, cuentaBancariaId: p.ars.id },
      { tipo: 'CHEQUE', monedaCodigo: 'ARS', importe: 18343.4, chequeraId: p.echeq.id, chequeNumero: 'E-1', chequeFechaPago: '2026-12-15' },
    ]);
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return { ...p, f, pagada: r.body as { id: string; version: number; asientoId: string } };
  }

  it('anular una OP pagada revierte todo', async () => {
    const { http, f, pagada, proveedorId } = await pagoCombinado();
    const r = await http.post(`/api/pagos/ordenes/${pagada.id}/anular`, { version: pagada.version, motivo: 'Pago duplicado' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ANULADA');
    const m = await prisma.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: f.movimientoId } });
    expect([m.saldo.toString(), m.saldoPesos.toString()]).toEqual(['121000', '121000']);
    expect((await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: pagada.id, importe: { gt: 0 } } })).every((x) => x.anulada)).toBe(true);
    expect(await prisma.chequePropio.count({ where: { estado: 'ANULADO' } })).toBe(1);
    expect(await prisma.movimientoTesoreria.count({ where: { anulado: false } })).toBe(0);
    expect(await prisma.aplicacionCuentaCorriente.count({ where: { anulada: false } })).toBe(0);
    const contra = await prisma.asiento.findFirstOrThrow({ where: { anulaAId: pagada.asientoId }, include: { renglones: true } });
    expect(contra.id).toBe(r.body.asientoAnulacionId);
    const orig = await prisma.asiento.findUniqueOrThrow({ where: { id: pagada.asientoId }, include: { renglones: true } });
    for (const o of orig.renglones) {
      const c = contra.renglones.find((x) => x.cuentaContableId === o.cuentaContableId)!;
      expect([c.debe.toString(), c.haber.toString()]).toEqual([o.haber.toString(), o.debe.toString()]);
    }
    expect((await http.get(`/api/pagos/pendientes?terceroId=${proveedorId}`)).body[0]).toMatchObject({ disponible: '121000' });
  });

  it('anular dos veces → 409; sin op.anular → 403', async () => {
    const { http, pagada, empresaId } = await pagoCombinado();
    const u = await otroUsuario(app, prisma, empresaId, ['op.ver']);
    expect((await u.http.post(`/api/pagos/ordenes/${pagada.id}/anular`, { version: pagada.version, motivo: 'x' })).status).toBe(403);
    const r = (await http.post(`/api/pagos/ordenes/${pagada.id}/anular`, { version: pagada.version, motivo: 'x' })).body;
    const dos = await http.post(`/api/pagos/ordenes/${pagada.id}/anular`, { version: r.version, motivo: 'x' });
    expect(dos.status).toBe(409);
    expect(dos.body.message).toBe('La orden de pago ya está anulada');
  });

  it('no se puede anular si su anticipo ya se aplicó', async () => {
    const p = await prepararPagos(app, prisma);
    const op = await p.opAprobada([], { anticipo: { monedaCodigo: 'ARS', importe: 5000 } });
    const pagada = (await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 5000, cuentaBancariaId: p.ars.id }])).body;
    const ant = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'ANTICIPO' } });
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 5000 });
    const op2 = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 6050 }, { movimientoId: ant.id, importe: -5000 }]);
    await p.pagar(op2, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1050, cuentaBancariaId: p.ars.id }]);
    const r = await p.http.post(`/api/pagos/ordenes/${pagada.id}/anular`, { version: pagada.version, motivo: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El anticipo de esta orden ya fue aplicado');
  });
});
