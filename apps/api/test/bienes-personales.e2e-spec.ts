import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

type Liq = {
  estado: string; ajuste: { importe: string; concepto: string | null };
  liquidacion: { base: string; total: string; completo: boolean; avisos: string[]; filas: { nombre: string; porcentaje: string; vpp: string; impuesto: string }[] };
  presentaciones: { numero: number; anuladaEn: string | null }[];
};

describe('Bienes Personales acciones y participaciones (E47)', () => {
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
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const aporte = await s.http.post('/api/contabilidad/asientos', { fecha: '2026-03-10', descripcion: 'Aporte', renglones: [{ cuentaContableId: await s.cuenta('1.1.01.001'), debe: 10000000 }, { cuentaContableId: await s.cuenta('3.1.01'), haber: 10000000 }] });
    if (aporte.status !== 201) throw new Error(JSON.stringify(aporte.body));
    const socio = async (nombre: string, tipoTitular: string, porcentaje: number, activo = true) => {
      const r = await s.http.post('/api/impuestos/socios', { nombre, tipoDocumento: 'CUIT', documento: '20-12345678-6', tipoTitular, porcentaje, activo });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const liq = async (anio = 2026) => { const r = await s.http.get(`/api/impuestos/bienes-personales?anio=${anio}`); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body as Liq; };
    const cerrar = async () => {
      for (const p of ej.periodos.slice(0, 11)) expect((await s.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {})).status).toBe(200);
      await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
      expect((await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).status).toBe(200);
    };
    return { ...s, ej, socio, liq, cerrar };
  };
  const tres = async (x: Awaited<ReturnType<typeof escenario>>) => ({
    a: await x.socio('Ana', 'PERSONA_HUMANA_PAIS', 60), b: await x.socio('Inversora SA', 'SOCIEDAD_PAIS', 30), c: await x.socio('John', 'PERSONA_HUMANA_EXTERIOR', 10),
  });

  it('liquidación con el patrimonio del balance y ajuste manual', async () => {
    const x = await escenario();
    await tres(x);
    let r = await x.liq();
    expect([r.liquidacion.base, r.liquidacion.filas.map((f) => f.impuesto), r.liquidacion.total]).toEqual(['10000000.00', ['30000.00', '0.00', '5000.00'], '35000.00']);
    expect((await x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2026, importe: -1000000, concepto: 'Ajuste por valuación' })).status).toBe(200);
    r = await x.liq();
    expect([r.liquidacion.total, r.ajuste.concepto]).toEqual(['31500.00', 'Ajuste por valuación']);
  });

  it('las participaciones del año no cambian con el registro hasta volver a copiar; inactivos no se copian', async () => {
    const x = await escenario();
    const { a } = await tres(x);
    await x.socio('Ex socio', 'PERSONA_HUMANA_PAIS', 5, false);
    await x.liq();
    expect((await x.http.put(`/api/impuestos/socios/${a.id}`, { nombre: 'Ana', tipoDocumento: 'CUIT', documento: '20-12345678-6', tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje: 50, activo: true })).status).toBe(200);
    expect((await x.liq()).liquidacion.filas.map((f) => f.porcentaje)).toEqual(['60.0000', '30.0000', '10.0000']);
    expect((await x.http.post('/api/impuestos/bienes-personales/copiar-socios', { anio: 2026 })).status).toBe(200);
    const r = await x.liq();
    expect(r.liquidacion.filas.map((f) => f.nombre)).not.toContain('Ex socio');
    expect([r.liquidacion.completo, r.liquidacion.avisos]).toEqual([false, ['Las participaciones suman 90 %: deben sumar 100 %']]);
  });

  it('alícuota configurable', async () => {
    const x = await escenario();
    await tres(x);
    await prisma.configImpuestos.upsert({ where: { empresaId: x.empresaId }, create: { empresaId: x.empresaId, alicuotaBienesPersonalesAcciones: 1 }, update: { alicuotaBienesPersonalesAcciones: 1 } });
    expect((await x.liq()).liquidacion.total).toBe('70000.00');
  });

  it('presentar: ejercicio cerrado y participaciones completas; foto; bloqueos; anulación y rectificativa', async () => {
    const x = await escenario();
    const { a } = await tres(x);
    await x.liq();
    const abierto = await x.http.post('/api/impuestos/bienes-personales/presentar', { anio: 2026 });
    expect([abierto.status, abierto.body.message]).toEqual([400, 'Cierre el ejercicio antes de presentar la liquidación']);
    const sin = await x.http.post('/api/impuestos/bienes-personales/anular', { anio: 2026, motivo: 'x' });
    expect([sin.status, sin.body.message]).toEqual([400, 'La liquidación no está presentada']);
    await x.cerrar();
    expect((await x.http.put('/api/impuestos/bienes-personales/participaciones', { anio: 2026, participaciones: [{ socioId: a.id, tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje: 90 }] })).status).toBe(200);
    const incompleto = await x.http.post('/api/impuestos/bienes-personales/presentar', { anio: 2026 });
    expect([incompleto.status, incompleto.body.message]).toEqual([400, 'Las participaciones suman 90 %: deben sumar 100 %']);
    await x.http.put('/api/impuestos/bienes-personales/participaciones', { anio: 2026, participaciones: [{ socioId: a.id, tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje: 100 }] });
    expect((await x.http.post('/api/impuestos/bienes-personales/presentar', { anio: 2026 })).status).toBe(200);
    await prisma.configImpuestos.upsert({ where: { empresaId: x.empresaId }, create: { empresaId: x.empresaId, alicuotaBienesPersonalesAcciones: 2 }, update: { alicuotaBienesPersonalesAcciones: 2 } });
    let r = await x.liq();
    expect([r.estado, r.liquidacion.total, r.presentaciones.map((p) => p.numero)]).toEqual(['PRESENTADA', '50000.00', [0]]);
    const bloqueado = 'La liquidación de Bienes Personales del año está presentada';
    for (const q of [
      () => x.http.put('/api/impuestos/bienes-personales/ajuste', { anio: 2026, importe: 1, concepto: 'x' }),
      () => x.http.put('/api/impuestos/bienes-personales/participaciones', { anio: 2026, participaciones: [] }),
      () => x.http.post('/api/impuestos/bienes-personales/copiar-socios', { anio: 2026 }),
    ]) { const res = await q(); expect([res.status, res.body.message]).toEqual([400, bloqueado]); }
    expect((await x.http.post('/api/impuestos/bienes-personales/anular', { anio: 2026, motivo: 'Rectificativa' })).status).toBe(200);
    r = await x.liq();
    expect([r.estado, r.liquidacion.total]).toEqual(['BORRADOR', '200000.00']);
    expect((await x.http.post('/api/impuestos/bienes-personales/presentar', { anio: 2026 })).status).toBe(200);
    expect((await x.liq()).presentaciones.map((p) => p.numero)).toEqual([0, 1]);
  });

  it('año sin ejercicio, validación, Excel y permiso', async () => {
    const x = await escenario();
    const r = await x.http.get('/api/impuestos/bienes-personales?anio=2030');
    expect([r.status, r.body.message]).toEqual([400, 'No hay un ejercicio que cierre en 2030']);
    const sin = await x.http.get('/api/impuestos/bienes-personales');
    expect([sin.status, sin.body.message]).toEqual([400, 'Indique el año']);
    expect((await x.http.post('/api/impuestos/socios', { nombre: 'X', tipoDocumento: 'CUIT', documento: '1', tipoTitular: 'OTRO', porcentaje: 10 })).status).toBe(400);
    const xl = await x.http.get('/api/impuestos/bienes-personales?anio=2026&formato=xlsx');
    expect(xl.headers['content-type']).toContain('spreadsheetml');
    const otro = await otroUsuario(app, prisma, x.empresaId, ['bienes.ver']);
    expect((await otro.http.get('/api/impuestos/bienes-personales?anio=2026')).status).toBe(403);
    expect((await otro.http.get('/api/impuestos/socios')).status).toBe(403);
  });
});
