import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

type Dj = {
  estado: string; datos: Record<string, string>; ajustes: { id: string }[];
  determinacion: Record<string, unknown> & { anticipos: { numero: number; mes: string; importe: string }[] };
  presentaciones: { numero: number; anuladaEn: string | null; motivoAnulacion: string | null }[];
};
const LEY = [{ desde: 0, fijo: 0, alicuota: 25 }, { desde: 5000000, fijo: 1250000, alicuota: 30 }, { desde: 50000000, fijo: 14750000, alicuota: 35 }];

describe('DJ de Ganancias de sociedades (E46)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (o: { sinIndices?: boolean } = {}) => {
    const v = await prepararVentas(app, prisma);
    if (!o.sinIndices) for (const [anio, mes, valor] of [[2023, 12, 50], [2025, 12, 100], [2026, 12, 150]]) await prisma.indiceInflacion.create({ data: { anio, mes, valor, actualizadoPor: 't' } });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: v.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const venta = await v.http.post('/api/contabilidad/asientos', { fecha: '2026-03-10', descripcion: 'Venta', renglones: [{ cuentaContableId: await v.cuenta('1.1.01.001'), debe: 10000000 }, { cuentaContableId: await v.cuenta('4.1.01'), haber: 10000000 }] });
    if (venta.status !== 201) throw new Error(JSON.stringify(venta.body));
    const dj = async () => { const r = await v.http.get(`/api/impuestos/dj-ganancias?ejercicioId=${ej.id}`); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body as Dj; };
    const escala = () => v.http.put('/api/impuestos/escala-sociedades/2026', { tramos: LEY });
    const recibo = (importeRet: number) => v.http.post('/api/ventas/recibos', {
      terceroId: v.clienteRI.id, fecha: '2026-11-05', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1000 }, cheques: [], transferencias: [],
      retenciones: [{ tipo: 'GANANCIAS', numeroCertificado: `C-${importeRet}`, fecha: '2026-11-05', importe: importeRet }], aplicaciones: [],
    });
    const cerrar = async () => {
      for (const p of ej.periodos.slice(0, 11)) expect((await v.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {})).status).toBe(200);
      await v.http.post('/api/contabilidad/ejercicios/siguiente', {});
      expect((await v.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).status).toBe(200);
    };
    return { ...v, ej, dj, escala, recibo, cerrar };
  };
  const num = (x: unknown) => Number(x);

  it('sin escala: error; con escala y un ajuste manual: impuesto y anticipos', async () => {
    const x = await escenario();
    const sin = await x.http.get(`/api/impuestos/dj-ganancias?ejercicioId=${x.ej.id}`);
    expect([sin.status, sin.body.message]).toEqual([400, 'Cargue la escala de Ganancias de sociedades de 2026']);
    expect((await x.escala()).status).toBe(200);
    expect((await x.http.post('/api/impuestos/dj-ganancias/ajustes', { ejercicioId: x.ej.id, concepto: 'Gastos no deducibles', importe: 500000 })).status).toBe(201);
    const d = (await x.dj()).determinacion;
    expect([num(d.resultadoContable), num(d.ajusteAmortizaciones), num(d.ajusteInflacion), num(d.gananciaNetaImponible), num(d.impuestoDeterminado)]).toEqual([10000000, 0, 0, 10500000, 2900000]);
  });

  it('retenciones sufridas (las de recibos anulados no cuentan), datos cargados y saldo', async () => {
    const x = await escenario();
    await x.escala();
    await x.http.post('/api/impuestos/dj-ganancias/ajustes', { ejercicioId: x.ej.id, concepto: 'Gastos no deducibles', importe: 500000 });
    expect((await x.recibo(100000)).status).toBe(201);
    const anulado = await x.recibo(7000);
    expect((await x.http.post(`/api/ventas/recibos/${anulado.body.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    let d = (await x.dj()).determinacion;
    expect([num(d.pagosACuenta), num(d.saldo), num(d.anticipos[0].importe), d.anticipos[0].mes]).toEqual([100000, 2800000, 700000, '2027-06']);
    expect((await x.http.put('/api/impuestos/dj-ganancias/datos', { ejercicioId: x.ej.id, quebrantosAnteriores: 0, anticiposIngresados: 300000, saldoAFavorAnterior: 0, impuestoCheque: 200000, otrosPagos: 0 })).status).toBe(200);
    const r = await x.dj();
    d = r.determinacion;
    expect([r.datos.anticiposIngresados, num(d.pagosACuenta), num(d.saldo), num(d.anticipos[0].importe)]).toEqual(['300000.00', 600000, 2300000, 650000]);
  });

  it('el ajuste por inflación contable no cambia el resultado contable', async () => {
    const x = await escenario();
    await x.escala();
    await prisma.asiento.create({ data: { empresaId: x.empresaId, numero: 9100, fecha: new Date('2026-12-31'), descripcion: 'Ajuste', origenTipo: 'AJUSTE_INFLACION', origenId: x.ej.id, creadoPor: 't', ejercicioId: x.ej.id, renglones: { create: [
      { empresaId: x.empresaId, cuentaContableId: await x.cuenta('3.1.02'), debe: 0, haber: 0 }, { empresaId: x.empresaId, cuentaContableId: await x.cuenta('4.2.03'), debe: 0, haber: 300000 }, { empresaId: x.empresaId, cuentaContableId: await x.cuenta('3.1.02'), debe: 300000, haber: 0 },
    ] } } });
    expect(num((await x.dj()).determinacion.resultadoContable)).toBe(10000000);
  });

  it('presentar: con el ejercicio cerrado, foto congelada, bloqueos, anulación y rectificativa', async () => {
    const x = await escenario();
    await x.escala();
    const abierto = await x.http.post('/api/impuestos/dj-ganancias/presentar', { ejercicioId: x.ej.id });
    expect([abierto.status, abierto.body.message]).toEqual([400, 'Cierre el ejercicio antes de presentar la DJ']);
    const sinPresentar = await x.http.post('/api/impuestos/dj-ganancias/anular', { ejercicioId: x.ej.id, motivo: 'x' });
    expect([sinPresentar.status, sinPresentar.body.message]).toEqual([400, 'La DJ no está presentada']);
    await x.cerrar();
    expect((await x.http.post('/api/impuestos/dj-ganancias/presentar', { ejercicioId: x.ej.id })).status).toBe(200);
    let r = await x.dj();
    expect([r.estado, r.presentaciones.map((p) => p.numero), num(r.determinacion.impuestoDeterminado)]).toEqual(['PRESENTADA', [0], 2750000]);
    // La foto no cambia con la escala
    await x.http.put('/api/impuestos/escala-sociedades/2026', { tramos: [{ desde: 0, fijo: 0, alicuota: 35 }] });
    expect(num((await x.dj()).determinacion.impuestoDeterminado)).toBe(2750000);
    const bloqueado = 'La DJ de Ganancias del ejercicio está presentada';
    for (const q of [
      () => x.http.put('/api/impuestos/dj-ganancias/datos', { ejercicioId: x.ej.id, quebrantosAnteriores: 1, anticiposIngresados: 0, saldoAFavorAnterior: 0, impuestoCheque: 0, otrosPagos: 0 }),
      () => x.http.post('/api/impuestos/dj-ganancias/ajustes', { ejercicioId: x.ej.id, concepto: 'x', importe: 1 }),
      () => x.http.post('/api/impuestos/ajuste-inflacion/partidas', { ejercicioId: x.ej.id, concepto: 'x', tipo: 'ACTIVO_INICIO', importe: 1 }),
    ]) { const res = await q(); expect([res.status, res.body.message]).toEqual([400, bloqueado]); }
    expect((await x.http.post('/api/impuestos/dj-ganancias/anular', { ejercicioId: x.ej.id, motivo: 'Rectificativa' })).status).toBe(200);
    r = await x.dj();
    expect([r.estado, r.presentaciones[0].motivoAnulacion, !!r.presentaciones[0].anuladaEn, num(r.determinacion.impuestoDeterminado)]).toEqual(['BORRADOR', 'Rectificativa', true, 3500000]);
    expect((await x.http.post('/api/impuestos/dj-ganancias/presentar', { ejercicioId: x.ej.id })).status).toBe(200);
    expect((await x.dj()).presentaciones.map((p) => p.numero)).toEqual([0, 1]);
  });

  it('faltan índices para el ajuste por inflación: error', async () => {
    const x = await escenario({ sinIndices: true });
    await x.escala();
    const r = await x.http.get(`/api/impuestos/dj-ganancias?ejercicioId=${x.ej.id}`);
    expect([r.status, r.body.message]).toMatchObject([400, expect.stringMatching(/^Faltan los índices de: /)]);
  });

  it('escala inválida, Excel, validación y permiso', async () => {
    const x = await escenario();
    expect((await x.http.put('/api/impuestos/escala-sociedades/2026', { tramos: [{ desde: 0, fijo: 0, alicuota: 25 }, { desde: 0, fijo: 0, alicuota: 30 }] })).status).toBe(400);
    await x.escala();
    expect((await x.http.get('/api/impuestos/escala-sociedades/2026')).body).toHaveLength(3);
    expect((await x.http.get(`/api/impuestos/dj-ganancias?ejercicioId=${x.ej.id}&formato=xlsx`)).headers['content-type']).toContain('spreadsheetml');
    const r = await x.http.get('/api/impuestos/dj-ganancias');
    expect([r.status, r.body.message]).toEqual([400, 'Indique el ejercicio']);
    const otro = await otroUsuario(app, prisma, x.empresaId, ['bienes.ver']);
    expect((await otro.http.get(`/api/impuestos/dj-ganancias?ejercicioId=${x.ej.id}`)).status).toBe(403);
  });

  it('revisión: no se puede sacar un ajuste de una DJ presentada pasándolo a otro ejercicio', async () => {
    const x = await escenario();
    await x.escala();
    const a = await x.http.post('/api/impuestos/dj-ganancias/ajustes', { ejercicioId: x.ej.id, concepto: 'Gastos no deducibles', importe: 500000 });
    await x.cerrar();
    expect((await x.http.post('/api/impuestos/dj-ganancias/presentar', { ejercicioId: x.ej.id })).status).toBe(200);
    const ej2 = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: x.empresaId, numero: 2 } });
    const r = await x.http.put(`/api/impuestos/dj-ganancias/ajustes/${a.body.id}`, { ejercicioId: ej2.id, concepto: 'Gastos no deducibles', importe: 500000 });
    expect([r.status, r.body.message]).toEqual([400, 'La DJ de Ganancias del ejercicio está presentada']);
  });

  it('revisión: guardar datos espera a una presentación en curso y después la respeta', async () => {
    const x = await escenario();
    await x.escala();
    await x.dj();
    let liberar!: () => void;
    const espera = new Promise<void>((res) => (liberar = res));
    const tomado = new Promise<void>((ok) => {
      void prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT 1 FROM "DjGananciasSociedades" WHERE "ejercicioId" = $1::uuid FOR UPDATE', x.ej.id);
        ok();
        await espera;
        // La «presentación» en curso termina marcando la DJ como presentada
        await tx.$executeRawUnsafe('UPDATE "DjGananciasSociedades" SET "estado" = \'PRESENTADA\' WHERE "ejercicioId" = $1::uuid', x.ej.id);
      }, { timeout: 20000 });
    });
    await tomado;
    const inicio = Date.now();
    const pedido = x.http.put('/api/impuestos/dj-ganancias/datos', { ejercicioId: x.ej.id, quebrantosAnteriores: 0, anticiposIngresados: 1, saldoAFavorAnterior: 0, impuestoCheque: 0, otrosPagos: 0 }).then((r) => ({ r, ms: Date.now() - inicio }));
    setTimeout(liberar, 600);
    const { r, ms } = await pedido;
    expect(ms).toBeGreaterThanOrEqual(550);
    expect([r.status, r.body.message]).toEqual([400, 'La DJ de Ganancias del ejercicio está presentada']);
  });

  it('revisión: las retenciones de Ganancias de liquidaciones de tarjetas son pago a cuenta (las anuladas no)', async () => {
    const x = await escenario();
    await x.escala();
    const base = { empresaId: x.empresaId, tarjetaId: x.empresaId, fecha: new Date('2026-09-10'), bruto: 100000, arancel: 0, ivaArancel: 0, neto: 60000, cuentaBancariaId: x.empresaId, creadoPor: 't' };
    await prisma.liquidacionTarjeta.create({ data: { ...base, numero: 1, impuestos: { create: [{ empresaId: x.empresaId, clase: 'RETENCION', tipo: 'GANANCIAS', importe: 40000 }, { empresaId: x.empresaId, clase: 'RETENCION', tipo: 'IVA', importe: 9000 }] } } });
    await prisma.liquidacionTarjeta.create({ data: { ...base, numero: 2, estado: 'ANULADO', impuestos: { create: [{ empresaId: x.empresaId, clase: 'RETENCION', tipo: 'GANANCIAS', importe: 7000 }] } } });
    const d = (await x.dj()).determinacion;
    expect([d.retenciones, d.pagosACuenta]).toEqual(['40000.00', '40000.00']);
  });

  it('revisión: el monto fijo de cada tramo tiene que continuar el anterior', async () => {
    const x = await escenario();
    const r = await x.http.put('/api/impuestos/escala-sociedades/2026', { tramos: [{ desde: 0, fijo: 0, alicuota: 25 }, { desde: 5000000, fijo: 0, alicuota: 30 }] });
    expect([r.status, r.body.message]).toEqual([400, 'El monto fijo del tramo 2 no continúa el tramo anterior (esperado 1250000.00)']);
    expect((await x.escala()).status).toBe(200);
  });
});
