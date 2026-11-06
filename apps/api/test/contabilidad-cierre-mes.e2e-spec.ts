import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('cierre de mes y numeración definitiva', () => {
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
    const asiento = (fecha: string, descripcion: string) =>
      s.http.post('/api/contabilidad/asientos', { fecha, descripcion, renglones: [{ cuentaContableId: gasto, debe: 10 }, { cuentaContableId: caja, haber: 10 }] });
    const periodo = async (mes: number) => (await prisma.periodoContable.findFirstOrThrow({ where: { empresaId: s.empresaId, anio: 2026, mes } })).id;
    const cerrar = async (mes: number) => s.http.post(`/api/contabilidad/periodos/${await periodo(mes)}/cerrar`, {});
    const numero = async (descripcion: string) => (await prisma.asiento.findFirstOrThrow({ where: { empresaId: s.empresaId, descripcion } })).numeroDefinitivo;
    return { ...s, asiento, periodo, cerrar, numero };
  }

  it('numera en orden cronológico, continúa entre meses y exige el orden de cierre', async () => {
    const s = await preparar();
    await s.asiento('2026-01-20', 'A 20/01');
    await s.asiento('2026-01-05', 'B 05/01 primero');
    await s.asiento('2026-01-05', 'C 05/01 segundo');
    await s.asiento('2026-02-10', 'D febrero');
    const r = await s.cerrar(1);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'CERRADO', numerados: 3 });
    expect([await s.numero('B 05/01 primero'), await s.numero('C 05/01 segundo'), await s.numero('A 20/01')]).toEqual([1, 2, 3]);
    const fuera = await s.cerrar(3);
    expect(fuera.status).toBe(400);
    expect(fuera.body.message).toBe('Cierre primero el período 02/2026');
    expect((await s.cerrar(2)).status).toBe(200);
    expect(await s.numero('D febrero')).toBe(4);
    // Mes cerrado: no admite asientos
    const tarde = await s.asiento('2026-01-25', 'tarde');
    expect(tarde.status).toBe(400);
    expect(tarde.body.message).toBe('El período 01/2026 está cerrado');
  });

  it('reabrir: solo el último cerrado, borra y reasigna los números', async () => {
    const s = await preparar();
    await s.asiento('2026-01-05', 'enero');
    await s.asiento('2026-02-05', 'febrero');
    await s.cerrar(1);
    await s.cerrar(2);
    expect((await s.http.post(`/api/contabilidad/periodos/${await s.periodo(1)}/reabrir`, { motivo: 'x' })).status).toBe(400);
    expect((await s.http.post(`/api/contabilidad/periodos/${await s.periodo(2)}/reabrir`, {})).status).toBe(400);
    const r = await s.http.post(`/api/contabilidad/periodos/${await s.periodo(2)}/reabrir`, { motivo: 'Falta un ajuste' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'ABIERTO', motivoReapertura: 'Falta un ajuste' });
    expect(await s.numero('febrero')).toBeNull();
    await s.asiento('2026-02-01', 'ajuste');
    await s.cerrar(2);
    expect([await s.numero('ajuste'), await s.numero('febrero')]).toEqual([2, 3]);
  });

  it('un asiento cargado mientras se cierra el mes nunca queda sin número en un mes cerrado', async () => {
    for (let i = 0; i < 3; i++) {
      await limpiarBase(prisma);
      const s = await preparar();
      await s.asiento('2026-01-05', 'previo');
      const id = await s.periodo(1);
      await Promise.all([s.asiento('2026-01-06', 'concurrente'), s.http.post(`/api/contabilidad/periodos/${id}/cerrar`, {})]);
      const p = await prisma.periodoContable.findUniqueOrThrow({ where: { id } });
      if (p.estado === 'CERRADO')
        expect(await prisma.asiento.count({ where: { empresaId: s.empresaId, fecha: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') }, numeroDefinitivo: null } })).toBe(0);
    }
  });

  it('permisos', async () => {
    const s = await preparar();
    const { otroUsuario } = await import('./helpers');
    const u = await otroUsuario(app, prisma, s.empresaId, ['plancuentas.ver', 'asiento.registrar']);
    expect((await u.http.post(`/api/contabilidad/periodos/${await s.periodo(1)}/cerrar`, {})).status).toBe(403);
  });
});
