import { INestApplication } from '@nestjs/common';
import { crearEjercicio } from '../src/contabilidad/periodos/ejercicios';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('contabilidad: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function base() {
    const s = await sesionConPlan(app, prisma);
    const asiento = async (fecha: string, cuentaDebe: string, cuentaHaber: string, importe: number) =>
      s.http.post('/api/contabilidad/asientos', {
        fecha, descripcion: 'Prueba',
        renglones: [{ cuentaContableId: await s.cuenta(cuentaDebe), debe: importe }, { cuentaContableId: await s.cuenta(cuentaHaber), haber: importe }],
      });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const cerrarMes = (i: number) => s.http.post(`/api/contabilidad/periodos/${ej.periodos[i].id}/cerrar`, {});
    const periodo = async (i: number) => (await prisma.periodoContable.findUniqueOrThrow({ where: { id: ej.periodos[i].id } })).estado;
    return { s, ej, asiento, cerrarMes, periodo };
  }

  async function listoParaCerrar() {
    const b = await base();
    await b.asiento('2026-03-01', '1.1.01.002', '3.1.01', 1000000);
    for (let i = 0; i < 11; i++) expect((await b.cerrarMes(i)).status).toBe(200);
    await b.s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    return b;
  }

  it('un asiento manual anulado o un contraasiento no se pueden modificar', async () => {
    const { s, asiento } = await base();
    const a = (await asiento('2026-11-02', '1.1.01.002', '3.1.01', 500)).body;
    const anulacion = await s.http.post(`/api/contabilidad/asientos/${a.id}/anular`, { fecha: '2026-11-03', motivo: 'Error' });
    expect(anulacion.status).toBe(201);
    const datos = { fecha: '2026-11-02', descripcion: 'Cambio', renglones: [{ cuentaContableId: await s.cuenta('1.1.01.002'), debe: 900 }, { cuentaContableId: await s.cuenta('3.1.01'), haber: 900 }] };
    const r = await s.http.put(`/api/contabilidad/asientos/${a.id}`, { ...datos, version: a.version });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El asiento fue anulado: no se puede modificar');
    const c = await s.http.put(`/api/contabilidad/asientos/${anulacion.body.id}`, { ...datos, version: anulacion.body.version });
    expect(c.status).toBe(400);
    expect(c.body.message).toBe('Un contraasiento no se modifica: registre un asiento nuevo');
  });

  it('no se puede cerrar un ejercicio si el anterior sigue abierto', async () => {
    const { s, ej } = await listoParaCerrar();
    await crearEjercicio(prisma, s.empresaId, new Date('2025-01-01T00:00:00Z'), 0);
    expect((await s.http.get(`/api/contabilidad/ejercicios/${ej.id}/cierre/previa`)).body.faltantes).toEqual(['Cierre primero el ejercicio 0']);
    const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Cierre primero el ejercicio 0');
  });

  it('al abrir el ejercicio siguiente se le asignan los asientos que ya tenían fecha en él', async () => {
    const { s } = await base();
    const huerfano = await prisma.asiento.create({
      data: { empresaId: s.empresaId, numero: 999, fecha: new Date('2027-02-10T00:00:00Z'), descripcion: 'Posdatado', origenTipo: 'MANUAL', origenId: 'x', creadoPor: 'migracion', tipo: 'MANUAL' },
    });
    const sig = await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    expect(sig.status).toBe(201);
    expect((await prisma.asiento.findUniqueOrThrow({ where: { id: huerfano.id } })).ejercicioId).toBe(sig.body.id);
  });

  it('cerrar un mes y reabrir el anterior a la vez nunca deja un mes cerrado después de uno abierto', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const { s, ej, asiento, cerrarMes, periodo } = await base();
      await asiento('2026-02-10', '1.1.01.002', '3.1.01', 100);
      await asiento('2026-03-10', '1.1.01.002', '3.1.01', 100);
      expect((await cerrarMes(0)).status).toBe(200);
      expect((await cerrarMes(1)).status).toBe(200);
      await Promise.all([cerrarMes(2), s.http.post(`/api/contabilidad/periodos/${ej.periodos[1].id}/reabrir`, { motivo: 'Carrera' })]);
      expect((await periodo(2)) === 'CERRADO' && (await periodo(1)) === 'ABIERTO').toBe(false);
    }
  });

  it('cerrar el ejercicio mientras se registra un asiento de diciembre no deja saldos de resultado sin refundir', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const { s, ej, asiento } = await listoParaCerrar();
      await Promise.all([asiento('2026-12-15', '5.2.01', '1.1.01.002', 7777), s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})]);
      const e = await prisma.ejercicio.findUniqueOrThrow({ where: { id: ej.id } });
      if (e.estado !== 'CERRADO') continue;
      const ren = await prisma.asientoRenglon.findMany({ where: { asiento: { ejercicioId: ej.id }, cuentaContableId: { in: (await prisma.cuentaContable.findMany({ where: { empresaId: s.empresaId, tipo: { in: ['RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO'] } } })).map((c) => c.id) } } });
      const saldo = ren.reduce((t, r) => t + Number(r.debe) - Number(r.haber), 0);
      expect(saldo).toBe(0);
      const deCaja = await prisma.asientoRenglon.findMany({ where: { asiento: { ejercicioId: ej.id }, cuentaContableId: await s.cuenta('1.1.01.002') } });
      expect(deCaja.reduce((t, r) => t + Number(r.debe) - Number(r.haber), 0)).toBe(0);
    }
  });

  it('reabrir el ejercicio mientras se cierra el primer mes del siguiente nunca deja un mes cerrado sin su apertura', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const { s, ej } = await listoParaCerrar();
      expect((await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).status).toBe(200);
      const sig = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 2 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
      await Promise.all([
        s.http.post(`/api/contabilidad/ejercicios/${ej.id}/reabrir`, { motivo: 'Carrera' }),
        s.http.post(`/api/contabilidad/periodos/${sig.periodos[0].id}/cerrar`, {}),
      ]);
      const enero = await prisma.periodoContable.findUniqueOrThrow({ where: { id: sig.periodos[0].id } });
      const e = await prisma.ejercicio.findUniqueOrThrow({ where: { id: ej.id } });
      expect(enero.estado === 'CERRADO' && e.estado === 'ABIERTO').toBe(false);
    }
  });
});
