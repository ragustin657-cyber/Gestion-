import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPresupuestos } from './helpers-presupuestos';

type Linea = { codigo: string; centroCosto: string | null; importes: Record<string, string> };
const bin = (r: { buffer: (b: boolean) => { parse: (f: (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => void) => Promise<{ body: Buffer; headers: Record<string, string> }> } }) =>
  r.buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });

describe('presupuestos: carga asistida', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const grilla = async (p: Awaited<ReturnType<typeof prepararPresupuestos>>, id: string) => (await p.http.get(`/api/presupuestos/${id}/grilla`)).body as { lineas: Linea[] };

  it('repartir un total anual', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    const r = await p.http.post(`/api/presupuestos/${a.id}/lineas/repartir`, { cuentaContableId: await p.cuenta('4.1.01'), total: 120000 });
    expect(r.status).toBe(201);
    expect(Object.values((await grilla(p, a.id)).lineas[0].importes)).toEqual(Array(12).fill('10000.00'));
  });

  it('traer el real del ejercicio anterior', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    expect((await p.http.post(`/api/presupuestos/${a.id}/desde-real`, { ajustePct: 30 })).body.message).toBe('No hay un ejercicio anterior');
    const ant = await prisma.ejercicio.create({ data: { empresaId: p.empresaId, numero: 0, desde: new Date('2025-01-01T00:00:00Z'), hasta: new Date('2025-12-31T00:00:00Z'), estado: 'CERRADO' } });
    const ren = async (codigo: string, debe: number, haber: number) => ({ empresaId: p.empresaId, cuentaContableId: await p.cuenta(codigo), debe, haber });
    await prisma.asiento.create({ data: { empresaId: p.empresaId, numero: 9001, fecha: new Date('2025-03-15T00:00:00Z'), descripcion: 'x', origenTipo: 'MANUAL', origenId: ant.id, creadoPor: 't', tipo: 'MANUAL', ejercicioId: ant.id,
      renglones: { create: [await ren('1.1.01.002', 60000, 0), await ren('4.1.01', 0, 50000), await ren('5.2.01', 10000, 0), await ren('5.2.04', 0, 500), await ren('1.1.01.001', 0, 19500)] } } });
    expect((await p.http.post(`/api/presupuestos/${a.id}/desde-real`, { ajustePct: 30 })).status).toBe(201);
    const g = await grilla(p, a.id);
    expect(g.lineas.map((l) => [l.codigo, l.importes['2026-03']])).toEqual([['4.1.01', '65000.00'], ['5.2.01', '13000.00']]);
  });

  it('exporta e importa', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    await p.linea(a.id, '4.1.01', { '2026-11': 1000000, '2026-12': 500.5 });
    await p.linea(a.id, '5.2.01', { '2026-11': 100000 }, 'ROS');
    const x = await bin(p.http.get(`/api/presupuestos/${a.id}/exportar`) as never);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const b = await p.crear('Importado');
    const r = await p.http.post(`/api/presupuestos/${b.id}/importar`).attach('archivo', x.body, 'presupuesto.xlsx');
    expect(r.status).toBe(201);
    expect((await grilla(p, b.id)).lineas).toEqual((await grilla(p, a.id)).lineas);
  });

  it('importar con errores no graba nada', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    const meses = Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}/2026`).join(';');
    const fila = (cuenta: string, centro = '', marzo = '1.000,50') => `${cuenta};${centro};0;0;${marzo};0;0;0;0;0;0;0;0;0`;
    const csv = [`Cuenta;Centro de costo;${meses}`, fila('4.1.01'), fila('9.9.99'), fila('1.1.01.001'), fila('5.2.01', 'XX'), fila('4.1.01'), fila('5.2.02', '', 'abc')].join('\n');
    const r = await p.http.post(`/api/presupuestos/${a.id}/importar`).attach('archivo', Buffer.from(csv), 'p.csv');
    expect(r.status).toBe(400);
    expect(r.body.errores).toEqual([
      { linea: 3, mensaje: 'Cuenta inexistente: 9.9.99' }, { linea: 4, mensaje: 'La cuenta 1.1.01.001 no es de resultados' },
      { linea: 5, mensaje: 'Centro de costo inexistente: XX' }, { linea: 6, mensaje: 'Línea repetida' }, { linea: 7, mensaje: 'Importe inválido en 03/2026' },
    ]);
    expect((await grilla(p, a.id)).lineas).toEqual([]);
    const ok = await p.http.post(`/api/presupuestos/${a.id}/importar`).attach('archivo', Buffer.from([`Cuenta;Centro de costo;${meses}`, fila('4.1.01'), fila('5.2.01', 'ROS')].join('\n')), 'p.csv');
    expect(ok.status).toBe(201);
    expect((await grilla(p, a.id)).lineas.map((l) => [l.codigo, l.centroCosto, l.importes['2026-03']])).toEqual([['4.1.01', null, '1000.50'], ['5.2.01', 'Rosario', '1000.50']]);
  });
});
