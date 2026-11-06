import { INestApplication } from '@nestjs/common';
import { ArcaSimulado } from '../src/arca/arca-simulado';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('emisión de comprobantes de venta con CAE', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Renglones del asiento del comprobante, por código de cuenta: [debe, haber]. */
  async function asiento(origenId: string) {
    const a = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'VENTA', origenId }, include: { renglones: true } });
    const r: Record<string, [string, string]> = {};
    for (const x of a.renglones) {
      const c = (await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo;
      const [d, h] = r[c] ?? ['0', '0'];
      r[c] = [String(Number(d) + Number(x.debe)), String(Number(h) + Number(x.haber))];
    }
    const debe = a.renglones.reduce((s, x) => s + Number(x.debe), 0), haber = a.renglones.reduce((s, x) => s + Number(x.haber), 0);
    return { r, balanceado: Math.round(debe * 100) === Math.round(haber * 100), fecha: a.fecha.toISOString().slice(0, 10) };
  }
  const emitir = (v: { http: { post: (u: string, b?: object) => Promise<{ status: number; body: any }> } }, id: string) => v.http.post(`/api/ventas/comprobantes/${id}/emitir`, {});

  it('factura A: CAE, número, cuenta corriente y asiento', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    expect(fc).toMatchObject({ estado: 'AUTORIZADO', numero: 1, total: '1210' });
    expect(fc.cae).toMatch(/^\d{14}$/);
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'VENTA', origenId: fc.id } });
    expect(mov).toMatchObject({ terceroId: v.clienteRI.id, monedaCodigo: 'ARS' });
    expect([mov.importe.toString(), mov.saldo.toString(), mov.importePesos.toString()]).toEqual(['1210', '1210', '1210']);
    const a = await asiento(fc.id);
    expect(a.balanceado).toBe(true);
    expect(a.r).toEqual({ '1.1.02.001': ['1210', '0'], '4.1.01': ['0', '1000'], '2.1.02.001': ['0', '210'] });
    expect((await v.factura()).numero).toBe(2);
  });

  it('factura en USD: pesos a la cotización del comprobante', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura({ monedaCodigo: 'USD', cotizacion: 1000 });
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: fc.id } });
    expect([mov.monedaCodigo, mov.importe.toString(), mov.importePesos.toString()]).toEqual(['USD', '1210', '1210000']);
    expect((await asiento(fc.id)).r).toEqual({ '1.1.02.001': ['1210000', '0'], '4.1.01': ['0', '1000000'], '2.1.02.001': ['0', '210000'] });
  });

  it('mezcla de alícuotas, exento y no gravado con precios de 4 decimales', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura({
      renglones: [
        { descripcion: 'a', cantidad: 2, precioUnitario: 100.125, alicuota: 21 }, { descripcion: 'b', cantidad: 1, precioUnitario: 50, alicuota: 21 },
        { descripcion: 'c', cantidad: 3, precioUnitario: 33.3333, alicuota: 10.5 }, { descripcion: 'd', cantidad: 1, precioUnitario: 10, alicuota: 'EXENTO' },
        { descripcion: 'e', cantidad: 1, precioUnitario: 5, alicuota: 'NO_GRAVADO' },
      ],
    });
    expect(fc).toMatchObject({ estado: 'AUTORIZADO', total: '428.3' });
    const a = await asiento(fc.id);
    expect(a.balanceado).toBe(true);
    expect(a.r['4.1.01']).toEqual(['0', '365.25']);
    expect(a.r['2.1.02.001']).toEqual(['0', '63.05']);
  });

  it('rechazo de ARCA, corrección y nueva emisión', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    ArcaSimulado.forzarFalla(v.empresaId, 'RECHAZO');
    const r = await emitir(v, fc.id);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('ARCA rechazó el comprobante: (10015) Rechazo simulado para pruebas');
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: fc.id } });
    expect(c).toMatchObject({ estado: 'RECHAZADO', numeroReservado: null, numero: null, emisionEnCurso: null, intentos: 1 });
    expect(c.ultimoError).toContain('10015');
    const mod = await v.http.put(`/api/ventas/comprobantes/${fc.id}`, { ...v.datos({ renglones: [{ descripcion: 'Corregido', cantidad: 1, precioUnitario: 900, alicuota: 21 }] }), version: c.version });
    expect(mod.status).toBe(200);
    const ok = await emitir(v, fc.id);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ estado: 'AUTORIZADO', numero: 1, ultimoError: null });
  });

  it('sin conexión queda pendiente con el número reservado y el reintento lo autoriza', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    ArcaSimulado.forzarFalla(v.empresaId, 'SIN_CONEXION');
    const r = await emitir(v, fc.id);
    expect(r.status).toBe(502);
    expect(r.body.message).toBe('No se pudo conectar con ARCA: el comprobante quedó pendiente de CAE');
    expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: fc.id } })).toMatchObject({ estado: 'PENDIENTE_CAE', numeroReservado: 1, emisionEnCurso: null });
    expect(await prisma.movimientoCuentaCorriente.count({ where: { origenId: fc.id } })).toBe(0);
    const del = await v.http.delete(`/api/ventas/comprobantes/${fc.id}`);
    expect(del.status).toBe(400);
    expect(del.body.message).toBe('El comprobante tiene una emisión sin confirmar: reintente para resolverla');
    const ok = await emitir(v, fc.id);
    expect(ok.body).toMatchObject({ estado: 'AUTORIZADO', numero: 1, numeroReservado: null });
  });

  it('ARCA autoriza sin responder y otro comprobante se emite antes del reintento: se adopta el CAE sin duplicar', async () => {
    const v = await prepararVentas(app, prisma);
    const x = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    const y = (await v.http.post('/api/ventas/comprobantes', v.datos({ renglones: [{ descripcion: 'Otro', cantidad: 1, precioUnitario: 500, alicuota: 21 }] }))).body;
    ArcaSimulado.forzarFalla(v.empresaId, 'AUTORIZA_SIN_RESPONDER');
    expect((await emitir(v, x.id)).status).toBe(502);
    expect(await prisma.arcaSimuladoComprobante.count()).toBe(1);
    expect((await emitir(v, y.id)).body).toMatchObject({ estado: 'AUTORIZADO', numero: 2 });
    const r = await emitir(v, x.id);
    const simulado = await prisma.arcaSimuladoComprobante.findFirstOrThrow({ where: { numero: 1 } });
    expect(r.body).toMatchObject({ estado: 'AUTORIZADO', numero: 1, cae: simulado.cae });
    expect(await prisma.arcaSimuladoComprobante.count()).toBe(2);
  });

  it('emisiones simultáneas en el mismo talonario dan números correlativos sin duplicados', async () => {
    const v = await prepararVentas(app, prisma);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await v.http.post('/api/ventas/comprobantes', v.datos())).body.id);
    const conReintento = async (id: string) => {
      for (let i = 0; i < 10; i++) {
        const r = await emitir(v, id);
        if (r.status !== 409) return r;
        await new Promise((ok) => setTimeout(ok, 100));
      }
      throw new Error('siempre 409');
    };
    const rs = await Promise.all(ids.map(conReintento));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(rs.map((r) => r.body.numero).sort()).toEqual([1, 2, 3, 4]);
  });

  it('con el mes cerrado no se emite ni se llama a ARCA', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos({ fecha: '2026-01-15', fechaVencimiento: '2026-01-30' }))).body;
    const enero = await prisma.periodoContable.findFirstOrThrow({ where: { empresaId: v.empresaId, anio: 2026, mes: 1 } });
    expect((await v.http.post(`/api/contabilidad/periodos/${enero.id}/cerrar`, {})).status).toBe(200);
    const r = await emitir(v, fc.id);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El período 01/2026 está cerrado');
    expect(await prisma.arcaSimuladoComprobante.count()).toBe(0);
  });

  it('un comprobante autorizado no se modifica ni se elimina', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const del = await v.http.delete(`/api/ventas/comprobantes/${fc.id}`);
    expect(del.status).toBe(400);
    expect(del.body.message).toBe('Un comprobante autorizado no se anula: emita una nota de crédito');
    expect((await v.http.put(`/api/ventas/comprobantes/${fc.id}`, { ...v.datos(), version: fc.version })).body.message).toBe('Un comprobante autorizado no se anula: emita una nota de crédito');
  });

  it('nota de crédito por el saldo exacto pasa y por un centavo más no', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    await prisma.movimientoCuentaCorriente.updateMany({ where: { origenId: fc.id }, data: { saldo: 1000, saldoPesos: 1000 } });
    const nc = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, aplicarAAsociado: false, renglones: [{ descripcion: 'Bonificación', cantidad: 1, precioUnitario: 826.45, alicuota: 21 }], emitir: true }));
    expect(nc.status).toBe(201);
    expect(nc.body).toMatchObject({ estado: 'AUTORIZADO', total: '1000', letra: 'A' });
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: nc.body.id } });
    expect(mov.importe.toString()).toBe('-1000');
    expect((await asiento(nc.body.id)).r).toEqual({ '1.1.02.001': ['0', '1000'], '4.1.01': ['826.45', '0'], '2.1.02.001': ['173.55', '0'] });
    const otra = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, renglones: [{ descripcion: 'Centavo', cantidad: 1, precioUnitario: 0.01, alicuota: 'EXENTO' }] }));
    expect(otra.status).toBe(400);
    expect(otra.body.message).toBe('La nota de crédito supera el saldo de la factura 0001-00000001');
  });
});
