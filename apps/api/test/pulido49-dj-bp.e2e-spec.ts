import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

const LEY = [{ desde: 0, fijo: 0, alicuota: 25 }, { desde: 5000000, fijo: 1250000, alicuota: 30 }, { desde: 50000000, fijo: 14750000, alicuota: 35 }];

describe('pulido E49: DJ de Ganancias y Bienes Personales', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await sesionConPlan(app, prisma);
    for (const [anio, mes, valor] of [[2023, 12, 50], [2025, 12, 100], [2026, 3, 120], [2026, 12, 150]]) await prisma.indiceInflacion.create({ data: { anio, mes, valor, actualizadoPor: 't' } });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const aporte = await s.http.post('/api/contabilidad/asientos', { fecha: '2026-03-10', descripcion: 'Aporte', renglones: [{ cuentaContableId: await s.cuenta('1.1.01.001'), debe: 10000000 }, { cuentaContableId: await s.cuenta('3.1.01'), haber: 10000000 }] });
    if (aporte.status !== 201) throw new Error(JSON.stringify(aporte.body));
    const cerrar = async () => {
      for (const p of ej.periodos.slice(0, 11)) expect((await s.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {})).status).toBe(200);
      await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
      expect((await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).status).toBe(200);
    };
    const socio = async (nombre: string, porcentaje: number) => {
      const r = await s.http.post('/api/impuestos/socios', { nombre, tipoDocumento: 'CUIT', documento: '20-12345678-6', tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje, activo: true });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    return { ...s, ej, cerrar, socio };
  };

  it('consultas simultáneas de la DJ de un ejercicio nuevo: todas 200', async () => {
    const x = await escenario();
    await x.http.put('/api/impuestos/escala-sociedades/2026', { tramos: LEY });
    const consulta = () => x.http.get(`/api/impuestos/dj-ganancias?ejercicioId=${x.ej.id}`);
    const rs = await Promise.all(Array.from({ length: 12 }, () => consulta()));
    expect(rs.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(await prisma.djGananciasSociedades.count({ where: { ejercicioId: x.ej.id } })).toBe(1);
  });

  it('reabrir el ejercicio con la DJ presentada: error; en borrador o sin DJ, como antes', async () => {
    const x = await escenario();
    await x.cerrar();
    await prisma.djGananciasSociedades.create({ data: { empresaId: x.empresaId, ejercicioId: x.ej.id, estado: 'PRESENTADA' } });
    const r = await x.http.post(`/api/contabilidad/ejercicios/${x.ej.id}/reabrir`, { motivo: 'x' });
    expect([r.status, r.body.message]).toEqual([400, 'La DJ de Ganancias del ejercicio está presentada: anule la presentación antes de reabrir']);
    await prisma.djGananciasSociedades.updateMany({ where: { ejercicioId: x.ej.id }, data: { estado: 'BORRADOR' } });
    expect((await x.http.post(`/api/contabilidad/ejercicios/${x.ej.id}/reabrir`, { motivo: 'x' })).status).toBe(200);
  });

  it('Bienes Personales: año fuera de rango, ejercicio inexistente sin crear filas, socio repetido, ajuste enorme', async () => {
    const x = await escenario();
    const a = await x.socio('Ana', 100);
    const grande = await x.http.get('/api/impuestos/bienes-personales?anio=100000000000000000000');
    expect([grande.status, grande.body.message]).toEqual([400, 'Año inválido']);
    expect((await x.http.get('/api/impuestos/bienes-personales?anio=1999')).status).toBe(400);
    const sinEj = await x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2099, importe: 10, concepto: 'x' });
    expect([sinEj.status, sinEj.body.message]).toEqual([400, 'No hay un ejercicio que cierre en 2099']);
    const sinEjP = await x.http.put('/api/impuestos/bienes-personales/participaciones', { anio: 2099, participaciones: [] });
    expect(sinEjP.status).toBe(400);
    const sinEjC = await x.http.post('/api/impuestos/bienes-personales/copiar-socios', { anio: 2099 });
    expect(sinEjC.status).toBe(400);
    expect(await prisma.bienesPersonalesAcciones.count({ where: { empresaId: x.empresaId, anio: 2099 } })).toBe(0);
    expect(await prisma.bienesPersonalesParticipacion.count({ where: { empresaId: x.empresaId, anio: 2099 } })).toBe(0);
    const rep = await x.http.put('/api/impuestos/bienes-personales/participaciones', { anio: 2026, participaciones: [
      { socioId: a.id, tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje: 50 }, { socioId: a.id, tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje: 50 }] });
    expect([rep.status, rep.body.message]).toEqual([400, 'El socio está repetido']);
    expect((await x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2026, importe: 1e20, concepto: 'x' })).status).toBe(400);
    expect((await x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2026, importe: 10.001, concepto: 'x' })).status).toBe(400);
    expect((await x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2026, importe: -1000.5, concepto: 'x' })).status).toBe(200);
    // Revisión: importes grandes con centavos (602934655.08 * 100 no es entero en coma flotante)
    for (const importe of [602934655.08, -9876543210.07, 123456789012.29]) expect([importe, (await x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2026, importe, concepto: 'x' })).status]).toEqual([importe, 200]);
    expect((await x.http.get('/api/impuestos/bienes-personales?anio=2026')).status).toBe(200);
  });
});
