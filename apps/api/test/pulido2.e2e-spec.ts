import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, otroUsuario } from './helpers';
import { escenarioEjemplo } from './helpers-ajuste';
import { prepararPedidos } from './helpers-pedidos';

const NADA = '00000000-0000-4000-8000-000000000000';

describe('entrega 12: pulido de las entregas 9 a 11', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  let numero = 7000;
  async function compras() {
    const e = await prepararPedidos(app, prisma);
    const d = await datosCompras(prisma, e.empresaId);
    await prisma.articulo.update({ where: { id: d.articuloId }, data: { controlaStock: true } });
    const factura = (renglones: Record<string, unknown>[], o: Record<string, unknown> = {}) => {
      const neto = renglones.reduce((s, r) => s + Number(r.cantidad) * Number(r.precioUnitario), 0);
      return e.http.post('/api/compras/comprobantes', {
        terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-05', fechaContable: '2026-11-05',
        monedaCodigo: 'ARS', totalDeclarado: Math.round(neto * 121) / 100, aceptoDiferencias: true,
        renglones: renglones.map((r) => ({ descripcion: 'Mercadería', alicuotaIva: 21, ...r })), ...o,
      });
    };
    return { ...e, ...d, factura };
  }

  it('1. valida depósitos y la lista de precios del pedido', async () => {
    const e = await compras();
    const f = await e.factura([{ origen: 'DIRECTO', articuloId: e.articuloId, cantidad: 1, precioUnitario: 10 }], { depositoId: NADA });
    expect(f.body.message).toBe('Depósito inexistente');
    const a = await e.articulo();
    await e.inicial(a.id, 5, 10);
    const fv = await e.http.post('/api/ventas/comprobantes', { ...e.datos({ renglones: [{ articuloId: a.id, descripcion: 'x', cantidad: 2, precioUnitario: 100, alicuota: 21 }] }), emitir: true });
    const nc = await e.http.post('/api/ventas/comprobantes', e.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fv.body.id, devuelveMercaderia: true, depositoId: NADA, renglones: [{ articuloId: a.id, descripcion: 'x', cantidad: 1, precioUnitario: 100, alicuota: 21 }] }));
    expect(nc.body.message).toBe('Depósito inexistente');
    const p = await e.http.post('/api/ventas/pedidos', { terceroId: e.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', listaPreciosId: NADA, renglones: [e.renglon(null, 1)] });
    expect(p.body.message).toBe('Lista de precios inexistente');
  });

  it('2. precio sugerido: identificadores inválidos dan 400', async () => {
    const e = await compras();
    expect((await e.http.get('/api/ventas/precio?terceroId=xx&articuloId=yy&monedaCodigo=ARS')).status).toBe(400);
  });

  it('3. remito con cliente inactivo', async () => {
    const e = await compras();
    await prisma.tercero.update({ where: { id: e.clienteRI.id }, data: { activo: false } });
    expect((await e.remito([{ descripcion: 'x', cantidad: 1 }])).body.message).toBe('Cliente inexistente o inactivo');
  });

  it('4. pedido sin depósito avisa con el depósito del punto de venta', async () => {
    const e = await compras();
    const a = await e.articulo();
    await e.inicial(a.id, 2, 10);
    const p = await e.pedido([e.renglon(a.id, 5)], { depositoId: null });
    const c = await e.http.post(`/api/ventas/pedidos/${p.id}/confirmar`, {});
    expect(c.body.advertencias).toEqual([`Stock disponible de ${a.codigo} en Central: 2, el pedido pide 5`]);
  });

  it('5. una lista inactiva no es la por defecto', async () => {
    const e = await compras();
    const r = await e.http.post('/api/ventas/listas', { nombre: 'X', monedaCodigo: 'ARS', activa: false, porDefecto: true });
    expect(r.body.message).toBe('Una lista inactiva no puede ser la lista por defecto');
    const l = (await e.http.post('/api/ventas/listas', { nombre: 'Y', monedaCodigo: 'ARS', porDefecto: true })).body;
    expect((await e.http.patch(`/api/ventas/listas/${l.id}`, { activa: false })).body.message).toBe('Una lista inactiva no puede ser la lista por defecto');
  });

  it('6. precios e historial con permiso de pedidos', async () => {
    const e = await compras();
    const l = (await e.http.post('/api/ventas/listas', { nombre: 'Y', monedaCodigo: 'ARS' })).body;
    const u = await otroUsuario(app, prisma, e.empresaId, ['pedido.gestionar']);
    expect((await u.http.get(`/api/ventas/listas/${l.id}/precios`)).status).toBe(200);
    expect((await u.http.get(`/api/ventas/listas/${l.id}/historial`)).status).toBe(200);
  });

  it('8. una NC de compra mayor al valor del stock no deja valor negativo', async () => {
    const e = await compras();
    await e.inicial(e.articuloId, 10, 10);
    const nc = await e.factura([{ origen: 'DIRECTO', articuloId: e.articuloId, cantidad: 1, precioUnitario: 150 }], { tipo: 'NOTA_CREDITO' });
    expect(nc.status).toBe(201);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '10', valor: '0' });
    const cmv = await prisma.asientoRenglon.findMany({ where: { empresaId: e.empresaId, cuentaContableId: await e.cuenta('5.1.01') } });
    expect(cmv.reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0)).toBe(-50);
  });

  it('9. facturar una recepción en partes no deja centavos en mercadería a facturar', async () => {
    const e = await compras();
    const oc = await ocAprobada(e.http, prisma, e.empresaId, e, 100, 3.333333);
    const ir = (await e.http.post('/api/compras/recepciones', { terceroId: e.proveedorId, fecha: '2026-11-05', depositoId: e.deposito.id, remitoNumero: '0001-00000777', renglones: [{ ordenCompraRenglonId: oc.renglones[0].id, cantidad: 100 }] })).body;
    for (let i = 0; i < 2; i++) expect((await e.factura([{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, cantidad: 50, precioUnitario: 3.333333 }])).status).toBe(201);
    const mrf = await prisma.asientoRenglon.findMany({ where: { empresaId: e.empresaId, cuentaContableId: await e.cuenta('2.1.01.003') } });
    expect(Math.abs(mrf.reduce((s, r) => s + Math.round((Number(r.debe) - Number(r.haber)) * 100), 0))).toBe(0);
  });

  it('10. reglas de la cuenta de ajuste', async () => {
    const e = await compras();
    const patch = async (codigo: string, d: Record<string, unknown>) => e.http.patch(`/api/plan-cuentas/${await e.cuenta(codigo)}`, d);
    expect((await patch('3.1.02', { monetaria: true })).body.message).toBe('La cuenta ajusta a la cuenta 3.1.01: no puede ser monetaria');
    expect((await patch('1.2.01.002', { cuentaAjusteId: await e.cuenta('5.2.01') })).body.message).toBe('La cuenta de ajuste debe ser del mismo tipo que la cuenta');
  });

  it('11. guardar la configuración con ajustes vigentes avisa', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await e.s.http.post('/api/contabilidad/ajuste-inflacion', { fecha: '2026-03-31' })).status).toBe(201);
    const r = await e.config({ anticuacion: [] });
    expect(r.body.advertencias).toEqual(['Hay ajustes generados: el próximo ajuste recalculará la diferencia']);
  });

  it('13. la anulación de un ajuste conserva el tipo', async () => {
    const e = await escenarioEjemplo(app, prisma);
    const a = await e.s.http.post('/api/contabilidad/ajuste-inflacion', { fecha: '2026-03-31' });
    await e.s.http.post(`/api/contabilidad/ajuste-inflacion/${a.body.id}/anular`, { motivo: 'x' });
    expect((await prisma.asiento.findFirstOrThrow({ where: { anulaAId: a.body.id } })).tipo).toBe('AJUSTE_INFLACION');
  });

  it('14. la valuación separa el ajuste por inflación', async () => {
    const e = await compras();
    await e.inicial(e.articuloId, 10, 10);
    const merc = await e.cuenta('1.1.05.001');
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: e.empresaId } });
    await prisma.asiento.create({ data: {
      empresaId: e.empresaId, numero: 9999, fecha: new Date('2026-11-04T00:00:00Z'), descripcion: 'Ajuste', origenTipo: 'AJUSTE_INFLACION', origenId: 'x', creadoPor: 't', tipo: 'AJUSTE_INFLACION', ejercicioId: ej.id,
      renglones: { create: [{ empresaId: e.empresaId, cuentaContableId: merc, debe: 30 }, { empresaId: e.empresaId, cuentaContableId: await e.cuenta('4.2.03'), haber: 30 }] },
    } });
    const v = (await e.http.get('/api/stock/valuacion?fecha=2026-11-30')).body;
    expect(v).toMatchObject({ total: '100.00', mayor: '100.00', control: '0.00', ajusteInflacion: '30.00' });
  });

  it('15. el kardex ordena por fecha', async () => {
    const e = await compras();
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10, { fecha: '2026-11-03' });
    await e.inicial(a.id, 5, 10, { fecha: '2026-11-01' });
    const k = (await e.http.get(`/api/stock/kardex?articuloId=${a.id}&desde=2026-11-02`)).body;
    expect(k.saldoInicial.cantidad).toBe('5');
    expect(k.movimientos.map((m: { saldoCantidad: string }) => m.saldoCantidad)).toEqual(['15']);
    const todo = (await e.http.get(`/api/stock/kardex?articuloId=${a.id}`)).body;
    expect(todo.movimientos.map((m: { fecha: string }) => m.fecha)).toEqual(['2026-11-01', '2026-11-03']);
  });

  it('21. modificar un borrador devuelve los avisos de stock', async () => {
    const e = await compras();
    await e.modo('AVISAR');
    const a = await e.articulo();
    await e.inicial(a.id, 1, 10);
    const b = await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [{ articuloId: a.id, descripcion: 'x', cantidad: 1, precioUnitario: 100, alicuota: 21 }] }));
    const m = await e.http.put(`/api/ventas/comprobantes/${b.body.id}`, { ...e.datos({ renglones: [{ articuloId: a.id, descripcion: 'x', cantidad: 3, precioUnitario: 100, alicuota: 21 }] }), version: b.body.version });
    expect(m.body.advertencias).toEqual([`Stock insuficiente de ${a.codigo} en Central: hay 1, se piden 3`]);
  });
});
