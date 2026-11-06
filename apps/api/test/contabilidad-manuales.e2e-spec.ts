import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('asientos manuales', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function preparar() {
    const s = await sesionConPlan(app, prisma);
    const gasto = await s.cuenta('5.2.01');
    const caja = await s.cuenta('1.1.01.001');
    const asiento = (importe = 1000, fecha = '2026-11-03') => ({
      fecha, descripcion: 'Pago de gastos menores', renglones: [{ cuentaContableId: gasto, debe: importe, detalle: 'Varios' }, { cuentaContableId: caja, haber: importe }],
    });
    return { ...s, gasto, caja, asiento };
  }

  it('alta de un asiento manual', async () => {
    const s = await preparar();
    const r = await s.http.post('/api/contabilidad/asientos', s.asiento());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tipo: 'MANUAL', origenTipo: 'MANUAL', numeroDefinitivo: null, descripcion: 'Pago de gastos menores' });
    expect(r.body.origenId).toBe(r.body.id);
    expect(r.body.renglones).toHaveLength(2);
  });

  it('validaciones: balance, renglones inválidos, cuenta no imputable', async () => {
    const s = await preparar();
    const sinBalance = await s.http.post('/api/contabilidad/asientos', { ...s.asiento(), renglones: [{ cuentaContableId: s.gasto, debe: 1000 }, { cuentaContableId: s.caja, haber: 900 }] });
    expect(sinBalance.status).toBe(400);
    expect(sinBalance.body.message).toBe('El asiento no balancea (debe 1000.00, haber 900.00)');
    for (const r of [{ debe: 10, haber: 10 }, { debe: -5 }, { debe: 0 }, {}, { debe: 1.234 }]) {
      const x = await s.http.post('/api/contabilidad/asientos', { ...s.asiento(), renglones: [{ cuentaContableId: s.gasto, ...r }, { cuentaContableId: s.caja, haber: 10 }] });
      expect(x.status).toBe(400);
      expect(Object.keys(x.body.campos)[0]).toMatch(/^renglones\.0/);
    }
    expect((await s.http.post('/api/contabilidad/asientos', { ...s.asiento(), renglones: [{ cuentaContableId: s.gasto, debe: 10 }] })).status).toBe(400);
    const rubro = await s.cuenta('5.2');
    expect((await s.http.post('/api/contabilidad/asientos', { ...s.asiento(), renglones: [{ cuentaContableId: rubro, debe: 10 }, { cuentaContableId: s.caja, haber: 10 }] })).status).toBe(400);
  });

  it('modificar con el mes abierto; versión vieja 409; mes cerrado 400', async () => {
    const s = await preparar();
    const a = (await s.http.post('/api/contabilidad/asientos', s.asiento())).body;
    const m = await s.http.put(`/api/contabilidad/asientos/${a.id}`, { ...s.asiento(2500), version: a.version, descripcion: 'Corregido' });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ descripcion: 'Corregido', version: a.version + 1 });
    expect(m.body.renglones.map((r: { debe: string }) => r.debe).sort()).toEqual(['0', '2500']);
    expect((await s.http.put(`/api/contabilidad/asientos/${a.id}`, { ...s.asiento(), version: a.version })).status).toBe(409);
    await prisma.periodoContable.updateMany({ where: { empresaId: s.empresaId, anio: 2026, mes: 10 }, data: { estado: 'CERRADO' } });
    const aMesCerrado = await s.http.put(`/api/contabilidad/asientos/${a.id}`, { ...s.asiento(100, '2026-10-20'), version: m.body.version });
    expect(aMesCerrado.status).toBe(400);
    expect(aMesCerrado.body.message).toBe('El período 10/2026 está cerrado');
    await prisma.periodoContable.updateMany({ where: { empresaId: s.empresaId, anio: 2026, mes: 11 }, data: { estado: 'CERRADO' } });
    expect((await s.http.put(`/api/contabilidad/asientos/${a.id}`, { ...s.asiento(), version: m.body.version })).status).toBe(400);
    expect((await s.http.delete(`/api/contabilidad/asientos/${a.id}`)).status).toBe(400);
  });

  it('eliminar y anular', async () => {
    const s = await preparar();
    const a = (await s.http.post('/api/contabilidad/asientos', s.asiento())).body;
    expect((await s.http.delete(`/api/contabilidad/asientos/${a.id}`)).status).toBe(200);
    expect(await prisma.asiento.count({ where: { id: a.id } })).toBe(0);
    const b = (await s.http.post('/api/contabilidad/asientos', s.asiento(700))).body;
    expect((await s.http.post(`/api/contabilidad/asientos/${b.id}/anular`, { fecha: '2026-11-04' })).status).toBe(400);
    const an = await s.http.post(`/api/contabilidad/asientos/${b.id}/anular`, { fecha: '2026-11-04', motivo: 'Error de imputación' });
    expect(an.status).toBe(201);
    expect(an.body).toMatchObject({ tipo: 'MANUAL', anulaAId: b.id });
    const renglones = await prisma.asientoRenglon.findMany({ where: { asientoId: an.body.id } });
    expect(renglones.find((r) => r.cuentaContableId === s.gasto)!.haber.toString()).toBe('700');
    expect((await s.http.post(`/api/contabilidad/asientos/${b.id}/anular`, { fecha: '2026-11-04', motivo: 'otra vez' })).status).toBe(409);
  });

  it('los asientos automáticos no se tocan desde contabilidad; sin permiso 403', async () => {
    const s = await preparar();
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    await facturaPendiente(s.http, prisma, { proveedorId, neto: 100, fecha: '2026-11-02' });
    const auto = await prisma.asiento.findFirstOrThrow({ where: { tipo: 'AUTOMATICO' } });
    const msg = 'Los asientos automáticos se anulan desde su comprobante';
    expect((await s.http.put(`/api/contabilidad/asientos/${auto.id}`, { ...s.asiento(), version: 0 })).body.message).toBe(msg);
    expect((await s.http.delete(`/api/contabilidad/asientos/${auto.id}`)).body.message).toBe(msg);
    expect((await s.http.post(`/api/contabilidad/asientos/${auto.id}/anular`, { fecha: '2026-11-04', motivo: 'x' })).body.message).toBe(msg);
    const sinPermiso = await otroUsuario(app, prisma, s.empresaId, ['plancuentas.ver']);
    expect((await sinPermiso.http.post('/api/contabilidad/asientos', s.asiento())).status).toBe(403);
  });
});
