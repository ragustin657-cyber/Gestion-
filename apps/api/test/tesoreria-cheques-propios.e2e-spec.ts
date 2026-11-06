import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('débito de cheques propios', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** OP de 18.150 pagada con un e-cheq (diferido o al día). */
  async function pagadaConCheque(fechaCheque: string) {
    const t = await prepararTesoreria(app, prisma);
    const echeq = (await t.http.post('/api/tesoreria/chequeras', { cuentaBancariaId: t.ars.id, tipo: 'ECHEQ' })).body;
    const fc = await facturaPendiente(t.http, prisma, { proveedorId: t.proveedorId, neto: 15000 });
    const b = await t.http.post('/api/pagos/ordenes', { terceroId: t.proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: fc.movimientoId, importe: 18150 }] });
    const op = (await t.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version })).body;
    const p = await t.http.post(`/api/pagos/ordenes/${op.id}/pagar`, {
      version: op.version, fechaPago: '2026-11-15',
      medios: [{ tipo: 'CHEQUE', monedaCodigo: 'ARS', importe: 18150, chequeraId: echeq.id, chequeNumero: 'E-1', chequeFechaPago: fechaCheque }],
    });
    if (p.status !== 200) throw new Error(JSON.stringify(p.body));
    const cheque = await prisma.chequePropio.findFirstOrThrow({ where: { ordenPagoId: op.id } });
    return { t, op: p.body, cheque };
  }

  it('debitar un cheque diferido: egreso del banco y asiento contra cheques diferidos', async () => {
    const { t, cheque } = await pagadaConCheque('2026-12-15');
    expect(await t.saldoBanco(t.ars.id)).toBe(0);
    const lista = (await t.http.get('/api/tesoreria/cheques-propios?estado=EMITIDO')).body;
    expect(lista.items.map((c: { id: string }) => c.id)).toEqual([cheque.id]);
    expect(lista.items[0]).toMatchObject({ numero: 'E-1', diferido: true, beneficiario: { razonSocial: expect.any(String) }, cuentaBancaria: { numero: '1' } });
    const r = await t.http.post('/api/tesoreria/cheques-propios/debitar', { fecha: '2026-12-15', cheques: [cheque.id] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ debitados: 1 });
    const c = await prisma.chequePropio.findUniqueOrThrow({ where: { id: cheque.id } });
    expect(c.estado).toBe('DEBITADO');
    expect(c.fechaDebito!.toISOString().slice(0, 10)).toBe('2026-12-15');
    expect(await t.saldoBanco(t.ars.id)).toBe(-18150);
    const asiento = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'DEBITO_CHEQUE', origenId: cheque.id } });
    expect(await t.asiento(asiento.id)).toEqual({ '2.1.01.002': ['18150', '0'], '1.1.01.002': ['0', '18150'] });
    expect((await t.http.post('/api/tesoreria/cheques-propios/debitar', { fecha: '2026-12-15', cheques: [cheque.id] })).status).toBe(409);
    expect((await t.rosario.post('/api/tesoreria/cheques-propios/debitar', { fecha: '2026-12-15', cheques: [cheque.id] })).status).toBe(403);
  });

  it('un cheque al día solo cambia de estado', async () => {
    const { t, cheque } = await pagadaConCheque('2026-11-15');
    const movs = await prisma.movimientoTesoreria.count();
    const asientos = await prisma.asiento.count();
    const r = await t.http.post('/api/tesoreria/cheques-propios/debitar', { fecha: '2026-11-16', cheques: [cheque.id] });
    expect(r.status).toBe(200);
    expect((await prisma.chequePropio.findUniqueOrThrow({ where: { id: cheque.id } })).estado).toBe('DEBITADO');
    expect(await prisma.movimientoTesoreria.count()).toBe(movs);
    expect(await prisma.asiento.count()).toBe(asientos);
  });

  it('una OP con cheques debitados no se puede anular; un cheque anulado no se debita', async () => {
    const a = await pagadaConCheque('2026-12-15');
    await a.t.http.post('/api/tesoreria/cheques-propios/debitar', { fecha: '2026-12-15', cheques: [a.cheque.id] });
    const r = await a.t.http.post(`/api/pagos/ordenes/${a.op.id}/anular`, { version: a.op.version, motivo: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La orden tiene cheques ya debitados');

    const b = await pagadaConCheque('2026-12-15');
    await b.t.http.post(`/api/pagos/ordenes/${b.op.id}/anular`, { version: b.op.version, motivo: 'x' });
    expect((await b.t.http.post('/api/tesoreria/cheques-propios/debitar', { fecha: '2026-12-15', cheques: [b.cheque.id] })).status).toBe(409);
  });
});
