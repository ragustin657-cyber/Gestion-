import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('estados contables', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function escenario() {
    const s = await sesionConPlan(app, prisma);
    const asiento = async (fecha: string, renglones: [string, number, number][]) => {
      const r = await s.http.post('/api/contabilidad/asientos', {
        fecha, descripcion: 'x', renglones: await Promise.all(renglones.map(async ([c, debe, haber]) => ({ cuentaContableId: await s.cuenta(c), debe: debe || undefined, haber: haber || undefined }))),
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    };
    await asiento('2026-03-01', [['1.1.01.002', 1000000, 0], ['3.1.01', 0, 1000000]]);
    await asiento('2026-06-10', [['1.1.02.001', 300000, 0], ['4.1.01', 0, 300000]]);
    await asiento('2026-09-15', [['5.2.01', 100000, 0], ['1.1.01.002', 0, 100000]]);
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const cerrarEjercicio = async () => {
      for (const p of ej.periodos.slice(0, 11)) await s.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {});
      await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
      const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    };
    return { s, cerrarEjercicio };
  }
  const fila = (bloque: { filas: { codigo: string; importe: string }[] }, codigo: string) => bloque.filas.find((f) => f.codigo === codigo)?.importe;

  it('situación patrimonial y resultados antes del cierre, con el resultado en curso', async () => {
    const { s } = await escenario();
    const sit = (await s.http.get('/api/contabilidad/estados/situacion?fecha=2026-12-31&nivel=4')).body;
    expect(sit.activo.total).toBe('1200000');
    expect(sit.pasivo.total).toBe('0');
    expect(sit.resultadoEnCurso).toBe('200000');
    expect(sit.patrimonioNeto.total).toBe('1200000');
    expect(sit.control).toBe('0');
    expect(fila(sit.activo, '1.1.01.002')).toBe('900000');
    expect(fila(sit.patrimonioNeto, '3.1.01')).toBe('1000000');
    const res = (await s.http.get('/api/contabilidad/estados/resultados?desde=2026-01-01&hasta=2026-12-31')).body;
    expect(res).toMatchObject({ resultado: '200000' });
    expect(res.positivos.total).toBe('300000');
    expect(res.negativos.total).toBe('100000');
    expect(res.comparativo).toBeNull();
  });

  it('después del cierre: mismos números, 3.2.02 refundido y comparativo en el ejercicio nuevo', async () => {
    const { s, cerrarEjercicio } = await escenario();
    await cerrarEjercicio();
    const sit = (await s.http.get('/api/contabilidad/estados/situacion?fecha=2026-12-31&nivel=4')).body;
    expect(sit.activo.total).toBe('1200000');
    expect(sit.resultadoEnCurso).toBeNull();
    expect(fila(sit.patrimonioNeto, '3.2.02')).toBe('200000');
    expect(sit.control).toBe('0');
    expect((await s.http.get('/api/contabilidad/estados/resultados?desde=2026-01-01&hasta=2026-12-31')).body.resultado).toBe('200000');
    const nuevo = (await s.http.get('/api/contabilidad/estados/situacion?fecha=2027-01-31')).body;
    expect(nuevo.activo.total).toBe('1200000');
    expect(nuevo.comparativo).toMatchObject({ activo: '1200000', patrimonioNeto: '1200000' });
    expect(nuevo.comparativo.fecha.slice(0, 10)).toBe('2026-12-31');
    const n2 = (await s.http.get('/api/contabilidad/estados/situacion?fecha=2026-12-31&nivel=2')).body;
    expect([...n2.activo.filas, ...n2.patrimonioNeto.filas].every((f: { nivel: number }) => f.nivel <= 2)).toBe(true);
    expect((await s.http.get('/api/contabilidad/estados/situacion?fecha=2026-12-31&formato=pdf')).headers['content-type']).toContain('application/pdf');
  });
});
