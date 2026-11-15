import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPresupuestos } from './helpers-presupuestos';
import { escenarioInformes } from './helpers-informes';

const dias = (n: number) => { const d = new Date(Date.UTC(2026, 10, 6)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe('pulido 17: presupuestos, flujo e informes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('un solo vigente garantizado por la base', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('A');
    const b = await p.crear('B');
    await p.http.post(`/api/presupuestos/${a.id}/vigente`);
    await expect(prisma.presupuesto.update({ where: { id: b.id }, data: { vigente: true } })).rejects.toThrow();
    expect((await p.http.post(`/api/presupuestos/${b.id}/vigente`)).status).toBe(201);
    expect((await prisma.presupuesto.findMany({ where: { empresaId: p.empresaId, vigente: true } })).map((x) => x.nombre)).toEqual(['B']);
  });

  it('tarjeta sin meses futuros y con período', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Plan');
    await p.linea(a.id, '4.1.01', { '2026-11': 100000, '2026-12': 100000 });
    await p.http.post(`/api/presupuestos/${a.id}/vigente`);
    const t = (await p.http.get('/api/informes/tablero?desde=2026-11-01&hasta=2026-12-31')).body.indicadores.presupuesto;
    expect(t).toMatchObject({ resultadoPresupuestado: '100000.00', desde: '2026-11', hasta: '2026-11' });
  });

  it('actualizadoEn en cargas masivas', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Plan');
    const fecha = async () => (await prisma.presupuesto.findUniqueOrThrow({ where: { id: a.id } })).actualizadoEn.getTime();
    const viejo = new Date('2026-01-01T00:00:00Z');
    const marcar = () => prisma.$executeRaw`UPDATE "Presupuesto" SET "actualizadoEn" = ${viejo} WHERE "id" = ${a.id}::uuid`;
    const cuenta = await p.cuenta('4.1.01');
    await marcar();
    await p.http.post(`/api/presupuestos/${a.id}/lineas/repartir`, { cuentaContableId: cuenta, total: 1200 });
    expect(await fecha()).toBeGreaterThan(viejo.getTime());
    await marcar();
    await p.http.delete(`/api/presupuestos/${a.id}/lineas?cuentaContableId=${cuenta}`);
    expect(await fecha()).toBeGreaterThan(viejo.getTime());
    await marcar();
    await p.http.post(`/api/presupuestos/${a.id}/importar`).attach('archivo', Buffer.from('Cuenta;Centro de costo;01/2026\n4.1.01;;10'), 'p.csv');
    expect(await fecha()).toBeGreaterThan(viejo.getTime());
  });

  it('centro inválido al eliminar línea', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Plan');
    expect((await p.http.delete(`/api/presupuestos/${a.id}/lineas?cuentaContableId=${await p.cuenta('4.1.01')}&centroCostoId=abc`)).status).toBe(400);
  });

  it('CSV con coma y formato argentino', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Plan');
    const r = await p.http.post(`/api/presupuestos/${a.id}/importar`).attach('archivo', Buffer.from('Cuenta,Centro de costo,01/2026,02/2026\n4.1.01,,"1.234,50",10.5'), 'p.csv');
    expect(r.status).toBe(201);
    expect(r.body.lineas[0].importes).toMatchObject({ '2026-01': '1234.50', '2026-02': '10.50' });
  });

  it('rango por defecto en hora argentina', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Plan');
    jest.setSystemTime(new Date('2026-12-01T02:30:00Z')); // 30/11 23:30 en Argentina
    try {
      const http = await p.reingresar();
      expect((await http.get(`/api/presupuestos/${a.id}/comparacion`)).body.hasta).toBe('2026-11');
    } finally {
      jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    }
  });

  it('52 semanas completas', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const ok = await p.http.get(`/api/tesoreria/flujo?agrupar=semana&hasta=${dias(52 * 7)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.filas).toHaveLength(53);
    const no = await p.http.get(`/api/tesoreria/flujo?agrupar=semana&hasta=${dias(53 * 7 + 3)}`);
    expect([no.status, no.body.message]).toEqual([400, 'El flujo semanal admite hasta 52 semanas']);
  });

  it('título del Excel con tilde', async () => {
    const e = await escenarioInformes(app, prisma);
    const r = await e.http.get('/api/informes/ventas?desde=2026-11-01&hasta=2026-11-30&agrupar=articulo&formato=xlsx').buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as unknown as ArrayBuffer);
    expect(String(wb.worksheets[0].getCell('A1').value)).toBe('Ventas por artículo');
  });
});
