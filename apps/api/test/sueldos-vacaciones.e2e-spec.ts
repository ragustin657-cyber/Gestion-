import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAMPOS_F931 } from '../src/sueldos/f931-diseno';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

function campo(linea: string, n: number): string {
  let pos = 0;
  for (const c of CAMPOS_F931) { if (c.numero === n) return linea.slice(pos, pos + c.largo); pos += c.largo; }
  throw new Error(`campo ${n}`);
}
type Recibo = { empleadoId: string; neto: string; totalRemunerativo: string; renglones: { codigo: string; importe: string }[] };

describe('sueldos: vacaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-10', 1000000);
    const e = await s.empleado();
    const periodo = (d: Record<string, unknown>) => s.http.post('/api/sueldos/vacaciones', { empleadoId: e.id, anio: 2026, ...d });
    const mensual = async (mes: number) => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes, fechaPago: `2026-${mes}-28` })).body as { id: string };
    const recibo = async (id: string) => ((await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body.recibos as Recibo[]).find((r) => r.empleadoId === e.id)!;
    const imp = (r: Recibo | undefined, c: string) => r?.renglones.filter((x) => x.codigo === c).map((x) => x.importe);
    const saldo = async (anio = 2026) => ((await s.http.get(`/api/sueldos/vacaciones?anio=${anio}`)).body as { empleadoId: string; corresponden: number; tomados: number; pendientes: number; periodos: { id: string; liquidado: boolean }[] }[]).find((x) => x.empleadoId === e.id)!;
    return { ...s, e, periodo, mensual, recibo, imp, saldo };
  };

  it('alta con avisos y saldo', async () => {
    const x = await escenario();
    const r = await x.periodo({ desde: '2026-11-09', hasta: '2026-11-22' });
    expect([r.status, r.body.avisos]).toEqual([201, []]);
    expect(await x.saldo()).toMatchObject({ corresponden: 21, tomados: 14, pendientes: 7 });
    expect((await x.periodo({ desde: '2026-12-01', hasta: '2026-12-10' })).body.avisos).toEqual(['Supera el saldo de 2026 (quedan 7 días)']);
    expect((await x.periodo({ desde: '2027-06-01', hasta: '2027-06-05' })).body.avisos).toContain('Comienza fuera del período legal (1/10 al 30/4)');
  });

  it('validaciones', async () => {
    const x = await escenario();
    await x.periodo({ desde: '2026-11-09', hasta: '2026-11-22' });
    const sup = await x.periodo({ desde: '2026-11-20', hasta: '2026-11-25' });
    expect([sup.status, sup.body.message]).toEqual([400, 'El período se superpone con otro del empleado (09/11/2026 al 22/11/2026)']);
    expect((await x.periodo({ desde: '2021-02-01', hasta: '2021-02-05', anio: 2021 })).status).toBe(400);
    await prisma.empleado.update({ where: { id: x.e.id }, data: { fechaEgreso: new Date('2026-12-15T00:00:00Z') } });
    const eg = await x.periodo({ desde: '2026-12-10', hasta: '2026-12-20' });
    expect([eg.status, eg.body.message]).toEqual([400, 'El período termina después del egreso del empleado (15/12/2026)']);
  });

  it('la mensual paga las vacaciones', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    const p = (await x.periodo({ desde: '2026-11-09', hasta: '2026-11-22' })).body as { id: string };
    const r = await x.recibo(m.id);
    expect([x.imp(r, '150'), x.imp(r, '151'), r.neto]).toEqual([['588000.00'], ['-490000.00'], '994549.32']);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    expect((await x.saldo()).periodos[0].liquidado).toBe(true);
    const put = await x.http.put(`/api/sueldos/vacaciones/${p.id}`, { empleadoId: x.e.id, anio: 2026, desde: '2026-11-09', hasta: '2026-11-20' });
    expect([put.status, put.body.message]).toEqual([400, 'El período ya se pagó en la liquidación mensual de 11/2026: reábrala para modificarlo']);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/reabrir`);
    expect((await x.http.put(`/api/sueldos/vacaciones/${p.id}`, { empleadoId: x.e.id, anio: 2026, desde: '2026-11-09', hasta: '2026-11-20' })).status).toBe(200);
  });

  it('período de otro mes', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    await x.periodo({ desde: '2027-01-04', hasta: '2027-01-17' });
    expect(x.imp(await x.recibo(m.id), '150')).toEqual([]);
  });

  it('período eliminado tras reabrir', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    const p = (await x.periodo({ desde: '2026-11-09', hasta: '2026-11-22' })).body as { id: string };
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/reabrir`);
    expect((await x.http.delete(`/api/sueldos/vacaciones/${p.id}`)).status).toBe(200);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/recalcular`);
    const r = await x.recibo(m.id);
    expect([x.imp(r, '150'), x.imp(r, '151')]).toEqual([[], []]);
  });

  it('concepto inactivo', async () => {
    const x = await escenario();
    await prisma.concepto.updateMany({ where: { empresaId: x.empresaId, codigo: '150' }, data: { activo: false } });
    const m = await x.mensual(11);
    await x.periodo({ desde: '2026-11-09', hasta: '2026-11-22' });
    expect(x.imp(await x.recibo(m.id), '150')).toEqual([]);
    expect((await x.saldo()).tomados).toBe(14);
  });

  it('mes cerrado', async () => {
    const x = await escenario();
    const oct = await x.mensual(10);
    await x.http.post(`/api/sueldos/liquidaciones/${oct.id}/cerrar`);
    const r = await x.periodo({ desde: '2026-10-05', hasta: '2026-10-18' });
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación mensual de 10/2026 ya está cerrada: marque el período como liquidado fuera del sistema o reabra la liquidación']);
    expect((await x.periodo({ desde: '2026-10-05', hasta: '2026-10-18', liquidadoAfuera: true })).status).toBe(201);
    expect((await x.saldo()).tomados).toBe(14);
  });

  it('saldo inicial', async () => {
    const x = await escenario();
    expect((await x.http.put('/api/sueldos/vacaciones/saldo-inicial', { empleadoId: x.e.id, anio: 2025, dias: 10 })).status).toBe(200);
    expect(await x.saldo(2025)).toMatchObject({ corresponden: 10, pendientes: 10 });
    expect(await x.saldo(2024)).toMatchObject({ corresponden: 0 });
  });

  it('final descuenta lo tomado', async () => {
    const x = await escenario();
    await x.periodo({ desde: '2026-10-01', hasta: '2026-10-14', liquidadoAfuera: true });
    const otro = await x.periodo({ desde: '2026-11-20', hasta: '2026-11-25' });
    const baja = () => x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' });
    const r1 = await baja();
    expect([r1.status, r1.body.message]).toEqual([400, 'El empleado tiene vacaciones registradas después del egreso: modifíquelas antes de darlo de baja']);
    await x.http.delete(`/api/sueldos/vacaciones/${otro.body.id}`);
    const f = (await baja()).body as { id: string };
    expect(x.imp(await x.recibo(f.id), '330')).toEqual(['198074.73']);
  });

  it('mejor remuneración sin vacaciones', async () => {
    const x = await escenario();
    const oct = await x.mensual(10);
    await x.http.put(`/api/sueldos/liquidaciones/${oct.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 10 }] });
    await x.periodo({ desde: '2026-10-05', hasta: '2026-10-18' });
    await x.http.post(`/api/sueldos/liquidaciones/${oct.id}/cerrar`);
    const ro = await prisma.reciboSueldo.findFirstOrThrow({ where: { liquidacionId: oct.id }, include: { renglones: true } });
    const vac = ro.renglones.filter((y) => y.codigo === '150' || y.codigo === '151').reduce((s, y) => s.plus(y.importe), ro.totalRemunerativo.minus(ro.totalRemunerativo));
    expect(vac.toFixed(2)).toBe('98000.00');
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' })).body as { id: string };
    expect(x.imp(await x.recibo(f.id), '300')).toEqual([ro.totalRemunerativo.minus(vac).times(6).toFixed(2)]);
  });

  it('F.931 con vacaciones', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    await x.periodo({ desde: '2026-11-02', hasta: '2026-11-06' });
    await x.periodo({ desde: '2026-11-16', hasta: '2026-11-24' });
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    const r = await x.http.get('/api/sueldos/f931?anio=2026&mes=11').buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const linea = (r.body as Buffer).toString('latin1').split('\r\n')[0];
    expect(campo(linea, 40)).toBe('   588000,00');
    const rem = (await x.recibo(m.id)).totalRemunerativo;
    expect(campo(linea, 13)).toBe(Number(rem).toFixed(2).replace('.', ',').padStart(12));
  });
});
