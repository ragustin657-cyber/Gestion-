import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('comisiones: vendedor en clientes, pedidos y comprobantes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const e = await prepararPedidos(app, prisma);
    const vendedor = async (nombre: string, cuit: string, porcentaje: number) => {
      const p = await e.http.post('/api/terceros', { esProveedor: true, razonSocial: `${nombre} SRL`, cuit, condicionIva: 'RESPONSABLE_INSCRIPTO' });
      if (p.status !== 201) throw new Error(JSON.stringify(p.body));
      const v = await e.http.post('/api/ventas/vendedores', { nombre, tipo: 'EXTERNO', porcentaje, proveedorId: p.body.id });
      if (v.status !== 201) throw new Error(JSON.stringify(v.body));
      return v.body as { id: string };
    };
    const perez = await vendedor('Pérez', '30-71234567-1', 3);
    const ruiz = await vendedor('Ruiz', '30-70123456-8', 5);
    await e.http.patch(`/api/terceros/${e.clienteRI.id}`, { vendedorId: perez.id });
    const comprobante = async (o: Record<string, unknown> = {}) => {
      const r = await e.http.post('/api/ventas/comprobantes', { ...e.datos(o), emitir: true });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: r.body.id } });
    };
    return { ...e, perez, ruiz, comprobante };
  };
  const pct = (c: { comisionPct: { toFixed: (n: number) => string } | null }) => c.comisionPct?.toFixed(2) ?? null;

  it('el cliente propone su vendedor', async () => {
    const x = await escenario();
    expect((await prisma.tercero.findUniqueOrThrow({ where: { id: x.clienteRI.id } })).vendedorId).toBe(x.perez.id);
    const f = await x.comprobante();
    expect([f.vendedorId, pct(f)]).toEqual([x.perez.id, '3.00']);
  });

  it('el porcentaje se copia al emitir', async () => {
    const x = await escenario();
    const f = await x.comprobante();
    const p = await prisma.tercero.findFirstOrThrow({ where: { razonSocial: 'Pérez SRL' } });
    expect((await x.http.put(`/api/ventas/vendedores/${x.perez.id}`, { nombre: 'Pérez', tipo: 'EXTERNO', porcentaje: 4, proveedorId: p.id })).status).toBe(200);
    expect(pct(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: f.id } }))).toBe('3.00');
    expect(pct(await x.comprobante())).toBe('4.00');
  });

  it('vendedor explícito o ninguno', async () => {
    const x = await escenario();
    const r = await x.comprobante({ vendedorId: x.ruiz.id });
    expect([r.vendedorId, pct(r)]).toEqual([x.ruiz.id, '5.00']);
    const n = await x.comprobante({ vendedorId: null });
    expect([n.vendedorId, pct(n)]).toEqual([null, null]);
  });

  it('desde un pedido', async () => {
    const x = await escenario();
    const srv = await prisma.articulo.create({ data: { empresaId: x.empresaId, codigo: 'SRV', descripcion: 'Flete', alicuotaIva: 21, esServicio: true } });
    const p = await x.pedido([x.renglon(srv.id, 1, 5000)], { confirmar: true, vendedorId: x.ruiz.id });
    expect((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: p.id } })).vendedorId).toBe(x.ruiz.id);
    const f = await x.comprobante({ renglones: [{ origen: 'PEDIDO', pedidoRenglonId: p.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 5000, alicuota: 21 }] });
    expect([f.vendedorId, pct(f)]).toEqual([x.ruiz.id, '5.00']);
  });

  it('la NC hereda', async () => {
    const x = await escenario();
    const f = await x.comprobante();
    const nc = await x.comprobante({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.id, vendedorId: x.ruiz.id, renglones: [{ descripcion: 'Devolución', cantidad: 1, precioUnitario: 500, alicuota: 21 }] });
    expect([nc.vendedorId, pct(nc)]).toEqual([x.perez.id, '3.00']);
  });

  it('vendedor inactivo', async () => {
    const x = await escenario();
    const p = await prisma.tercero.findFirstOrThrow({ where: { razonSocial: 'Ruiz SRL' } });
    await x.http.put(`/api/ventas/vendedores/${x.ruiz.id}`, { nombre: 'Ruiz', tipo: 'EXTERNO', porcentaje: 5, proveedorId: p.id, activo: false });
    const r = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ vendedorId: x.ruiz.id }), emitir: true });
    expect([r.status, r.body.message]).toEqual([400, 'Vendedor inválido']);
  });
});
