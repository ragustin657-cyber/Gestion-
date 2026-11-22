import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararBienes } from './helpers-bienes';

type FilaBien = Record<string, string | number | null>;
type Planilla = { filas: { rubroId: string; rubro: string; bienes: FilaBien[]; subtotal: Record<string, string> }[]; totales: Record<string, string>; avisos: string[] };

describe('bienes de uso: amortización impositiva (E44)', () => {
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
    const planilla = async (extra = '') => b.http.get(`/api/bienes-uso/planilla-impositiva?ejercicioId=${ej.id}${extra}`);
    const datos = async () => { const r = await planilla(); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body as Planilla; };
    const rubroBody = async (nombre: string, extra: object) => {
      const r = await b.rubro(nombre);
      return b.http.put(`/api/bienes-uso/rubros/${r.id}`, { nombre: r.nombre, cuentaOrigenId: r.cuentaOrigenId, cuentaAmortizacionId: r.cuentaAmortizacionId, cuentaGastoId: r.cuentaGastoId, vidaUtilMeses: r.vidaUtilMeses, ...extra });
    };
    return { ...b, ej, planilla, datos, rubroBody };
  };

  it('mueble actualizado por IPC, vida contable redondeada con aviso, diferencia con la contable', async () => {
    const x = await escenario();
    await indices({ '2026-03': 100, '2026-12': 110 });
    const { bien } = await x.facturaBien({ neto: 1200000, cuenta: '1.2.01.002' });
    await x.generar('2026-10');
    const p = await x.datos();
    const [f] = p.filas[0].bienes;
    expect([p.filas[0].rubro, f.vidaUtilAnios, f.coeficiente, f.valorActualizado, f.cuota, f.noDeducible]).toEqual(['Rodados', 5, '1.1000', '1320000.00', '264000.00', '0.00']);
    const contable = (await prisma.amortizacionBien.findMany({ where: { bienId: bien.id } })).reduce((s, a) => s + Number(a.importe), 0);
    expect(Number(f.contable)).toBeCloseTo(contable, 2);
    expect(Number(f.diferencia)).toBeCloseTo(264000 - contable, 2);
    expect([p.totales.deducible, Number(p.totales.contable)]).toEqual(['264000.00', contable]);
    expect(p.avisos).toEqual(['Se usa la vida útil contable de: Rodados']);
  });

  it('vida impositiva del rubro y del bien', async () => {
    const x = await escenario();
    await indices({ '2026-03': 100, '2026-12': 100 });
    const { bien } = await x.facturaBien({ neto: 1200000 });
    expect((await x.rubroBody('Rodados', { vidaUtilImpositivaAnios: 3 })).status).toBe(200);
    let p = await x.datos();
    expect([p.filas[0].bienes[0].cuota, p.avisos]).toEqual(['400000.00', []]);
    expect((await x.http.put(`/api/bienes-uso/${bien.id}/impositivo`, { vidaUtilImpositivaAnios: 2, valorTerreno: 0 })).status).toBe(200);
    p = await x.datos();
    expect(p.filas[0].bienes[0].cuota).toBe('600000.00');
  });

  it('inmueble sin terreno avisa; terreno mayor que el valor: error', async () => {
    const x = await escenario();
    await indices({ '2026-03': 100, '2026-12': 100 });
    const { bien } = await x.facturaBien({ neto: 1000000 });
    await x.rubroBody('Rodados', { tipoImpositivo: 'INMUEBLE' });
    const p = await x.datos();
    expect(p.avisos).toContain(`Revise el valor del terreno de: ${bien.numero} Camioneta`);
    // Inmueble sin vida impositiva: 50 años, trimestres desde el alta (marzo: 4 de 4)
    expect(p.filas[0].bienes[0].cuota).toBe('20000.00');
    const r = await x.http.put(`/api/bienes-uso/${bien.id}/impositivo`, { vidaUtilImpositivaAnios: null, valorTerreno: 2000000 });
    expect([r.status, r.body.message]).toEqual([400, 'El terreno no puede superar el valor de origen']);
  });

  it('automóvil con tope configurado', async () => {
    const x = await escenario();
    await indices({ '2026-03': 100, '2026-12': 100 });
    await x.facturaBien({ neto: 2000000 });
    await x.rubroBody('Rodados', { tipoImpositivo: 'AUTOMOVIL', vidaUtilImpositivaAnios: 5 });
    await prisma.configImpuestos.upsert({ where: { empresaId: x.empresaId }, create: { empresaId: x.empresaId, topeAutomovilesCosto: 1000000 }, update: { topeAutomovilesCosto: 1000000 } });
    const p = await x.datos();
    expect([p.filas[0].bienes[0].cuota, p.filas[0].bienes[0].noDeducible, p.totales.deducible]).toEqual(['400000.00', '200000.00', '200000.00']);
  });

  it('índices: faltante → error; sin bienes que se actualicen no se piden', async () => {
    const x = await escenario();
    await indices({ '2026-03': 100 });
    await x.facturaBien({ neto: 1000 });
    const r = await x.planilla();
    expect([r.status, r.body.message]).toEqual([400, 'Faltan los índices de: 12/2026']);
    const y = await escenario();
    await prisma.indiceInflacion.deleteMany({});
    const rubro = await y.rubro('Muebles y útiles');
    await prisma.bienUso.create({ data: { empresaId: y.empresaId, numero: 900, descripcion: 'Escritorio viejo', rubroId: rubro.id, fechaAlta: new Date('2015-06-01'), valorOrigen: 10000, vidaUtilMeses: 120, origen: 'INICIAL', creadoPor: 't' } });
    expect((await y.planilla()).status).toBe(200);
  });

  it('bajas: en el ejercicio sin cuota y con costo computable; antes del ejercicio no aparece', async () => {
    const x = await escenario();
    await indices({ '2024-05': 100, '2026-08': 150, '2026-12': 160 });
    const rubro = await x.rubro('Muebles y útiles');
    const base = { empresaId: x.empresaId, rubroId: rubro.id, fechaAlta: new Date('2024-05-10'), valorOrigen: 10000, vidaUtilMeses: 60, origen: 'INICIAL' as const, creadoPor: 't' };
    await prisma.bienUso.create({ data: { ...base, numero: 901, descripcion: 'Silla', estado: 'BAJA', fechaBaja: new Date('2026-08-15'), motivoBaja: 'DESUSO' } });
    await prisma.bienUso.create({ data: { ...base, numero: 902, descripcion: 'Mesa', estado: 'BAJA', fechaBaja: new Date('2025-06-15'), motivoBaja: 'DESUSO' } });
    const p = await x.datos();
    const bienes = p.filas.flatMap((f) => f.bienes);
    expect(bienes.map((b) => b.descripcion)).toEqual(['Silla']);
    // 15.000 − 2 años × 3.000 (vida 5)
    expect([bienes[0].cuota, bienes[0].costoComputableBaja]).toEqual(['0.00', '9000.00']);
  });

  it('Excel, validación y permiso', async () => {
    const x = await escenario();
    expect((await x.planilla('&formato=xlsx')).headers['content-type']).toContain('spreadsheetml');
    const r = await x.http.get('/api/bienes-uso/planilla-impositiva');
    expect([r.status, r.body.message]).toEqual([400, 'Indique el ejercicio']);
    const otro = await otroUsuario(app, prisma, x.empresaId, ['informes.ver']);
    expect((await otro.http.get(`/api/bienes-uso/planilla-impositiva?ejercicioId=${x.ej.id}`)).status).toBe(403);
  });

  it('el tope de automóviles se guarda en la configuración de impuestos', async () => {
    const x = await escenario();
    const c = (await x.http.get('/api/impuestos/config')).body;
    expect(Number(c.topeAutomovilesCosto)).toBe(20000);
    const n = (k: string) => Number(c[k]);
    const body = { ...c, ivaSaldoTecnicoInicial: n('ivaSaldoTecnicoInicial'), ivaSaldoLibreInicial: n('ivaSaldoLibreInicial'), prorrateoGravadasIniciales: n('prorrateoGravadasIniciales'), prorrateoExentasIniciales: n('prorrateoExentasIniciales') };
    expect((await x.http.put('/api/impuestos/config', { ...body, topeAutomovilesCosto: 25000000 })).status).toBe(200);
    expect(Number((await x.http.get('/api/impuestos/config')).body.topeAutomovilesCosto)).toBe(25000000);
    expect((await x.http.put('/api/impuestos/config', { ...body, topeAutomovilesCosto: -1 })).status).toBe(400);
  });

  it('revisión: la amortización inicial de un bien cargado por saldo inicial no es gasto del ejercicio', async () => {
    const x = await escenario();
    const rubro = await x.rubro('Muebles y útiles');
    await prisma.bienUso.create({ data: { empresaId: x.empresaId, numero: 950, descripcion: 'Estantería', rubroId: rubro.id, fechaAlta: new Date('2015-06-01'), valorOrigen: 100000, vidaUtilMeses: 120, origen: 'INICIAL', creadoPor: 't', amortizacionInicial: 80000, fechaAmortizacionInicial: new Date('2026-03-31') } });
    const p = await x.datos();
    expect(p.filas[0].bienes[0].contable).toBe('0.00');
  });
});
