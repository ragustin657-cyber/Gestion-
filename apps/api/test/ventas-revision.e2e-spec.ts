import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TODOS_LOS_PERMISOS } from '@gestion/shared';
import { ArcaSimulado } from '../src/arca/arca-simulado';
import { CLAVE_CONTEXTO } from '../src/contexto/contexto';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmisionService } from '../src/ventas/emision/emision.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('ventas: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  type V = Awaited<ReturnType<typeof prepararVentas>>;
  const emitir = (v: V, id: string) => v.http.post(`/api/ventas/comprobantes/${id}/emitir`, {});
  const saldo = async (origenId: string) => (await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId } })).saldo.toString();

  it('los números de un ambiente de ARCA no chocan con los de otro', async () => {
    const v = await prepararVentas(app, prisma);
    const vieja = await v.factura();
    // La primera factura fue de otro ambiente; el ARCA actual empieza su numeración de cero
    await prisma.comprobanteVenta.update({ where: { id: vieja.id }, data: { ambiente: 'HOMOLOGACION' } });
    await prisma.arcaSimuladoComprobante.deleteMany({});
    const r = await v.http.post('/api/ventas/comprobantes', { ...v.datos(), emitir: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ estado: 'AUTORIZADO', numero: 1, ambiente: 'SIMULADO' });
  });

  it('la recuperación no adopta el número que ya tiene otro comprobante local', async () => {
    const v = await prepararVentas(app, prisma);
    const x = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    ArcaSimulado.forzarFalla(v.empresaId, 'SIN_CONEXION');
    expect((await emitir(v, x.id)).status).toBe(502);
    const y = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    expect((await emitir(v, y.id)).body).toMatchObject({ estado: 'AUTORIZADO', numero: 1 });
    const r = await emitir(v, x.id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ estado: 'AUTORIZADO', numero: 2 });
  });

  it('un rechazo tardío no pisa un comprobante autorizado ni una emisión de otro intento', async () => {
    const v = await prepararVentas(app, prisma);
    const emision = app.get(EmisionService);
    const cls = app.get(ClsService);
    const comoEmpresa = (fn: () => Promise<unknown>) => cls.run(async () => {
      cls.set(CLAVE_CONTEXTO, { usuarioId: (await prisma.usuarioEmpresa.findFirstOrThrow({ where: { empresaId: v.empresaId } })).usuarioId, empresaId: v.empresaId, permisos: TODOS_LOS_PERMISOS, superadmin: true, sucursalId: null });
      return fn().catch(() => undefined);
    });
    const fc = await v.factura();
    await comoEmpresa(() => emision.registrarRechazo(fc.id, new Date(0), ['(10016) El numero de comprobante no es el proximo a autorizar']));
    expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: fc.id } })).toMatchObject({ estado: 'AUTORIZADO', numero: 1 });
    const p = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    const otro = new Date();
    await prisma.comprobanteVenta.update({ where: { id: p.id }, data: { emisionEnCurso: otro, numeroReservado: 2 } });
    await comoEmpresa(() => emision.registrarRechazo(p.id, new Date(otro.getTime() - 1000), ['(10016) x']));
    expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ estado: 'PENDIENTE_CAE', numeroReservado: 2, emisionEnCurso: otro });
  });

  it('deshacer dos veces la misma aplicación a la vez la deshace una sola vez', async () => {
    for (let i = 0; i < 3; i++) {
      await limpiarBase(prisma);
      const v = await prepararVentas(app, prisma);
      const fc = await v.factura({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'S', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
      const { mov } = await v.cobro(105000);
      await v.cotizacionUsd('2026-11-05', 1050);
      const ap = (await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: (await v.movDe(fc.id)).id, importe: 60 }] })).body;
      const rs = await Promise.all([1, 2].map(() => v.http.post(`/api/ventas/aplicaciones/${ap.id}/anular`, {})));
      expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(await saldo(fc.id)).toBe('100');
      expect(await saldo(mov.origenId)).toBe('-105000');
      expect(await prisma.asiento.count({ where: { origenTipo: 'APLICACION_COBRO', origenId: ap.id } })).toBe(2);
    }
  });

  it('anular un recibo mientras se aplica su saldo nunca deja una aplicación sobre un recibo anulado', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const v = await prepararVentas(app, prisma);
      const fc = await v.factura();
      const otra = await v.factura();
      const r = (await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-05', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1210 }, aplicaciones: [{ comprobanteId: fc.id, importe: 1000 }] })).body;
      const credito = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'RECIBO', origenId: r.id } });
      await Promise.all([
        v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: credito.id, debitoMovId: (await v.movDe(otra.id)).id, importe: 210 }] }),
        v.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'Carrera' }),
      ]);
      const anulado = (await prisma.recibo.findUniqueOrThrow({ where: { id: r.id } })).estado === 'ANULADO';
      const vivas = await prisma.aplicacionCobro.count({ where: { creditoMovId: credito.id, anulada: false } });
      expect(anulado && vivas > 0).toBe(false);
    }
  });

  it('el cheque rechazado de un cliente es deuda del cliente, no de un proveedor', async () => {
    const v = await prepararVentas(app, prisma);
    const banco = (await v.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await v.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await v.cuenta('1.1.01.002') })).body;
    const ing = (await v.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-03', cajaId: v.caja.id, origen: 'CLIENTE', terceroId: v.clienteRI.id, concepto: 'Cobro',
      cheques: [{ tipo: 'FISICO', banco: 'Galicia', numero: '123', libradorNombre: 'Cliente', fechaEmision: '2026-11-03', fechaPago: '2026-11-03', importe: 5000 }],
    })).body;
    const chequeId = ing.cheques[0].id;
    expect((await v.http.post('/api/tesoreria/depositos', { fecha: '2026-11-04', cajaId: v.caja.id, cuentaBancariaId: cuenta.id, cheques: [chequeId] })).status).toBe(201);
    expect((await v.http.post(`/api/tesoreria/cheques/${chequeId}/rechazar`, { fecha: '2026-11-05', motivo: 'Sin fondos', gastos: 0 })).status).toBe(200);
    const pend = (await v.http.get(`/api/ventas/clientes/${v.clienteRI.id}/pendientes`)).body;
    expect(pend.debitos.map((d: { descripcion: string; saldo: string }) => [d.descripcion, d.saldo])).toEqual([['Cheque rechazado Galicia 123', '5000']]);
    const cc = (await v.http.get(`/api/ventas/clientes/${v.clienteRI.id}/cuenta-corriente`)).body;
    expect(cc.saldoFinal).toBe('0.00');
    expect(JSON.stringify((await v.http.get('/api/compras/antiguedad-deuda')).body)).not.toContain(v.clienteRI.id);
  });

  it('la cuenta corriente en pesos incluye la diferencia de cambio y cierra en cero', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'S', cantidad: 1, precioUnitario: 1000, alicuota: 'EXENTO' }] });
    const { mov } = await v.cobro(1150000);
    await v.cotizacionUsd('2026-11-05', 1150);
    await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: mov.id, debitoMovId: (await v.movDe(fc.id)).id, importe: 1000 }] });
    const cc = (await v.http.get(`/api/ventas/clientes/${v.clienteRI.id}/cuenta-corriente`)).body;
    expect(cc.movimientos.map((m: { comprobante: string }) => m.comprobante)).toEqual(['Factura A 0001-00000001', 'Cobro de Tesorería 1', 'Diferencia de cambio']);
    expect(cc.saldoFinal).toBe('0.00');
    expect(cc.saldos).toEqual({ ARS: '0.00', USD: '0.00' });
  });
});
