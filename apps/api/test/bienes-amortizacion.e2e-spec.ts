import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararBienes } from './helpers-bienes';

describe('bienes de uso: amortización mensual', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('previa y generar del ejemplo', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1200000 });
    const previa = (await b.http.get('/api/bienes-uso/amortizacion/previa?mes=2026-09')).body;
    expect(previa.total).toBe('140000.00');
    expect(previa.porRubro).toEqual([expect.objectContaining({ nombre: 'Rodados', importe: '140000.00' })]);
    const g = await b.generar('2026-09');
    const asiento = await prisma.asiento.findUniqueOrThrow({ where: { id: g.asientoId }, include: { renglones: true } });
    expect(asiento.fecha.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(await b.saldo('5.2.07')).toBe('140000.00');
    expect(await b.saldo('1.2.02.002')).toBe('-140000.00');
    expect(asiento.renglones.map((r) => r.fechaOrigen?.toISOString().slice(0, 10))).toEqual(['2026-03-01', '2026-03-01']);
    expect((await b.http.get('/api/bienes-uso/amortizacion/previa?mes=2026-09')).body.total).toBe('0.00');
    expect((await b.http.post('/api/bienes-uso/amortizacion', { mes: '2026-09' })).body.message).toBe('No hay amortizaciones para contabilizar en 09/2026');
  });

  it('bien cargado tarde', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1200000 });
    await b.generar('2026-09');
    await b.facturaBien({ neto: 120000, fecha: '2026-08-10', cuenta: '1.2.01.001', bien: { descripcion: 'Escritorio' } });
    const g = await b.generar('2026-09');
    expect(g.total).toBe('2000.00');
    expect((await b.http.get('/api/bienes-uso/amortizacion/previa?mes=2026-10')).body.total).toBe('21000.00');
  });

  it('anular solo la última', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1200000 });
    const sep = await b.generar('2026-09');
    const oct = await b.generar('2026-10');
    expect((await b.http.post(`/api/bienes-uso/amortizacion/${sep.id}/anular`)).body.message).toBe('Solo se puede anular la última amortización generada');
    expect((await b.http.post(`/api/bienes-uso/amortizacion/${oct.id}/anular`)).status).toBe(201);
    expect((await b.generar('2026-10')).total).toBe('20000.00');
    expect((await b.http.post('/api/bienes-uso/amortizacion', { mes: '2026-08' })).body.message).toBe('Ya hay una amortización generada para un mes posterior: 10/2026');
    expect(await b.saldo('1.2.02.002')).toBe('-160000.00');
    const lista = (await b.http.get('/api/bienes-uso/amortizacion')).body;
    expect(lista.map((p: { mes: string; estado: string }) => [p.mes, p.estado])).toEqual([['2026-10', 'VIGENTE'], ['2026-10', 'ANULADO'], ['2026-09', 'VIGENTE']]);
  });

  it('ajuste por inflación reexpresa desde el mes de alta', async () => {
    const b = await prepararBienes(app, prisma);
    for (let m = 0; m <= 9; m++) {
      const [anio, mes] = m === 0 ? [2025, 12] : [2026, m];
      await prisma.indiceInflacion.create({ data: { anio, mes, valor: m === 0 ? 90 : 100 + 10 * (m - 1), actualizadoPor: 't' } });
    }
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: b.empresaId, numero: 1 } });
    expect((await b.http.put('/api/contabilidad/ajuste-inflacion/config', { primerEjercicioId: ej.id, anticuacion: [] })).status).toBe(200);
    await b.facturaBien({ neto: 1200000 });
    await b.generar('2026-09');
    const cuentas = (await b.http.get('/api/contabilidad/ajuste-inflacion/previa?fecha=2026-09-30')).body.cuentas as { codigo: string; reexpresado: string }[];
    expect(cuentas.find((c) => c.codigo === '1.2.02.002')!.reexpresado).toBe('-210000.00');
    expect(cuentas.find((c) => c.codigo === '5.2.07')!.reexpresado).toBe('210000.00');
  });

  it('cierre exige la amortización del mes de cierre', async () => {
    const b = await prepararBienes(app, prisma);
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: b.empresaId, numero: 1 } });
    const faltantes = async () => (await b.http.get(`/api/contabilidad/ejercicios/${ej.id}/cierre/previa`)).body.faltantes as string[];
    expect(await faltantes()).not.toContain('Genere la amortización de bienes de uso de 12/2026');
    await b.facturaBien({ neto: 1200000 });
    expect(await faltantes()).toContain('Genere la amortización de bienes de uso de 12/2026');
  });

  it('anular factura con amortización generada', async () => {
    const b = await prepararBienes(app, prisma);
    const { comprobanteId } = await b.facturaBien({ neto: 1200000 });
    const sep = await b.generar('2026-09');
    expect((await b.http.post(`/api/compras/comprobantes/${comprobanteId}/anular`, { motivo: 'Error' })).body.message).toBe('El bien N° 1 ya tiene amortizaciones o baja: anúlelas primero');
    await b.http.post(`/api/bienes-uso/amortizacion/${sep.id}/anular`);
    expect((await b.http.post(`/api/compras/comprobantes/${comprobanteId}/anular`, { motivo: 'Error' })).status).toBe(200);
  });
});
