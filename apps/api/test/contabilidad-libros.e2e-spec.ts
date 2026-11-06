import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

/** Texto de un PDF sin comprimir generado por pdfkit (cadenas hexadecimales de los operadores TJ). */
function textoPdf(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const hex = [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join('');
    partes.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  return partes.join('\n');
}

describe('libros legales', () => {
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
    const gasto = await s.cuenta('5.2.01');
    const caja = await s.cuenta('1.1.01.001');
    for (let i = 1; i <= 80; i++)
      await s.http.post('/api/contabilidad/asientos', { fecha: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, descripcion: `Gasto ${i}`, renglones: [{ cuentaContableId: gasto, debe: 10 }, { cuentaContableId: caja, haber: 10 }] });
    await s.http.post('/api/contabilidad/asientos', { fecha: '2026-02-10', descripcion: 'Febrero', renglones: [{ cuentaContableId: gasto, debe: 5 }, { cuentaContableId: caja, haber: 5 }] });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const emitir = (ruta: string, body: object) =>
      request(app.getHttpServer()).post(ruta).set('Authorization', `Bearer ${s.token}`).send(body).buffer(true).parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    return { s, ej, emitir };
  }

  it('Libro Diario foliado con transporte, continuidad de folios y advertencia de reemisión', async () => {
    const { s, ej, emitir } = await escenario();
    const abierto = await emitir('/api/contabilidad/libros/diario', { desde: '2026-01-01', hasta: '2026-01-31' });
    expect(abierto.status).toBe(400);
    expect(JSON.parse((abierto.body as Buffer).toString()).message).toBe('El período 01/2026 no está cerrado');
    await s.http.post(`/api/contabilidad/periodos/${ej.periodos[0].id}/cerrar`, {});
    await s.http.post(`/api/contabilidad/periodos/${ej.periodos[1].id}/cerrar`, {});
    const ene = await emitir('/api/contabilidad/libros/diario', { desde: '2026-01-01', hasta: '2026-01-31' });
    expect(ene.status).toBe(200);
    const pdf = ene.body as Buffer;
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(ene.headers['x-folio-inicial']).toBe('1');
    const finEne = Number(ene.headers['x-folio-final']);
    expect(finEne).toBeGreaterThan(1);
    const texto = textoPdf(pdf);
    expect(texto).toContain('Folio 1');
    expect(texto).toContain('Libro Diario');
    expect(texto).toContain('Transporte');
    expect(texto).toContain('Viene de transporte');
    expect(texto).toContain('Gasto 1');
    const feb = await emitir('/api/contabilidad/libros/diario', { desde: '2026-02-01', hasta: '2026-02-28' });
    expect(feb.headers['x-folio-inicial']).toBe(String(finEne + 1));
    expect(feb.headers['x-advertencia']).toBeUndefined();
    const otra = await emitir('/api/contabilidad/libros/diario', { desde: '2026-01-01', hasta: '2026-01-31', folioInicial: 50 });
    expect(otra.headers['x-folio-inicial']).toBe('50');
    expect(otra.headers['x-advertencia']).toMatch(/^El rango ya fue emitido el \d{2}\/\d{2}\/\d{4} \(folios 1 a \d+\)$/);
    const historial = (await s.http.get('/api/contabilidad/libros/emisiones')).body;
    expect(historial).toHaveLength(3);
  });

  it('Libro de Inventarios y Balances solo con el ejercicio cerrado', async () => {
    const { s, ej, emitir } = await escenario();
    const abierto = await emitir('/api/contabilidad/libros/inventarios', { ejercicioId: ej.id });
    expect(abierto.status).toBe(400);
    for (const p of ej.periodos.slice(0, 11)) await s.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {});
    await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    expect((await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).status).toBe(200);
    const r = await emitir('/api/contabilidad/libros/inventarios', { ejercicioId: ej.id });
    expect(r.status).toBe(200);
    const texto = textoPdf(r.body as Buffer);
    expect(texto).toContain('Libro de Inventarios y Balances');
    expect(texto).toContain('Estado de situación patrimonial');
    expect(texto).toContain('Estado de resultados');
    expect(texto).toContain('Balance de sumas y saldos');
  });
});
