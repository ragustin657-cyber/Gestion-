import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { crearEjercicio } from '../src/contabilidad/periodos/ejercicios';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { TABLA_PRUEBA } from './helpers-ganancias';
import { prepararSueldos } from './helpers-sueldos';

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
const LARGOS: Record<string, number> = { '01': 38, '02': 36, '03': 178, '04': 313, '05': 478, '06': 160, '07': 178, '08': 105 };
/** Importe de un campo (posiciones del manual, base 1) con 2 decimales implícitos. */
const importe = (l: string, desde: number, hasta: number) => { const s = l.slice(desde - 1, hasta); return D(s.replace('-', '')).div(100).times(s.startsWith('-') ? -1 : 1); };

describe('ganancias: F.1359 y certificados', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionGanancias: true } });
    await prisma.$transaction((tx) => crearEjercicio(tx, s.empresaId, new Date('2025-01-01T00:00:00Z'), 0));
    await s.escala('Vendedor B', '2025-06', 30000000);
    for (const sem of [1, 2]) for (const anio of [2025, 2026]) await s.http.put(`/api/sueldos/ganancias/tablas/${anio}/${sem}`, TABLA_PRUEBA);
    const e = await s.empleado();
    const crear = async (tipo: string, anio: number, mes: number) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-28` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const cerrar = async (id: string) => { const r = await s.http.post(`/api/sueldos/liquidaciones/${id}/cerrar`); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); };
    const bin = (url: string) => s.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (b: Buffer) => p.push(b)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const lineas = (b: Buffer) => b.toString('latin1').split('\r\n').filter((x) => x);
    const anual = async () => {
      expect((await s.http.post('/api/sueldos/ganancias/anual/2025/calcular')).status).toBe(201);
      expect((await s.http.post('/api/sueldos/ganancias/anual/2025/cerrar')).status).toBe(201);
    };
    return { ...s, e, crear, cerrar, bin, lineas, anual };
  };

  it('anual', async () => {
    const x = await escenario();
    // En orden de fecha de pago: junio, SAC de junio y noviembre
    await x.cerrar((await x.crear('MENSUAL', 2025, 6)).id);
    await x.cerrar((await x.crear('SAC', 2025, 6)).id);
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    await x.anual();
    const r = await x.bin('/api/sueldos/ganancias/f1359/anual/2025');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('F1359.30712345671.20250000.0000.txt');
    const ls = x.lineas(r.body as Buffer);
    expect(ls[0]).toBe('01307123456712025000001035931359100200');
    expect(ls.map((l) => l.slice(0, 2))).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    for (const l of ls) expect(l.length).toBe(LARGOS[l.slice(0, 2)]);
    const [, r02, r03, , r05, r06, r07, r08] = ls;
    expect(r02.slice(13, 21)).toBe('20250101');
    // SAC de junio en la primera cuota
    expect(importe(r03, 44, 58).gt(0)).toBe(true);
    expect(importe(r03, 59, 73).toFixed(2)).toBe('0.00');
    // Controles
    const totalGravada = importe(r03, 164, 178);
    const totalGenerales = importe(r05, 464, 478);
    const totalArt30 = importe(r06, 142, 156);
    expect(importe(r08, 14, 28).toFixed(2)).toBe(Prisma.Decimal.max(totalGravada.minus(totalGenerales).minus(totalArt30), 0).toFixed(2));
    expect(importe(r08, 61, 75).toFixed(2)).toBe(importe(r08, 31, 45).minus(importe(r08, 46, 60)).toFixed(2));
    expect(importe(r08, 91, 105).toFixed(2)).toBe(importe(r08, 61, 75).minus(importe(r07, 164, 178)).toFixed(2));
    const fila = await prisma.liquidacionAnualGananciasEmpleado.findFirstOrThrow({ where: { empleadoId: x.e.id } });
    expect(importe(r08, 91, 105).toFixed(2)).toBe(fila.saldo.toFixed(2));
  });

  it('empleado sin retenciones', async () => {
    const x = await escenario();
    await x.escala('Vendedor B', '2025-06', 300000);
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    await x.anual();
    const ls = x.lineas((await x.bin('/api/sueldos/ganancias/f1359/anual/2025')).body as Buffer);
    const r08 = ls.find((l) => l.startsWith('08'))!;
    expect([r08.slice(28, 30), r08.slice(90, 105)]).toEqual(['00', '000000000000000']);
    // Revisión E32: el art. 30 se limita a gravada + exenta (el manual rechaza el archivo si la supera) y suma sus campos
    const r03 = ls.find((l) => l.startsWith('03'))!;
    const r04 = ls.find((l) => l.startsWith('04'))!;
    const r06 = ls.find((l) => l.startsWith('06'))!;
    const tope = importe(r03, 164, 178).plus(importe(r04, 284, 298));
    expect(importe(r06, 142, 156).toFixed(2)).toBe(tope.toFixed(2));
    const suma = importe(r06, 14, 28).plus(importe(r06, 112, 126)).plus(importe(r06, 127, 141)).plus(importe(r06, 97, 111));
    expect(suma.toFixed(2)).toBe(tope.toFixed(2));
  });

  it('deducciones generales en cero', async () => {
    const x = await escenario();
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    // Sin aportes: se quitan los descuentos del recibo cerrado
    await prisma.reciboSueldoRenglon.deleteMany({ where: { clase: 'DESCUENTO', recibo: { empleadoId: x.e.id } } });
    await x.anual();
    const e = await prisma.empleado.findUniqueOrThrow({ where: { id: x.e.id } });
    // CUIL corregido después del cierre de la anual: el mensaje sigue nombrando al empleado (E34)
    await prisma.empleado.update({ where: { id: x.e.id }, data: { cuil: '20-99999999-0' } });
    const r = await x.http.get('/api/sueldos/ganancias/f1359/anual/2025');
    expect([r.status, r.body.message]).toEqual([400, `El F.1359 no admite deducciones generales en cero (sin aportes): ${e.apellido}, ${e.nombre}`]);
  });

  it('devolución con signo', async () => {
    const x = await escenario();
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    await x.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2025`, { bruta: 0, aportes: 0, retenido: 90000000 });
    await x.anual();
    const r08 = x.lineas((await x.bin('/api/sueldos/ganancias/f1359/anual/2025')).body as Buffer).find((l) => l.startsWith('08'))!;
    expect(r08.slice(90, 91)).toBe('-');
  });

  it('anual sin cerrar', async () => {
    const x = await escenario();
    const r = await x.http.get('/api/sueldos/ganancias/f1359/anual/2025');
    expect([r.status, r.body.message]).toEqual([400, 'Cierre la liquidación anual de 2025 antes de descargar el F.1359']);
  });

  it('final', async () => {
    const x = await escenario();
    await x.escala('Vendedor B', '2026-11', 30000000);
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-03', preavisoOtorgado: false, fechaPago: '2026-11-05' })).body as { id: string };
    await x.cerrar(f.id);
    const r = await x.bin('/api/sueldos/ganancias/f1359/final/2026/11');
    expect(r.status).toBe(200);
    const ls = x.lineas(r.body as Buffer);
    expect(ls[0].slice(13, 20)).toBe('2026110');
    expect(ls[0].slice(32, 33)).toBe('2');
    const indemn = (await prisma.reciboSueldoRenglon.findFirstOrThrow({ where: { codigo: '300', recibo: { liquidacionId: f.id } } })).importe;
    expect(importe(ls.find((l) => l.startsWith('04'))!, 44, 58).toFixed(2)).toBe(D(indemn).toFixed(2));
    // SAC proporcional (200/201) y SAC sobre preaviso, integración y vacaciones van a la 2.ª cuota (pago en noviembre), no a la bruta (E33)
    const sacs = await prisma.reciboSueldoRenglon.findMany({ where: { codigo: { in: ['200', '201', '311', '321', '331'] }, recibo: { liquidacionId: f.id } } });
    const sumaSac = sacs.reduce((t, y) => t.plus(y.importe), D(0));
    expect(sumaSac.gt(0)).toBe(true);
    expect(importe(ls.find((l) => l.startsWith('03'))!, 59, 73).toFixed(2)).toBe(sumaSac.toFixed(2));
    const pdf = await x.bin(`/api/sueldos/liquidaciones/${f.id}/ganancias-certificado.pdf`);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('final sin liquidaciones', async () => {
    const x = await escenario();
    const r = await x.http.get('/api/sueldos/ganancias/f1359/final/2026/11');
    expect([r.status, r.body.message]).toEqual([400, 'No hay liquidaciones finales cerradas en 11/2026']);
  });

  it('distracto', async () => {
    const x = await escenario();
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    await x.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2025`, { bruta: 0, aportes: 0, retenido: 100000 });
    jest.setSystemTime(new Date('2026-02-20T15:00:00Z'));
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-02-15', preavisoOtorgado: true, fechaPago: '2026-02-20' })).body as { id: string };
    await x.cerrar(f.id);
    const r = await x.bin('/api/sueldos/ganancias/f1359/distracto/2025');
    expect(r.status).toBe(200);
    const ls = x.lineas(r.body as Buffer);
    expect([ls[0].slice(13, 19), ls[0].slice(32, 33)]).toEqual(['202500', '4']);
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    const fuera = await x.http.get('/api/sueldos/ganancias/f1359/distracto/2025');
    expect([fuera.status, fuera.body.message]).toEqual([400, 'El F.1359 de distracto se presenta del 1/1 al 31/3']);
  });

  it('rubros exentos', async () => {
    const x = await escenario();
    await x.http.post('/api/sueldos/conceptos', { codigo: '900', nombre: 'Asignación', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: { importe: 12345 }, orden: 900, exentoGanancias: true, rubroExentoGanancias: 'ASIGNACIONES_FAMILIARES' });
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    await x.anual();
    const r04 = x.lineas((await x.bin('/api/sueldos/ganancias/f1359/anual/2025')).body as Buffer).find((l) => l.startsWith('04'))!;
    expect(importe(r04, 14, 28).toFixed(2)).toBe('12345.00');
  });

  it('certificados', async () => {
    const x = await escenario();
    await x.cerrar((await x.crear('MENSUAL', 2025, 11)).id);
    await x.anual();
    const pdf = await x.bin('/api/sueldos/ganancias/anual/2025/certificados.pdf');
    expect([pdf.status, (pdf.body as Buffer).subarray(0, 4).toString()]).toEqual([200, '%PDF']);
  });
});
