import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararConciliacion } from './helpers-conciliacion';

describe('reglas y registro desde el extracto', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function escenario() {
    const t = await prepararConciliacion(app, prisma);
    await prisma.movimientoTesoreria.create({
      data: { empresaId: t.empresaId, fecha: new Date('2026-10-11T00:00:00Z'), tipo: 'INGRESO', cuentaBancariaId: t.ars.id, monedaCodigo: 'ARS', importe: 53000, origenTipo: 'DEPOSITO', origenId: randomUUID() },
    });
    await t.importar(t.csv(['11/10/2026;DEPOSITO;0045;53.000,00', '15/10/2026;IMP. LEY 25413 DEB;;-318,00', '16/10/2026;PERCEP IVA RG 2408;;-120,00', '20/10/2026;INTERESES;;150,00']));
    const c = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-10-01', hasta: '2026-10-31', saldoFinal: 52712 })).body;
    const linea = async (concepto: string) => prisma.lineaExtracto.findFirstOrThrow({ where: { concepto } });
    return { t, c, linea, url: `/api/conciliacion/conciliaciones/${c.id}` };
  }

  it('una empresa nueva tiene las reglas iniciales y las cuentas nuevas', async () => {
    const { t } = await escenario();
    await t.cuenta('5.2.05');
    await t.cuenta('4.2.02');
    const reglas = (await t.http.get('/api/conciliacion/reglas')).body;
    expect(reglas).toHaveLength(10);
    expect(reglas.map((r: { texto: string }) => r.texto).slice(0, 3)).toEqual(['PERCEP IVA', 'PERCEP IIBB', 'SIRCREB']);
  });

  it('las líneas traen la regla sugerida, respetando la prioridad', async () => {
    const { t, url } = await escenario();
    const r = (await t.http.get(url)).body;
    const por = (concepto: string) => r.lineas.find((l: { concepto: string }) => l.concepto === concepto).reglaSugerida;
    expect(por('IMP. LEY 25413 DEB').cuenta).toBe('5.2.05 Impuesto a los débitos y créditos bancarios');
    expect(por('PERCEP IVA RG 2408').cuenta).toMatch(/^1\.1\.03\.002/);
    expect(por('INTERESES').cuenta).toBe('4.2.02 Intereses ganados');
    expect(por('DEPOSITO')).toBeNull();
  });

  it('registrar desde el extracto crea el movimiento bancario, el asiento y el vínculo', async () => {
    const { t, url, linea } = await escenario();
    const imp = await linea('IMP. LEY 25413 DEB');
    const int = await linea('INTERESES');
    const r = await t.http.post(`${url}/registrar`, {
      lineas: [
        { lineaId: imp.id, cuentaContableId: await t.cuenta('5.2.05'), concepto: 'Impuesto ley 25.413' },
        { lineaId: int.id, cuentaContableId: await t.cuenta('4.2.02'), concepto: 'Intereses' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ registradas: 2 });
    const mb = await prisma.movimientoBancario.findMany({ orderBy: { numero: 'asc' } });
    expect(mb.map((m) => [m.tipo, m.importe.toString(), m.fecha.toISOString().slice(0, 10)])).toEqual([['GASTO', '318', '2026-10-15'], ['INGRESO', '150', '2026-10-20']]);
    const asiento = (id: string) => prisma.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
    const a = await asiento(mb[0].asientoId!);
    const cods = await Promise.all(a.renglones.map(async (x) => [(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo, x.debe.toString(), x.haber.toString()]));
    expect(cods.sort()).toEqual([['1.1.01.002', '0', '318'], ['5.2.05', '318', '0']]);
    expect((await prisma.lineaExtracto.findUniqueOrThrow({ where: { id: imp.id } })).estado).toBe('CONCILIADA');
    expect((await prisma.vinculoConciliacion.findMany()).map((v) => v.tipo)).toEqual(['REGISTRO', 'REGISTRO']);
    const res = (await t.http.get(url)).body.resumen;
    expect(res.diferencia).toBe('0');
    // Una línea ya registrada no se vuelve a registrar
    const otra = await t.http.post(`${url}/registrar`, { lineas: [{ lineaId: imp.id, cuentaContableId: await t.cuenta('5.2.05'), concepto: 'x' }] });
    expect(otra.status).toBe(409);
    expect(await prisma.movimientoBancario.count()).toBe(2);
  });

  it('ABM de reglas: cuenta no imputable → 400; alta y modificación', async () => {
    const { t } = await escenario();
    expect((await t.http.post('/api/conciliacion/reglas', { prioridad: 5, texto: 'DEB AUTOM', sentido: 'DEBITO', cuentaContableId: await t.cuenta('5.2') })).status).toBe(400);
    const r = await t.http.post('/api/conciliacion/reglas', { prioridad: 5, texto: 'DEB AUTOM SEGURO', sentido: 'DEBITO', cuentaContableId: await t.cuenta('5.2.01'), concepto: 'Seguro' });
    expect(r.status).toBe(201);
    expect((await t.http.patch(`/api/conciliacion/reglas/${r.body.id}`, { activa: false })).body.activa).toBe(false);
    expect((await t.http.get('/api/conciliacion/reglas')).body).toHaveLength(11);
  });
});
