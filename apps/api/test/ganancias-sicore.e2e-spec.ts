import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { TABLA_PRUEBA } from './helpers-ganancias';
import { prepararSueldos } from './helpers-sueldos';

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
/** Importe SICORE (14 posiciones con coma decimal). */
const sicore = (x: Prisma.Decimal) => x.toFixed(2).replace('.', ',').padStart(14, '0');

describe('ganancias: retenciones de empleados en el SICORE', () => {
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
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionGanancias: true } });
    await s.escala('Vendedor B', '2026-11', 30000000);
    await s.http.put('/api/sueldos/ganancias/tablas/2026/2', TABLA_PRUEBA);
    const e = await s.empleado();
    const l = (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-28' })).body as { id: string };
    expect((await s.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`)).status).toBe(201);
    const recibo = await prisma.reciboSueldo.findFirstOrThrow({ where: { liquidacionId: l.id }, include: { renglones: true } });
    const ret = D(recibo.renglones.find((x) => x.codigo === '560')!.importe);
    const liq = await prisma.liquidacion.findUniqueOrThrow({ where: { id: l.id } });
    const lineas = async () => {
      const g = await s.http.post('/api/impuestos/presentaciones', { tipo: 'SICORE', periodo: '202611' });
      expect(g.status).toBe(201);
      const b = await request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${g.body.id}/archivo`).set('Authorization', `Bearer ${s.token}`).buffer(true)
        .parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
      return { g: g.body, ls: (b.body as Buffer).toString('latin1').split('\r\n').filter(Boolean) };
    };
    return { ...s, e, recibo, ret, liq, lineas };
  };

  it('línea por empleado', async () => {
    const x = await escenario();
    expect(x.ret.gt(0)).toBe(true);
    const { g, ls } = await x.lineas();
    expect(g.registros).toBe(1);
    const [l] = ls;
    expect(l).toHaveLength(145);
    expect([l.slice(0, 2), l.slice(2, 12), l.slice(44, 48), l.slice(48, 51), l.slice(51, 52), l.slice(66, 76), l.slice(79, 93), l.slice(109, 111)]).toEqual(['07', '28/11/2026', '0217', '160', '1', '28/11/2026', sicore(x.ret), '86']);
    expect(l.slice(111, 131).trimEnd()).toBe(x.recibo.cuil.replace(/\D/g, ''));
    expect(Number(l.slice(12, 28))).toBe(x.liq.numero);
    expect(D(g.total).toFixed(2)).toBe(x.ret.toFixed(2));
  });

  it('neto por empleado en el período', async () => {
    const x = await escenario();
    // Segunda liquidación cerrada del mismo empleado en el período (copia por prisma), con una devolución
    const { id: _l, numero, ...datosLiq } = x.liq;
    const l2 = await prisma.liquidacion.create({ data: { ...datosLiq, numero: numero + 1, tipo: 'SAC', fechaPago: new Date('2026-11-30T00:00:00Z') } as Prisma.LiquidacionUncheckedCreateInput });
    const { id: _r, renglones: _rs, ...datosRecibo } = x.recibo;
    const rf = await prisma.reciboSueldo.create({ data: { ...datosRecibo, liquidacionId: l2.id } as Prisma.ReciboSueldoUncheckedCreateInput });
    const c560 = await prisma.concepto.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '560' } });
    await prisma.reciboSueldoRenglon.deleteMany({ where: { reciboId: rf.id, codigo: { in: ['560', '561'] } } });
    await prisma.reciboSueldoRenglon.create({ data: { empresaId: x.empresaId, reciboId: rf.id, conceptoId: c560.id, codigo: '560', nombre: 'x', clase: 'DESCUENTO', importe: -30000, orden: 999 } });
    const { g, ls } = await x.lineas();
    expect(g.registros).toBe(1);
    expect(ls[0].slice(79, 93)).toBe(sicore(x.ret.minus(30000)));
    expect(ls[0].slice(2, 12)).toBe('30/11/2026');
  });

  it('misma fecha de pago: la de mayor número', async () => {
    const x = await escenario();
    const { id: _l, numero, ...datosLiq } = x.liq;
    const l2 = await prisma.liquidacion.create({ data: { ...datosLiq, numero: numero + 1, tipo: 'SAC' } as Prisma.LiquidacionUncheckedCreateInput });
    const { id: _r, renglones: _rs, ...datosRecibo } = x.recibo;
    const r2 = await prisma.reciboSueldo.create({ data: { ...datosRecibo, liquidacionId: l2.id } as Prisma.ReciboSueldoUncheckedCreateInput });
    const c560 = await prisma.concepto.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '560' } });
    await prisma.reciboSueldoRenglon.create({ data: { empresaId: x.empresaId, reciboId: r2.id, conceptoId: c560.id, codigo: '560', nombre: 'x', clase: 'DESCUENTO', importe: 1000, orden: 999 } });
    for (let i = 0; i < 3; i++) expect(Number((await x.lineas()).ls[0].slice(12, 28))).toBe(numero + 1);
  });

  it('devolución resta y ajuste anual suma', async () => {
    const x = await escenario();
    const c560 = await prisma.concepto.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '560' } });
    const c561 = await prisma.concepto.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '561' } });
    const renglon = (conceptoId: string, codigo: string, importe: number) => prisma.reciboSueldoRenglon.create({ data: { empresaId: x.empresaId, reciboId: x.recibo.id, conceptoId, codigo, nombre: 'x', clase: 'DESCUENTO', importe, orden: 999 } });
    await renglon(c561.id, '561', 1000);
    await renglon(c560.id, '560', -300);
    expect((await x.lineas()).ls[0].slice(79, 93)).toBe(sicore(x.ret.plus(700)));
    await renglon(c560.id, '560', -Number(x.ret) - 5000);
    const { g } = await x.lineas();
    expect(g.registros).toBe(0);
  });
});
