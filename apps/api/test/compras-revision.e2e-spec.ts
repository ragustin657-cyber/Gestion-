import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, sesionConPlan } from './helpers';

let numero = 20000;

describe('compras: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function preparar() {
    const s = await sesionConPlan(app, prisma);
    const d = await datosCompras(prisma, s.empresaId);
    const oc = await ocAprobada(s.http, prisma, s.empresaId, d);
    const recibir = async (cantidad: number) => {
      const r = await s.http.post('/api/compras/recepciones', { terceroId: d.proveedorId, fecha: '2026-11-06', remitoNumero: `1-${++numero}`, renglones: [{ ordenCompraRenglonId: oc.renglones[0].id, cantidad }] });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string; renglones: { id: string }[] };
    };
    const factura = (renglones: object[], total: number) => s.http.post('/api/compras/comprobantes', {
      terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-07', fechaContable: '2026-11-07',
      monedaCodigo: 'ARS', totalDeclarado: total, renglones,
    });
    const deIR = (id: string, cantidad: number) => ({ origen: 'RECEPCION', informeRecepcionRenglonId: id, descripcion: 'x', cantidad, precioUnitario: 1000, alicuotaIva: 21 });
    const deOC = (cantidad: number) => ({ origen: 'ORDEN_COMPRA', ordenCompraRenglonId: oc.renglones[0].id, descripcion: 'x', cantidad, precioUnitario: 1000, alicuotaIva: 21 });
    return { ...s, ...d, oc, recibir, factura, deIR, deOC };
  }

  it('el mismo renglón de recepción dos veces en una factura → 422 por cantidad', async () => {
    const { recibir, factura, deIR } = await preparar();
    const ir = await recibir(4);
    const r = await factura([deIR(ir.renglones[0].id, 4), deIR(ir.renglones[0].id, 4)], 9680);
    expect(r.status).toBe(422);
    expect(r.body.diferencias[0]).toMatchObject({ tipo: 'CANTIDAD', esperado: '4', facturado: '8' });
  });

  it('facturar por la OC y otra vez por la recepción → 422 por cantidad', async () => {
    const { recibir, factura, deIR, deOC } = await preparar();
    expect((await factura([deOC(10)], 12100)).status).toBe(201);
    const ir = await recibir(10);
    const r = await factura([deIR(ir.renglones[0].id, 10)], 12100);
    expect(r.status).toBe(422);
    expect(r.body.diferencias[0]).toMatchObject({ tipo: 'CANTIDAD', esperado: '0' });
  });

  it('una OC cerrada sigue cumplida aunque se anule una recepción', async () => {
    const { http, oc, recibir } = await preparar();
    const ir = await recibir(3);
    await recibir(2);
    const actual = (await http.get(`/api/compras/ordenes/${oc.id}`)).body;
    expect((await http.post(`/api/compras/ordenes/${oc.id}/cerrar`, { version: actual.version, motivo: 'No entregan más' })).body.estado).toBe('CUMPLIDA');
    expect((await http.post(`/api/compras/recepciones/${ir.id}/anular`, { motivo: 'error' })).status).toBe(200);
    expect((await http.get(`/api/compras/ordenes/${oc.id}`)).body.estado).toBe('CUMPLIDA');
  });

  it('editar un borrador mientras se confirma no altera una OC ya confirmada', async () => {
    const { http, proveedorId, empresaId } = await preparar();
    await prisma.empresa.update({ where: { id: empresaId }, data: { montoAprobacionOc: 10000 } });
    const barata = { terceroId: proveedorId, fecha: '2026-11-05', monedaCodigo: 'ARS', renglones: [{ descripcion: 'barato', cantidad: 1, precioUnitario: 100, alicuotaIva: 21 }] };
    const cara = { ...barata, renglones: [{ descripcion: 'caro', cantidad: 1000, precioUnitario: 100000, alicuotaIva: 21 }] };
    for (let i = 0; i < 15; i++) {
      const b = (await http.post('/api/compras/ordenes', barata)).body;
      await Promise.all([http.patch(`/api/compras/ordenes/${b.id}`, cara), http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })]);
      const oc = await prisma.ordenCompra.findUniqueOrThrow({ where: { id: b.id } });
      if (oc.estado === 'APROBADA') expect(oc.total.toNumber()).toBeLessThanOrEqual(10000);
      if (oc.estado !== 'BORRADOR') expect(oc.totalPesos.toString()).toBe(oc.total.toString());
    }
  });

  it('eliminar un borrador ya confirmado → 400', async () => {
    const { http, proveedorId } = await preparar();
    const b = (await http.post('/api/compras/ordenes', { terceroId: proveedorId, fecha: '2026-11-05', monedaCodigo: 'ARS', renglones: [{ descripcion: 'x', cantidad: 1, precioUnitario: 1, alicuotaIva: 21 }] })).body;
    await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version });
    expect((await http.delete(`/api/compras/ordenes/${b.id}`)).status).toBe(400);
  });
});
