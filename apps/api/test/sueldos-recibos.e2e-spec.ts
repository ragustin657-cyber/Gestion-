import ExcelJS from 'exceljs';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

/** Texto de un PDF sin comprimir generado por pdfkit. */
function textoPdf(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) partes.push(Buffer.from([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join(''), 'hex').toString('latin1'));
  return partes.join('\n');
}

describe('sueldos: recibos y resumen', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const e = await s.empleado();
    const l = (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    await s.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    await s.http.put(`/api/sueldos/liquidaciones/${l.id}/deposito`, { fecha: '2026-11-10', banco: 'Banco Nación', periodo: '10/2026' });
    const bin = (url: string) => s.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    return { ...s, e, l, bin };
  };

  it('recibo PDF', async () => {
    const x = await escenario();
    const borrador = await x.bin(`/api/sueldos/liquidaciones/${x.l.id}/recibos.pdf`);
    expect(textoPdf(borrador.body as Buffer)).toContain('BORRADOR');
    await x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/cerrar`);
    const r = await x.bin(`/api/sueldos/liquidaciones/${x.l.id}/recibos.pdf?empleadoId=${x.e.id}`);
    expect(r.headers['content-type']).toContain('pdf');
    const t = textoPdf(r.body as Buffer);
    for (const s of ['Vendedor B', '941.016,82', 'novecientos cuarenta y un mil dieciséis', 'Firma del empleado', '20-17254359-7', 'Último depósito', 'Banco Nación', 'ORIGINAL', 'DUPLICADO']) expect(t).toContain(s);
    expect(t).not.toContain('BORRADOR');
  });

  it('resumen', async () => {
    const x = await escenario();
    const r = await x.bin(`/api/sueldos/liquidaciones/${x.l.id}/resumen?formato=xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Por concepto', 'Por empleado']);
    const filas: unknown[][] = [];
    wb.worksheets[0].eachRow((row) => filas.push((row.values as unknown[]).slice(1)));
    expect(filas).toContainEqual(['100', 'Sueldo básico', 1000000]);
    expect(filas).toContainEqual(['500', 'Jubilación', 128586.15]);
    expect((await x.bin(`/api/sueldos/liquidaciones/${x.l.id}/resumen?formato=pdf`)).headers['content-type']).toContain('pdf');
  });
});
