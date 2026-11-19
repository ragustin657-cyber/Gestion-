import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { crearEjercicio } from '../src/contabilidad/periodos/ejercicios';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { TABLA_PRUEBA } from './helpers-ganancias';
import { prepararSueldos } from './helpers-sueldos';

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
interface Fila { empleadoId: string; impuesto: string; retenido: string; pagosACuenta: string; saldo: string }

describe('ganancias: liquidación anual', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  /** Empresa agente con tablas 2025 y un empleado con mensuales de noviembre y diciembre de 2025 cerradas. */
  const escenario = async (extra = 0) => {
    const s = await prepararSueldos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionGanancias: true } });
    // Ejercicio contable 2025 abierto (los asientos de sueldos de 2025 lo necesitan)
    await prisma.$transaction((tx) => crearEjercicio(tx, s.empresaId, new Date('2025-01-01T00:00:00Z'), 0));
    await s.escala('Vendedor B', '2025-11', 30000000);
    for (const sem of [1, 2]) for (const anio of [2025, 2026]) expect((await s.http.put(`/api/sueldos/ganancias/tablas/${anio}/${sem}`, TABLA_PRUEBA)).status).toBe(200);
    const e = await s.empleado();
    const otros = [];
    for (let i = 0; i < extra; i++) otros.push(await s.empleado());
    const crear = async (tipo: string, anio: number, mes: number) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-28` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const cerrar = async (id: string) => { const r = await s.http.post(`/api/sueldos/liquidaciones/${id}/cerrar`); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); };
    for (const mes of [11, 12]) await cerrar((await crear('MENSUAL', 2025, mes)).id);
    const calcular = () => s.http.post('/api/sueldos/ganancias/anual/2025/calcular');
    return { ...s, e, otros, crear, cerrar, calcular };
  };

  it('año no terminado', async () => {
    const s = await prepararSueldos(app, prisma);
    const r = await s.http.post('/api/sueldos/ganancias/anual/2026/calcular');
    expect([r.status, r.body.message]).toEqual([400, 'Solo se liquida un año terminado']);
  });

  it('calcula la anual del año anterior', async () => {
    const x = await escenario();
    const r = await x.calcular();
    expect(r.status).toBe(201);
    const filas = r.body.empleados as Fila[];
    expect(filas.map((f) => f.empleadoId)).toEqual([x.e.id]);
    const ret = await prisma.reciboSueldoRenglon.findMany({ where: { codigo: '560', recibo: { empleadoId: x.e.id } } });
    const retenido = ret.reduce((t, y) => t.plus(y.importe), D(0));
    expect(retenido.gt(0)).toBe(true);
    const [f] = filas;
    expect(f.retenido).toBe(retenido.toFixed(2));
    expect(f.saldo).toBe(D(f.impuesto).minus(f.retenido).minus(f.pagosACuenta).toFixed(2));
    expect(r.body.estado).toBe('BORRADOR');
  });

  it('quedan afuera los egresados del año y los de enero a marzo siguientes', async () => {
    const x = await escenario();
    const otro = await x.empleado();
    const tercero = await x.empleado();
    await x.cerrar((await x.crear('MENSUAL', 2025, 10)).id).catch(() => undefined);
    const f1 = (await x.http.post('/api/sueldos/egresos', { empleadoId: otro.id, causa: 'RENUNCIA', fechaEgreso: '2025-12-30', preavisoOtorgado: true, fechaPago: '2025-12-30' })).body as { id: string };
    await x.cerrar(f1.id);
    await x.http.post('/api/sueldos/egresos', { empleadoId: tercero.id, causa: 'RENUNCIA', fechaEgreso: '2026-02-15', preavisoOtorgado: true, fechaPago: '2026-02-20' });
    const filas = (await x.calcular()).body.empleados as Fila[];
    expect(filas.map((f) => f.empleadoId)).toEqual([x.e.id]);
  });

  it('egreso de marzo con la final en abril entra en la anual', async () => {
    const x = await escenario(2);
    const [conDistracto, abril] = x.otros;
    jest.setSystemTime(new Date('2026-02-20T15:00:00Z'));
    const f1 = (await x.http.post('/api/sueldos/egresos', { empleadoId: conDistracto.id, causa: 'RENUNCIA', fechaEgreso: '2026-02-15', preavisoOtorgado: true, fechaPago: '2026-02-20' })).body as { id: string };
    await x.cerrar(f1.id);
    jest.setSystemTime(new Date('2026-04-05T15:00:00Z'));
    expect((await x.http.post('/api/sueldos/egresos', { empleadoId: abril.id, causa: 'RENUNCIA', fechaEgreso: '2026-03-20', preavisoOtorgado: true, fechaPago: '2026-04-05' })).status).toBe(201);
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    const filas = (await x.calcular()).body.empleados as (Fila & { distracto: boolean })[];
    expect(filas.filter((f) => !f.distracto).map((f) => f.empleadoId).sort()).toEqual([x.e.id, abril.id].sort());
    expect(filas.filter((f) => f.distracto).map((f) => f.empleadoId)).toEqual([conDistracto.id]);
  });

  it('cerrar desde el 1/4', async () => {
    const x = await escenario();
    await x.calcular();
    jest.setSystemTime(new Date('2026-02-10T15:00:00Z'));
    const antes = await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar');
    expect([antes.status, antes.body.message]).toEqual([400, 'La liquidación anual se cierra desde el 1/4/2026, cuando ya se conocen los egresos de enero a marzo (que van en el distracto)']);
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    const r = await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar');
    expect([r.status, r.body.estado]).toEqual([201, 'CERRADA']);
    expect((await x.calcular()).status).toBe(400);
  });

  it('cerrar recalcula la anual con los datos al día', async () => {
    const x = await escenario();
    const calculada = ((await x.calcular()).body.empleados as Fila[])[0];
    // Datos que cambian después de la vista previa: el cierre no congela lo viejo
    await prisma.liquidacionAnualGananciasEmpleado.updateMany({ where: { empleadoId: x.e.id }, data: { saldo: 12345 } });
    const r = await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar');
    expect((r.body.empleados as Fila[])[0].saldo).toBe(calculada.saldo);
  });

  it('reabrir', async () => {
    const x = await escenario();
    await x.calcular();
    await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar');
    const r = await x.http.post('/api/sueldos/ganancias/anual/2025/reabrir');
    expect([r.status, r.body.estado]).toEqual([201, 'BORRADOR']);
  });

  it('rubro exento obligatorio', async () => {
    const s = await prepararSueldos(app, prisma);
    const base = { codigo: '900', nombre: 'Viático', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: { importe: 100 }, orden: 900, exentoGanancias: true };
    const sin = await s.http.post('/api/sueldos/conceptos', base);
    expect([sin.status, sin.body.message]).toEqual([400, 'Elija el rubro exento de Ganancias']);
    const con = await s.http.post('/api/sueldos/conceptos', { ...base, rubroExentoGanancias: 'CURSOS_SEMINARIOS' });
    expect([con.status, con.body.rubroExentoGanancias]).toEqual([201, 'CURSOS_SEMINARIOS']);
  });

  it('concepto 561 en la precarga', async () => {
    const s = await prepararSueldos(app, prisma);
    const c = await prisma.concepto.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo: '561' } });
    const cuenta = await prisma.cuentaContable.findUniqueOrThrow({ where: { id: c.cuentaContableId! } });
    expect([c.tipo, c.clase, c.codigoArca, cuenta.codigo]).toEqual(['GANANCIAS_AJUSTE', 'DESCUENTO', '810008', '2.1.02.002']);
  });
});
