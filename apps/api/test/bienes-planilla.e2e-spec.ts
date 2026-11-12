import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararBienes } from './helpers-bienes';
import { prepararVentas } from './helpers-ventas';

type Fila = { rubro: string; [k: string]: string };

describe('bienes de uso: planilla anexa', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const planilla = async (b: { empresaId: string; http: { get: (u: string) => Promise<{ body: unknown }> } }, extra = '') => {
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: b.empresaId, numero: 1 } });
    return (await b.http.get(`/api/bienes-uso/planilla?ejercicioId=${ej.id}&fecha=2026-10-31${extra}`)).body as { filas: Fila[]; totales: Record<string, string>; control: Record<string, string>; aviso?: string };
  };

  it('planilla del ejemplo coincide con el Mayor', async () => {
    const v = await prepararVentas(app, prisma);
    const b = await prepararBienes(app, prisma, v);
    const { bien } = await b.facturaBien({ neto: 1200000 });
    await b.generar('2026-09');
    await b.facturaBien({ neto: 120000, fecha: '2026-08-10', cuenta: '1.2.01.001', bien: { descripcion: 'Escritorio' } });
    await b.generar('2026-09');
    const r = await v.http.post('/api/ventas/comprobantes', { ...v.datos({ fecha: '2026-10-15', fechaVencimiento: '2026-11-15', renglones: [{ bienUsoId: bien.id, descripcion: 'Camioneta', cantidad: 1, precioUnitario: 1100000, alicuota: 21 }] }), emitir: true });
    expect(r.body.estado).toBe('AUTORIZADO');
    await b.generar('2026-10');
    const p = await planilla(b);
    expect(p.filas.find((f) => f.rubro === 'Rodados')).toMatchObject({ origenInicio: '0.00', altas: '1200000.00', bajas: '-1200000.00', origenCierre: '0.00', amortInicio: '0.00', amortEjercicio: '140000.00', amortBajas: '-140000.00', amortCierre: '0.00', neto: '0.00' });
    expect(p.filas.find((f) => f.rubro === 'Muebles y útiles')).toMatchObject({ altas: '120000.00', amortEjercicio: '3000.00', amortCierre: '3000.00', neto: '117000.00' });
    expect(p.totales).toMatchObject({ altas: '1320000.00', neto: '117000.00' });
    expect(p.control).toEqual({ origen: '0.00', amortizacion: '0.00' });
  });

  it('carga inicial al inicio del ejercicio', async () => {
    const b = await prepararBienes(app, prisma);
    const rubro = await b.rubro('Rodados');
    await b.http.post('/api/bienes-uso', { origen: 'INICIAL', descripcion: 'Auto', rubroId: rubro.id, fechaAlta: '2024-01-10', valorOrigen: 600000, amortizacionInicial: 240000, fechaAmortizacionInicial: '2025-12-31' });
    const p = await planilla(b);
    expect(p.filas.find((f) => f.rubro === 'Rodados')).toMatchObject({ origenInicio: '600000.00', altas: '0.00', amortInicio: '240000.00', amortEjercicio: '0.00', amortCierre: '240000.00', neto: '360000.00' });
  });

  it('reexpresada', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1200000 });
    expect((await planilla(b, '&reexpresar=true')).aviso).toBe('Faltan los índices de: 03/2026, 10/2026: se muestran importes nominales');
    for (const [mes, valor] of [[3, 100], [10, 110]]) await prisma.indiceInflacion.create({ data: { anio: 2026, mes, valor, actualizadoPor: 't' } });
    const p = await planilla(b, '&reexpresar=true');
    expect(p.aviso).toBeUndefined();
    expect(p.filas.find((f) => f.rubro === 'Rodados')!.altas).toBe('1320000.00');
  });

  it('exporta y permisos', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1200000 });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: b.empresaId, numero: 1 } });
    const bin = (url: string) => b.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect((await bin(`/api/bienes-uso/planilla?ejercicioId=${ej.id}&formato=xlsx`)).headers['content-type']).toContain('spreadsheetml');
    expect((await bin(`/api/bienes-uso/planilla?ejercicioId=${ej.id}&formato=pdf`)).headers['content-type']).toContain('pdf');
    const u = await otroUsuario(app, prisma, b.empresaId, ['venta.ver']);
    expect((await u.http.get(`/api/bienes-uso/planilla?ejercicioId=${ej.id}`)).status).toBe(403);
  });
});
