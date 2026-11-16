import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('tarjetas: liquidaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function asiento(asientoId: string) {
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: asientoId }, include: { renglones: true } });
    const r: Record<string, [string, string]> = {};
    for (const x of a.renglones) {
      const c = (await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo;
      const [d, h] = r[c] ?? ['0', '0'];
      r[c] = [(Number(d) + Number(x.debe)).toFixed(2), (Number(h) + Number(x.haber)).toFixed(2)];
    }
    return r;
  }

  const escenario = async () => {
    const t = await prepararTesoreria(app, prisma);
    const tarjeta = async (nombre: string) => (await t.http.post('/api/tesoreria/tarjetas', { nombre, tipo: 'CREDITO', cuentaBancariaId: t.ars.id })).body as { id: string };
    const visa = await tarjeta('Visa crédito');
    const master = await tarjeta('Mastercard crédito');
    const ingreso = async (cupones: object[], cajaId = t.cajaCen.id) => {
      const r = await t.http.post('/api/tesoreria/ingresos', { fecha: '2026-11-05', cajaId, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobranza', cupones });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return { id: r.body.id as string, cupones: await prisma.cuponTarjeta.findMany({ where: { ingresoId: r.body.id }, orderBy: { importe: 'desc' } }) };
    };
    const ing = await ingreso([{ tarjetaId: visa.id, numero: '1001', importe: 100000 }, { tarjetaId: visa.id, numero: '1002', importe: 50000 }]);
    const datos = (o: Record<string, unknown> = {}) => ({
      tarjetaId: visa.id, fecha: '2026-11-06', cuponIds: ing.cupones.map((c) => c.id), arancel: 2700, ivaArancel: 567,
      impuestos: [{ clase: 'RETENCION', tipo: 'IVA', importe: 1500 }, { clase: 'RETENCION', tipo: 'GANANCIAS', importe: 1000 }, { clase: 'RETENCION', tipo: 'IIBB', jurisdiccion: '902', importe: 2250 }],
      neto: 141983, ...o,
    });
    const liquidar = (o: Record<string, unknown> = {}, http = t.http) => http.post('/api/tesoreria/liquidaciones-tarjeta', datos(o));
    return { ...t, visa, master, ingreso, ing, datos, liquidar };
  };

  it('liquidación del ejemplo', async () => {
    const x = await escenario();
    const r = await x.liquidar();
    expect(r.status).toBe(201);
    const l = await prisma.liquidacionTarjeta.findUniqueOrThrow({ where: { id: r.body.id } });
    const a = await asiento(l.asientoId!);
    expect(a).toEqual({
      '1.1.01.002': ['141983.00', '0.00'], '5.2.12': ['2700.00', '0.00'], '1.1.03.001': ['567.00', '0.00'],
      '1.1.03.005': ['1500.00', '0.00'], '1.1.03.006': ['1000.00', '0.00'], '1.1.03.007': ['2250.00', '0.00'], '1.1.02.003': ['0.00', '150000.00'],
    });
    const m = await prisma.movimientoTesoreria.findFirstOrThrow({ where: { empresaId: x.empresaId, origenTipo: 'LIQUIDACION_TARJETA' } });
    expect([m.tipo, m.importe.toFixed(2), m.cuentaBancariaId]).toEqual(['INGRESO', '141983.00', x.ars.id]);
    expect((await prisma.cuponTarjeta.findMany({ where: { ingresoId: x.ing.id } })).map((c) => c.estado)).toEqual(['LIQUIDADO', 'LIQUIDADO']);
  });

  it('no cierra', async () => {
    const x = await escenario();
    const r = await x.liquidar({ neto: 141982.99 });
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación no cierra: diferencia $ 0,01']);
  });

  it('valores inválidos', async () => {
    const x = await escenario();
    expect((await x.liquidar({ arancel: -1 })).status).toBe(400);
    expect((await x.liquidar({ neto: 0 })).status).toBe(400);
  });

  it('cupón ajeno o liquidado', async () => {
    const x = await escenario();
    const otro = await x.ingreso([{ tarjetaId: x.master.id, importe: 1000 }]);
    expect((await x.liquidar({ cuponIds: [otro.cupones[0].id], neto: 1000, arancel: 0, ivaArancel: 0, impuestos: [] })).status).toBe(400);
    await x.liquidar();
    const r = await x.liquidar();
    expect([r.status, r.body.message]).toEqual([400, 'El cupón 1001 no está pendiente']);
  });

  it('dos liquidaciones simultáneas', async () => {
    const x = await escenario();
    const rs = await Promise.all([x.liquidar(), x.liquidar()]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it('anular', async () => {
    const x = await escenario();
    const l = (await x.liquidar()).body as { id: string; numero: number };
    const anIng = await x.http.post(`/api/tesoreria/ingresos/${x.ing.id}/anular`, { motivo: 'Error' });
    expect([anIng.status, anIng.body.message]).toEqual([400, 'El cupón 1001 de Visa crédito ya está liquidado: anule primero la liquidación N° 1']);
    expect((await x.http.post(`/api/tesoreria/liquidaciones-tarjeta/${l.id}/anular`, { motivo: 'Error de carga' })).status).toBe(201);
    const liq = await prisma.liquidacionTarjeta.findUniqueOrThrow({ where: { id: l.id } });
    expect(liq.estado).toBe('ANULADO');
    expect(await prisma.asiento.count({ where: { anulaAId: liq.asientoId! } })).toBe(1);
    expect(await prisma.movimientoTesoreria.count({ where: { origenTipo: 'LIQUIDACION_TARJETA', anulado: true } })).toBe(1);
    expect((await prisma.cuponTarjeta.findMany({ where: { ingresoId: x.ing.id } })).every((c) => c.estado === 'PENDIENTE' && !c.liquidacionId)).toBe(true);
  });

  it('cuenta copiada', async () => {
    const x = await escenario();
    await x.http.put(`/api/tesoreria/tarjetas/${x.visa.id}`, { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: x.ars.id, cuentaContableId: await x.cuenta('1.1.02.001') });
    const l = (await x.liquidar()).body as { id: string };
    const a = await asiento((await prisma.liquidacionTarjeta.findUniqueOrThrow({ where: { id: l.id } })).asientoId!);
    expect(a['1.1.02.003']).toEqual(['0.00', '150000.00']);
  });

  it('sucursales', async () => {
    const x = await escenario();
    const ros = await x.usuario(['tesoreria.ver', 'tesoreria.operar', 'tesoreria.tarjetas'], x.ros.id);
    const r = await x.liquidar({}, ros);
    expect([r.status, r.body.message]).toEqual([400, 'El cupón 1001 no pertenece a su sucursal']);
  });

  it('costo por tarjeta', async () => {
    const x = await escenario();
    await x.liquidar();
    const c = (await x.http.get('/api/tesoreria/tarjetas/costo?desde=2026-11-01&hasta=2026-11-30')).body as { tarjeta: string; bruto: string; costoPct: string; descuentoTotalPct: string; neto: string }[];
    expect(c.find((y) => y.tarjeta === 'Visa crédito')).toMatchObject({ bruto: '150000.00', neto: '141983.00', costoPct: '1.80', descuentoTotalPct: '5.34' });
  });

  it('permisos', async () => {
    const x = await escenario();
    const u = await otroUsuario(app, prisma, x.empresaId, ['tesoreria.ver']);
    expect((await x.liquidar({}, u.http)).status).toBe(403);
    expect((await u.http.get('/api/tesoreria/liquidaciones-tarjeta')).status).toBe(200);
  });

  it('revisión: anular un ingreso mientras se liquida no deja cupones liquidados sin respaldo', async () => {
    const x = await escenario();
    let anular: Promise<{ status: number }> | null = null;
    await prisma.$transaction(async (tx) => {
      // Simula una liquidación en curso: los cupones quedan LIQUIDADO sin confirmar
      await tx.cuponTarjeta.updateMany({ where: { ingresoId: x.ing.id }, data: { estado: 'LIQUIDADO' } });
      anular = Promise.resolve(x.http.post(`/api/tesoreria/ingresos/${x.ing.id}/anular`, { motivo: 'Error' }).then((r) => r));
      await new Promise((r) => setTimeout(r, 800));
    }, { timeout: 10000 });
    const r = await anular!;
    expect(r.status).toBe(400);
    expect((await prisma.ingresoValores.findUniqueOrThrow({ where: { id: x.ing.id } })).estado).not.toBe('ANULADO');
  });

  it('revisión: modificar la tarjeta sin cuenta conserva la cuenta a cobrar', async () => {
    const x = await escenario();
    const propia = await x.cuenta('1.1.02.001');
    await x.http.put(`/api/tesoreria/tarjetas/${x.visa.id}`, { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: x.ars.id, cuentaContableId: propia });
    expect((await x.http.put(`/api/tesoreria/tarjetas/${x.visa.id}`, { nombre: 'Visa', tipo: 'CREDITO', cuentaBancariaId: x.ars.id, activa: true })).status).toBe(200);
    expect((await prisma.tarjeta.findUniqueOrThrow({ where: { id: x.visa.id } })).cuentaContableId).toBe(propia);
  });

  it('revisión: un usuario de otra sucursal no ve, ni anula, ni cuenta en el costo las liquidaciones ajenas', async () => {
    const x = await escenario();
    const l = (await x.liquidar()).body as { id: string };
    const ros = await x.usuario(['tesoreria.ver', 'tesoreria.operar', 'tesoreria.tarjetas'], x.ros.id);
    expect((await ros.get('/api/tesoreria/liquidaciones-tarjeta')).body).toEqual([]);
    expect((await ros.get('/api/tesoreria/tarjetas/costo?desde=2026-11-01&hasta=2026-11-30')).body).toEqual([]);
    expect((await ros.get(`/api/tesoreria/liquidaciones-tarjeta/${l.id}`)).status).toBe(404);
    const an = await ros.post(`/api/tesoreria/liquidaciones-tarjeta/${l.id}/anular`, { motivo: 'x' });
    expect(an.status).toBe(404);
    expect((await x.http.get('/api/tesoreria/liquidaciones-tarjeta')).body).toHaveLength(1);
  });

  it('revisión: costo por tarjeta en Excel y PDF', async () => {
    const x = await escenario();
    await x.liquidar();
    const xl = await x.http.get('/api/tesoreria/tarjetas/costo?desde=2026-11-01&hasta=2026-11-30&formato=xlsx');
    expect([xl.status, xl.headers['content-type']]).toEqual([200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    const pdf = await x.http.get('/api/tesoreria/tarjetas/costo?desde=2026-11-01&hasta=2026-11-30&formato=pdf');
    expect([pdf.status, pdf.headers['content-type']]).toEqual([200, 'application/pdf']);
  });

  it('revisión: el ingreso trae sus cupones', async () => {
    const x = await escenario();
    const i = await x.http.get(`/api/tesoreria/ingresos/${x.ing.id}`);
    expect(i.body.cupones.map((c: { importe: string }) => Number(c.importe))).toEqual([100000, 50000]);
    const lista = await x.http.get('/api/tesoreria/ingresos');
    const fila = lista.body.items.find((y: { id: string }) => y.id === x.ing.id);
    expect(fila.cupones).toHaveLength(2);
  });
});
