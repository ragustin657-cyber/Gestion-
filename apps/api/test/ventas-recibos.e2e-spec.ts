import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('recibos de cobranza', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  let nCheque = 5000;
  async function escenario() {
    const v = await prepararVentas(app, prisma);
    const banco = (await v.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuenta = (await v.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await v.cuenta('1.1.01.002') })).body;
    const fc = await v.factura();
    const datos = (o: Record<string, unknown> = {}) => ({
      terceroId: v.clienteRI.id, fecha: '2026-11-05', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id,
      efectivo: { importe: 100 },
      cheques: [{ tipo: 'FISICO', banco: 'Galicia', numero: String(++nCheque), libradorNombre: 'Distribuidora Norte SA', fechaEmision: '2026-11-05', fechaPago: '2026-11-20', importe: 800 }],
      transferencias: [{ cuentaBancariaId: cuenta.id, fecha: '2026-11-05', importe: 200 }],
      retenciones: [{ tipo: 'IIBB', jurisdiccion: '901', numeroCertificado: 'A-1', fecha: '2026-11-05', importe: 50 }, { tipo: 'GANANCIAS', numeroCertificado: 'G-7', fecha: '2026-11-05', importe: 60 }],
      aplicaciones: [{ comprobanteId: fc.id, importe: 1000 }],
      ...o,
    });
    return { v, fc, cuenta, datos };
  }
  async function asiento(asientoId: string) {
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: asientoId }, include: { renglones: true } });
    const r: Record<string, [number, number]> = {};
    for (const x of a.renglones) {
      const c = (await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo;
      const [d, h] = r[c] ?? [0, 0];
      r[c] = [d + Number(x.debe), h + Number(x.haber)];
    }
    return r;
  }

  it('recibo con efectivo, cheque, transferencia y retenciones, aplicado en parte', async () => {
    const { v, fc, datos } = await escenario();
    const r = await v.http.post('/api/ventas/recibos', datos());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ numero: 1, total: '1210', totalValores: '1100', totalRetenciones: '110', estado: 'CONFIRMADO' });
    expect((await v.movDe(fc.id)).saldo.toString()).toBe('210');
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'RECIBO', origenId: r.body.id } });
    expect([mov.importe.toString(), mov.saldo.toString()]).toEqual(['-1210', '-210']);
    const cheque = await prisma.chequeTercero.findFirstOrThrow({ where: { ingresoId: r.body.ingresoId } });
    expect(cheque.estado).toBe('EN_CARTERA');
    expect(await asiento(r.body.asientoId)).toEqual({
      '1.1.01.001': [100, 0], '1.1.01.003': [800, 0], '1.1.01.004': [200, 0], '1.1.03.007': [50, 0], '1.1.03.006': [60, 0], '1.1.02.001': [0, 1210],
    });
    const ingreso = await prisma.ingresoValores.findUniqueOrThrow({ where: { id: r.body.ingresoId } });
    expect(ingreso.asientoId).toBeNull();
    expect(await prisma.movimientoCuentaCorriente.count({ where: { origenTipo: 'COBRO', origenId: ingreso.id } })).toBe(0);
    const tes = await v.http.post(`/api/tesoreria/ingresos/${ingreso.id}/anular`, { motivo: 'x' });
    expect(tes.status).toBe(400);
    expect(tes.body.message).toBe('Los valores pertenecen a un recibo de Ventas: anule el recibo');
  });

  it('validaciones', async () => {
    const { v, fc, datos } = await escenario();
    const mas = await v.http.post('/api/ventas/recibos', datos({ aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }], efectivo: null, cheques: [], transferencias: [{ cuentaBancariaId: (datos().transferencias as { cuentaBancariaId: string }[])[0].cuentaBancariaId, fecha: '2026-11-05', importe: 100 }] }));
    expect(mas.status).toBe(400);
    expect(mas.body.message).toBe('Lo aplicado supera el total del recibo');
    const cero = await v.http.post('/api/ventas/recibos', datos({ efectivo: null, cheques: [], transferencias: [], retenciones: [], aplicaciones: [] }));
    expect(cero.status).toBe(400);
    const sinJur = await v.http.post('/api/ventas/recibos', datos({ retenciones: [{ tipo: 'IIBB', numeroCertificado: 'A-1', fecha: '2026-11-05', importe: 50 }] }));
    expect(sinJur.status).toBe(400);
    expect(JSON.stringify(sinJur.body.campos)).toContain('retenciones.0.jurisdiccion');
    const saldo = await v.http.post('/api/ventas/recibos', datos({ efectivo: { importe: 5000 }, aplicaciones: [{ comprobanteId: fc.id, importe: 1300 }] }));
    expect(saldo.status).toBe(400);
    expect(saldo.body.message).toBe('El comprobante 0001-00000001 tiene saldo 1.210,00');
  });

  it('anular el recibo restituye la factura y anula los valores', async () => {
    const { v, fc, datos } = await escenario();
    const r = (await v.http.post('/api/ventas/recibos', datos())).body;
    const an = await v.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'Error de carga' });
    expect(an.status).toBe(200);
    expect(an.body.estado).toBe('ANULADO');
    expect((await v.movDe(fc.id)).saldo.toString()).toBe('1210');
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'RECIBO', origenId: r.id } });
    expect(mov).toMatchObject({ anulado: true });
    expect((await prisma.chequeTercero.findFirstOrThrow({ where: { ingresoId: r.ingresoId } })).estado).toBe('ANULADO');
    const contra = await prisma.asiento.findFirstOrThrow({ where: { anulaAId: r.asientoId } });
    expect(contra.origenTipo).toBe('RECIBO');
    expect((await v.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'otra' })).status).toBe(400);
  });

  it('no se anula si el cheque ya se depositó', async () => {
    const { v, cuenta, datos } = await escenario();
    const r = (await v.http.post('/api/ventas/recibos', datos())).body;
    const cheque = await prisma.chequeTercero.findFirstOrThrow({ where: { ingresoId: r.ingresoId } });
    const dep = await v.http.post('/api/tesoreria/depositos', { fecha: '2026-11-06', cajaId: v.caja.id, cuentaBancariaId: cuenta.id, cheques: [cheque.id] });
    expect(dep.status).toBe(201);
    const an = await v.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'x' });
    expect(an.status).toBe(400);
    expect(an.body.message).toBe('Hay valores de este ingreso que ya se movieron');
  });

  it('no se anula si su saldo a favor se aplicó a otra factura', async () => {
    const { v, datos } = await escenario();
    const r = (await v.http.post('/api/ventas/recibos', datos())).body;
    const otra = await v.factura();
    const credito = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'RECIBO', origenId: r.id } });
    const ap = await v.http.post('/api/ventas/aplicaciones', { terceroId: v.clienteRI.id, fecha: '2026-11-05', items: [{ creditoMovId: credito.id, debitoMovId: (await v.movDe(otra.id)).id, importe: 210 }] });
    expect(ap.status).toBe(201);
    const an = await v.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'x' });
    expect(an.status).toBe(400);
    expect(an.body.message).toBe('El saldo del recibo fue aplicado: deshaga primero la aplicación');
    expect((await v.http.post(`/api/ventas/aplicaciones/${ap.body.id}/anular`, {})).status).toBe(200);
    expect((await v.http.post(`/api/ventas/recibos/${r.id}/anular`, { motivo: 'x' })).status).toBe(200);
  });
});
