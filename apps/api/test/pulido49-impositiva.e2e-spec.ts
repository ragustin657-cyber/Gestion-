import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararBienes } from './helpers-bienes';

describe('pulido E49: amortización y ajuste impositivos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const indices = async (v: Record<string, number>) => {
    for (const [k, valor] of Object.entries(v)) await prisma.indiceInflacion.create({ data: { anio: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)), valor, actualizadoPor: 't' } });
  };
  const escenario = async () => {
    const b = await prepararBienes(app, prisma);
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: b.empresaId, numero: 1 } });
    return { ...b, ej };
  };

  it('bien inicial: el valor de origen no puede quedar por debajo del terreno', async () => {
    const x = await escenario();
    const rubro = await x.rubro('Muebles y útiles');
    const bien = await prisma.bienUso.create({ data: { empresaId: x.empresaId, numero: 900, descripcion: 'Local', rubroId: rubro.id, fechaAlta: new Date('2026-03-01'), valorOrigen: 1000, valorTerreno: 500, vidaUtilMeses: 120, origen: 'INICIAL', creadoPor: 't' } });
    const r = await x.http.put(`/api/bienes-uso/${bien.id}`, { valorOrigen: 400 });
    expect([r.status, r.body.message]).toEqual([400, 'El terreno no puede superar el valor de origen']);
    expect((await x.http.put(`/api/bienes-uso/${bien.id}`, { valorOrigen: 600 })).status).toBe(200);
  });

  it('automóvil con el tope por defecto: aviso; Excel con deducible y costo de la baja', async () => {
    const x = await escenario();
    await indices({ '2026-03': 100, '2026-12': 100 });
    await x.facturaBien({ neto: 2000000 });
    const r = await x.rubro('Rodados');
    await x.http.put(`/api/bienes-uso/rubros/${r.id}`, { nombre: r.nombre, cuentaOrigenId: r.cuentaOrigenId, cuentaAmortizacionId: r.cuentaAmortizacionId, cuentaGastoId: r.cuentaGastoId, vidaUtilMeses: r.vidaUtilMeses, tipoImpositivo: 'AUTOMOVIL', vidaUtilImpositivaAnios: 5 });
    const p = await x.http.get(`/api/bienes-uso/planilla-impositiva?ejercicioId=${x.ej.id}`);
    expect(p.body.avisos).toContain('El tope de automóviles es el valor por defecto: verifíquelo en Configuración de impuestos');
    const xl = await x.http.get(`/api/bienes-uso/planilla-impositiva?ejercicioId=${x.ej.id}&formato=xlsx`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.body);
    const filas: unknown[][] = [];
    wb.worksheets[0].eachRow((row) => filas.push((row.values as unknown[]).slice(1)));
    const titulos = filas.find((f) => f[0] === 'Bien')!;
    expect(titulos).toContain('Deducible');
    expect(titulos).toContain('Costo computable de la baja');
    const total = filas[filas.length - 1];
    expect(total[titulos.indexOf('Deducible')]).toBe(Number(p.body.totales.deducible));
    // Con tope configurado no hay aviso
    await prisma.configImpuestos.upsert({ where: { empresaId: x.empresaId }, create: { empresaId: x.empresaId, topeAutomovilesCosto: 1000000 }, update: { topeAutomovilesCosto: 1000000 } });
    expect((await x.http.get(`/api/bienes-uso/planilla-impositiva?ejercicioId=${x.ej.id}`)).body.avisos.join()).not.toContain('tope');
  });

  it('ajuste impositivo de la cuenta: solo activo y pasivo; se propaga a las subcuentas', async () => {
    const x = await escenario();
    const pn = await x.cuenta('3.1.01');
    const r = await x.http.patch(`/api/plan-cuentas/${pn}`, { ajusteImpositivo: 'EXCLUIDO' });
    expect([r.status, r.body.message]).toEqual([400, 'Solo las cuentas de activo y pasivo tienen ajuste impositivo']);
    const padre = await x.cuenta('1.2.01');
    expect((await x.http.patch(`/api/plan-cuentas/${padre}`, { ajusteImpositivo: 'COMPUTABLE' })).status).toBe(200);
    const hijas = await prisma.cuentaContable.findMany({ where: { empresaId: x.empresaId, codigo: { startsWith: '1.2.01.' } } });
    expect(hijas.length).toBeGreaterThanOrEqual(3);
    expect(hijas.every((c) => c.ajusteImpositivo === 'COMPUTABLE')).toBe(true);
    // Las de 1.2.02 no cambian
    expect((await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '1.2.02.001' } })).ajusteImpositivo).toBe('EXCLUIDO');
  });

  it('ejercicio que no es un UUID: 404', async () => {
    const x = await escenario();
    for (const url of ['/api/bienes-uso/planilla-impositiva', '/api/impuestos/ajuste-inflacion', '/api/impuestos/dj-ganancias']) {
      const r = await x.http.get(`${url}?ejercicioId=abc`);
      expect([url, r.status, r.body.message]).toEqual([url, 404, 'Ejercicio no encontrado']);
    }
  });
});
