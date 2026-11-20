import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO } from '../src/contexto/contexto';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrisma } from '../src/prisma/tenant-prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('seguridad: integridad entre empresas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Empresa A con ventas, stock y pedidos; empresa B con un objeto de cada tipo. */
  const escenario = async () => {
    const a = await prepararPedidos(app, prisma);
    const b = await sesionConPlan(app, prisma);
    const e = b.empresaId;
    const depositoB = await prisma.deposito.create({ data: { empresaId: e, codigo: 'B1', nombre: 'Depósito B' } });
    const articuloB = await prisma.articulo.create({ data: { empresaId: e, codigo: 'ART-B', descripcion: 'Artículo de B', unidad: 'UN', alicuotaIva: 21 } });
    const centroB = await prisma.centroCosto.create({ data: { empresaId: e, codigo: 'CC-B', nombre: 'Centro B' } });
    const listaB = await prisma.listaPrecios.create({ data: { empresaId: e, nombre: 'Lista B', monedaCodigo: 'ARS' } });
    const { proveedorId: proveedorB } = await datosCompras(prisma, e);
    const compraB = await facturaPendiente(b.http, prisma, { proveedorId: proveedorB, neto: 1000 });
    return { a, b, depositoB, articuloB, centroB, listaB, compraB };
  };
  const esInexistente = (r: { status: number; body: { message?: string } }) => expect([r.status, /inexistente/i.test(String(r.body.message))]).toEqual([400, true]);

  it('updateManyAndReturn solo toca la empresa activa', async () => {
    const x = await escenario();
    const usuario = await prisma.usuarioEmpresa.findFirstOrThrow({ where: { empresaId: x.a.empresaId } });
    const cls = app.get(ClsService);
    await cls.run(async () => {
      cls.set(CLAVE_CONTEXTO, { usuarioId: usuario.usuarioId, empresaId: x.a.empresaId, permisos: [], superadmin: true });
      await app.get(TenantPrisma).db.deposito.updateManyAndReturn({ data: { nombre: 'Tocado' } });
    });
    expect((await prisma.deposito.findUniqueOrThrow({ where: { id: x.depositoB.id } })).nombre).toBe('Depósito B');
  });

  it('factura de venta: depósito, artículo y comprobante asociado de otra empresa', async () => {
    const x = await escenario();
    const antes = await prisma.comprobanteVenta.count();
    esInexistente(await x.a.http.post('/api/ventas/comprobantes', x.a.datos({ depositoId: x.depositoB.id })));
    esInexistente(await x.a.http.post('/api/ventas/comprobantes', x.a.datos({ renglones: [{ articuloId: x.articuloB.id, descripcion: 'X', cantidad: 1, precioUnitario: 100, alicuota: 21 }] })));
    // El comprobante asociado ya se rechazaba (400 con su propio mensaje)
    expect((await x.a.http.post('/api/ventas/comprobantes', x.a.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: x.compraB.comprobanteId }))).status).toBe(400);
    expect(await prisma.comprobanteVenta.count()).toBe(antes);
  });

  it('pedido: lista de precios y artículo de otra empresa', async () => {
    const x = await escenario();
    esInexistente(await x.a.http.post('/api/ventas/pedidos', { terceroId: x.a.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', listaPreciosId: x.listaB.id, renglones: [{ descripcion: 'X', cantidad: 1, precioUnitario: 100, alicuota: 21 }] }));
    esInexistente(await x.a.http.post('/api/ventas/pedidos', { terceroId: x.a.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', renglones: [{ articuloId: x.articuloB.id, descripcion: 'X', cantidad: 1, precioUnitario: 100, alicuota: 21 }] }));
  });

  it('remito: artículo y depósito de otra empresa', async () => {
    const x = await escenario();
    esInexistente(await x.a.remito([{ articuloId: x.articuloB.id, descripcion: 'X', cantidad: 1 }]));
    esInexistente(await x.a.remito([{ descripcion: 'X', cantidad: 1 }], { depositoId: x.depositoB.id }));
  });

  it('factura de compra: artículo, centro de costo, depósito y comprobante asociado de otra empresa', async () => {
    const x = await escenario();
    const { proveedorId } = await datosCompras(prisma, x.a.empresaId);
    const base = (o: Record<string, unknown> = {}, r: Record<string, unknown> = {}) => ({
      terceroId: proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 9, numero: 1, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS', totalDeclarado: 121,
      renglones: [{ origen: 'DIRECTO', descripcion: 'X', cantidad: 1, precioUnitario: 100, alicuotaIva: 21, ...r }], ...o,
    });
    esInexistente(await x.a.http.post('/api/compras/comprobantes', base({}, { articuloId: x.articuloB.id })));
    esInexistente(await x.a.http.post('/api/compras/comprobantes', base({}, { centroCostoId: x.centroB.id })));
    esInexistente(await x.a.http.post('/api/compras/comprobantes', base({ depositoId: x.depositoB.id })));
    esInexistente(await x.a.http.post('/api/compras/comprobantes', base({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: x.compraB.comprobanteId })));
  });

  it('aplicación de un cobro a una compra del mismo tercero', async () => {
    const x = await escenario();
    await prisma.tercero.update({ where: { id: x.a.clienteRI.id }, data: { esProveedor: true } });
    const { mov: cobro } = await x.a.cobro(1000);
    const compra = await prisma.movimientoCuentaCorriente.create({
      data: { empresaId: x.a.empresaId, terceroId: x.a.clienteRI.id, origenTipo: 'COMPRA', origenId: cobro.id, fecha: new Date('2026-11-02T00:00:00Z'), fechaVencimiento: new Date('2026-11-02T00:00:00Z'), monedaCodigo: 'ARS', importe: 1000, importePesos: 1000, saldo: 1000, saldoPesos: 1000 },
    });
    const r = await x.a.http.post('/api/ventas/aplicaciones', { terceroId: x.a.clienteRI.id, fecha: '2026-11-04', items: [{ creditoMovId: cobro.id, debitoMovId: compra.id, importe: 100 }] });
    expect(r.status).toBe(400);
  });

  it('la sucursal del usuario tiene clave foránea', async () => {
    const x = await escenario();
    const ue = await prisma.usuarioEmpresa.findFirstOrThrow({ where: { empresaId: x.a.empresaId } });
    await expect(prisma.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: ue.usuarioId, empresaId: ue.empresaId } }, data: { sucursalId: '00000000-0000-4000-8000-000000000000' } })).rejects.toThrow();
  });
});
