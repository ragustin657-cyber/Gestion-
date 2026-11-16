import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

function textoPdf(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) partes.push(Buffer.from([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join(''), 'hex').toString('latin1'));
  return partes.join('\n');
}

describe('pulido 22: importes y validaciones', () => {
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
    await s.escala('Vendedor B', '2026-11', 1000000);
    const e = await s.empleado();
    const mensual = async () => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    return { ...s, e, mensual };
  };

  it('neto negativo no queda pendiente', async () => {
    const x = await escenario();
    const c = (await x.http.post('/api/sueldos/conceptos', { codigo: '600', nombre: 'Préstamo', clase: 'DESCUENTO', tipo: 'FIJO', parametros: { importe: 0 }, orden: 600 })).body as { id: string };
    const m = await x.mensual();
    expect((await x.http.put(`/api/sueldos/liquidaciones/${m.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'IMPORTE', conceptoId: c.id, importe: 2000000 }] })).status).toBe(200);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    const v = (await x.http.get(`/api/sueldos/liquidaciones/${m.id}`)).body;
    expect(Number(v.recibos[0].neto)).toBeLessThan(0);
    expect([v.pendientePago, v.recibos[0].sinNeto]).toEqual(['0.00', true]);
    const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const ars = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002') })).body;
    expect((await x.http.post(`/api/sueldos/liquidaciones/${m.id}/pagos`, { fecha: '2026-11-30', cuentaBancariaId: ars.id })).body.message).toBe('No hay recibos pendientes de pago');
    const pdf = await x.http.get(`/api/sueldos/liquidaciones/${m.id}/recibos.pdf`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (ch: Buffer) => p.push(ch)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect(textoPdf(pdf.body as Buffer)).toContain('menos pesos');
  });

  it('ausencias topeadas', async () => {
    const x = await escenario();
    const otro = await x.empleado({ fechaIngreso: '2026-11-20' });
    const m = await x.mensual();
    const r = await x.http.put(`/api/sueldos/liquidaciones/${m.id}/novedades`, { empleadoId: otro.id, novedades: [{ tipo: 'AUSENCIA_INJUSTIFICADA', cantidad: 15 }] });
    expect([r.status, r.body.message]).toEqual([400, 'Las ausencias (15 días) superan los días trabajados del mes (11)']);
  });

  it('cuenta del concepto', async () => {
    const x = await escenario();
    const r = await x.http.post('/api/sueldos/conceptos', { codigo: '601', nombre: 'X', clase: 'DESCUENTO', tipo: 'FIJO', parametros: { importe: 10 }, orden: 601, cuentaContableId: await x.cuenta('2.1.03') });
    expect([r.status, r.body.message]).toEqual([400, 'Cuenta contable inválida: debe ser imputable y activa']);
  });

  it('novedades de una final', async () => {
    const x = await escenario();
    const otro = await x.empleado();
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' })).body as { id: string };
    const r = await x.http.put(`/api/sueldos/liquidaciones/${f.id}/novedades`, { empleadoId: otro.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 2 }] });
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación final es de otro empleado']);
  });

  it('saldo inicial', async () => {
    const x = await escenario();
    const r = await x.http.put('/api/sueldos/vacaciones/saldo-inicial', { empleadoId: x.e.id, anio: 2020, dias: 5 });
    expect([r.status, r.body.message]).toEqual([400, 'El año es anterior al ingreso del empleado']);
    const rs = await Promise.all([1, 2, 3].map((d) => x.http.put('/api/sueldos/vacaciones/saldo-inicial', { empleadoId: x.e.id, anio: 2025, dias: d })));
    expect(rs.every((y) => y.status === 200 || y.status === 400)).toBe(true);
  });

  it('ficha con años de saldo inicial', async () => {
    const x = await escenario();
    await x.http.put('/api/sueldos/vacaciones/saldo-inicial', { empleadoId: x.e.id, anio: 2024, dias: 5 });
    const v = (await x.http.get(`/api/sueldos/empleados/${x.e.id}/vacaciones`)).body as { saldos: { anio: number }[] };
    expect(v.saldos.map((y) => y.anio)).toContain(2024);
  });

  it('aviso de conceptos de vacaciones', async () => {
    const x = await escenario();
    expect((await x.http.get('/api/sueldos/conceptos/avisos')).body).toEqual([]);
    await prisma.concepto.updateMany({ where: { empresaId: x.empresaId, codigo: '151' }, data: { activo: false } });
    expect((await x.http.get('/api/sueldos/conceptos/avisos')).body).toEqual(['Faltan los conceptos de vacaciones (pago y descuento): las vacaciones no se liquidan']);
  });
});
