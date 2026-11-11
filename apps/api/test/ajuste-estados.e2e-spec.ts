import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { escenarioAjuste } from './helpers-ajuste';

describe('estados contables: comparativo reexpresado', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function dosEjercicios() {
    const e = await escenarioAjuste(app, prisma);
    await e.asiento('2026-03-01', [['1.1.01.002', 1000, 0], ['3.1.01', 0, 1000]]);
    await e.asiento('2026-04-10', [['1.1.01.002', 300, 0], ['4.1.01', 0, 300]]);
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { id: e.ej.id }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    for (let i = 0; i < 11; i++) expect((await e.s.http.post(`/api/contabilidad/periodos/${ej.periodos[i].id}/cerrar`, {})).status).toBe(200);
    expect((await e.s.http.post('/api/contabilidad/ejercicios/siguiente', {})).status).toBe(201);
    expect((await e.s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).status).toBe(200);
    await e.indices({ '2026-06': 90, '2026-12': 100, '2027-06': 150 });
    return e;
  }

  it('reexpresa el comparativo del estado de situación', async () => {
    const e = await dosEjercicios();
    const r = await e.s.http.get('/api/contabilidad/estados/situacion?fecha=2027-06-30&nivel=4&comparativoReexpresado=true');
    expect(r.status).toBe(200);
    expect(r.body.comparativo).toMatchObject({ activo: '1950.00', coeficiente: '1.500000' });
    const filaBanco = (r.body.activo.filas as { codigo: string; importeAnterior: string }[]).find((f) => f.codigo === '1.1.01.002')!;
    expect(filaBanco.importeAnterior).toBe('1950.00');
    const sin = await e.s.http.get('/api/contabilidad/estados/situacion?fecha=2027-06-30');
    expect(sin.body.comparativo.activo).toBe('1300');
    expect(sin.body.comparativo.coeficiente).toBeUndefined();
  });

  it('reexpresa el comparativo del estado de resultados', async () => {
    const e = await dosEjercicios();
    const r = await e.s.http.get('/api/contabilidad/estados/resultados?desde=2027-01-01&hasta=2027-06-30&comparativoReexpresado=true');
    expect(r.status).toBe(200);
    expect(r.body.comparativo).toMatchObject({ resultado: '500.00', coeficiente: '1.666667' });
    expect(r.body.comparativo.positivos.total).toBe('500.00');
    await prisma.indiceInflacion.deleteMany({ where: { anio: 2026, mes: 6 } });
    const f = await e.s.http.get('/api/contabilidad/estados/resultados?desde=2027-01-01&hasta=2027-06-30&comparativoReexpresado=true');
    expect(f.status).toBe(400);
    expect(f.body.message).toBe('Faltan los índices de: 06/2026');
  });
});
