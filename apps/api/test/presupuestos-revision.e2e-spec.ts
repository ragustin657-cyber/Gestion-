import ExcelJS from 'exceljs';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPresupuestos } from './helpers-presupuestos';

type Linea = { codigo: string; importes: Record<string, string> };

describe('presupuestos: correcciones de la revisión', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const grilla = async (p: Awaited<ReturnType<typeof prepararPresupuestos>>, id: string) => (await p.http.get(`/api/presupuestos/${id}/grilla`)).body as { lineas: Linea[] };

  it('guardado parcial de un mes: dos guardados simultáneos de la misma línea no se pisan', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    const cuenta = await p.cuenta('4.1.01');
    const r = await Promise.all([
      p.http.put(`/api/presupuestos/${a.id}/lineas`, { cuentaContableId: cuenta, importes: { '2026-01': 100 }, parcial: true }),
      p.http.put(`/api/presupuestos/${a.id}/lineas`, { cuentaContableId: cuenta, importes: { '2026-02': 200 }, parcial: true }),
    ]);
    expect(r.map((x) => x.status)).toEqual([200, 200]);
    const l = (await grilla(p, a.id)).lineas[0];
    expect([l.importes['2026-01'], l.importes['2026-02']]).toEqual(['100.00', '200.00']);
    await p.http.put(`/api/presupuestos/${a.id}/lineas`, { cuentaContableId: cuenta, importes: { '2026-01': 0 }, parcial: true });
    expect((await grilla(p, a.id)).lineas[0].importes['2026-01']).toBe('0.00');
  });

  it('Excel con encabezados de fecha y sin columnas de meses', async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    await p.linea(a.id, '5.2.01', { '2026-05': 777 });
    const libro = async (encabezados: (string | Date)[]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('P');
      ws.addRow(['Cuenta', 'Centro de costo', ...encabezados]);
      ws.addRow(['4.1.01', '', ...encabezados.map((_, i) => (i === 2 ? 1234.5 : 0))]);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const sin = await p.http.post(`/api/presupuestos/${a.id}/importar`).attach('archivo', await libro(['Enero', 'Febrero', 'Marzo']), 'p.xlsx');
    expect([sin.status, sin.body.message]).toEqual([400, 'No se encontraron columnas de meses (MM/AAAA)']);
    expect((await grilla(p, a.id)).lineas.map((l) => l.codigo)).toEqual(['5.2.01']);
    const fechas = [1, 2, 3].map((m) => new Date(Date.UTC(2026, m - 1, 1)));
    const ok = await p.http.post(`/api/presupuestos/${a.id}/importar`).attach('archivo', await libro(fechas), 'p.xlsx');
    expect(ok.status).toBe(201);
    expect((await grilla(p, a.id)).lineas.map((l) => [l.codigo, l.importes['2026-03']])).toEqual([['4.1.01', '1234.50']]);
  });
});
