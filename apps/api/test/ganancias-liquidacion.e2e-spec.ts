import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { retencionGanancias } from '../src/sueldos/ganancias/calculo';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';
import { f572, TABLA_PRUEBA } from './helpers-ganancias';

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
interface Renglon { codigo: string; clase: string; importe: string }
interface Recibo { id: string; empleadoId: string; totalRemunerativo: string; totalNoRemunerativo: string; totalDescuentos: string; neto: string; renglones: Renglon[]; hojaGanancias: Record<string, string> & { retenidoAnterior: string; bruta: string } | null }

describe('ganancias: retención en la liquidación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (o: { agente?: boolean; tabla?: boolean } = {}) => {
    const s = await prepararSueldos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionGanancias: o.agente ?? true } });
    for (const mes of ['2026-10', '2026-11', '2026-12']) await s.escala('Vendedor B', mes, 30000000);
    await s.http.put('/api/sueldos/parametros', { anio: 2026, mes: 12, baseMaximaAportes: 5000000, detraccion: 7003.68 });
    if (o.tabla ?? true) expect((await s.http.put('/api/sueldos/ganancias/tablas/2026/2', TABLA_PRUEBA)).status).toBe(200);
    const e = await s.empleado();
    const crear = async (tipo: string, anio: number, mes: number, fechaPago = `${anio}-${String(mes).padStart(2, '0')}-28`) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const cerrar = (id: string) => s.http.post(`/api/sueldos/liquidaciones/${id}/cerrar`);
    const recibo = async (id: string) => ((await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body.recibos as Recibo[])[0];
    const ganancias = (r: Recibo) => r.renglones.find((x) => x.codigo === '560');
    const aportes = (r: Recibo) => r.renglones.filter((x) => ['500', '510', '520', '530', '540'].includes(x.codigo)).reduce((t, x) => t.plus(x.importe), D(0));
    const tablaCalc = () => {
      const t = TABLA_PRUEBA;
      return { gni: D(t.gni), deduccionEspecial: D(t.deduccionEspecial), conyuge: D(t.conyuge), hijo: D(t.hijo), hijoIncapacitado: D(t.hijoIncapacitado), topeHipotecario: D(t.topes.hipotecario), topeSeguroMuerte: D(t.topes.seguroMuerte), topeSeguroMixto: D(t.topes.seguroMixto), topeSeguroRetiro: D(t.topes.seguroRetiro), topeSepelio: D(t.topes.sepelio), tramos: t.tramos.map((x) => ({ desde: D(x.desde), hasta: x.hasta === null ? null : D(x.hasta), fijo: D(x.fijo), porcentaje: D(x.porcentaje) })) };
    };
    const importar = (xml: string) => request(app.getHttpServer()).post('/api/sueldos/ganancias/f572/importar').set('Authorization', `Bearer ${s.token}`).attach('archivos', Buffer.from(xml, 'utf8'), 'f572.xml');
    return { ...s, e, crear, cerrar, recibo, ganancias, aportes, tablaCalc, importar };
  };

  it('renglón, neto y hoja', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    const r = await x.recibo(l.id);
    const bruta = D(r.totalRemunerativo).plus(r.totalNoRemunerativo);
    const esperado = retencionGanancias({ mes: 11, tabla: x.tablaCalc(), bruta, aportes: x.aportes(r), deducciones: [], cargas: [], retenidoAnterior: D(0), retenidoEmpresa: D(0), brutaRecibo: bruta });
    expect(esperado.importe.gt(0)).toBe(true);
    expect(x.ganancias(r)!.importe).toBe(esperado.importe.toFixed(2));
    expect(D(r.neto).toFixed(2)).toBe(bruta.minus(r.totalDescuentos).toFixed(2));
    expect(D(r.totalDescuentos).toFixed(2)).toBe(x.aportes(r).plus(esperado.importe).toFixed(2));
    expect(r.hojaGanancias!.importe).toBe(esperado.importe.toFixed(2));
  });

  it('sin tabla', async () => {
    const x = await escenario({ tabla: false });
    const l = await x.crear('MENSUAL', 2026, 11);
    const g = (await x.http.get(`/api/sueldos/liquidaciones/${l.id}`)).body;
    expect(g.errores.map((e: { mensaje: string }) => e.mensaje)).toContain('Cargue la tabla de Ganancias de 2.º semestre 2026');
    expect((await x.cerrar(l.id)).status).toBe(400);
  });

  it('empresa no agente', async () => {
    const x = await escenario({ agente: false });
    const l = await x.crear('MENSUAL', 2026, 11);
    const r = await x.recibo(l.id);
    expect([x.ganancias(r), r.hojaGanancias]).toEqual([undefined, null]);
  });

  it('acumula liquidaciones cerradas y devuelve hasta lo retenido por la empresa', async () => {
    const x = await escenario();
    const oct = await x.crear('MENSUAL', 2026, 10);
    expect((await x.cerrar(oct.id)).status).toBe(201);
    const retOct = (x.ganancias(await x.recibo(oct.id))!).importe;
    const nov = await x.crear('MENSUAL', 2026, 11);
    expect((await x.recibo(nov.id)).hojaGanancias!.retenidoAnterior).toBe(retOct);
    // Otro empleador retuvo mucho: corresponde devolver, pero solo lo que retuvo esta empresa
    const xml = f572().replace('<retGan>1000.00</retGan>', '<retGan>50000000.00</retGan>');
    expect((await x.importar(xml)).body.importados.length).toBe(1);
    await x.http.post(`/api/sueldos/liquidaciones/${nov.id}/recalcular`);
    expect(x.ganancias(await x.recibo(nov.id))!.importe).toBe(D(retOct).neg().toFixed(2));
  });

  it('acumulado previo', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    const sin = (await x.recibo(l.id)).hojaGanancias!;
    await x.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2026`, { bruta: 1000000, aportes: 170000, retenido: 5000 });
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/recalcular`);
    const con = (await x.recibo(l.id)).hojaGanancias!;
    expect(D(con.bruta).minus(sin.bruta).toFixed(2)).toBe('1000000.00');
    expect(D(con.aportes).minus(sin.aportes).toFixed(2)).toBe('170000.00');
    expect(con.retenidoAnterior).toBe('5000.00');
  });

  it('mensual y SAC con la misma fecha de pago', async () => {
    const x = await escenario();
    const m = await x.crear('MENSUAL', 2026, 12, '2026-12-18');
    expect((await x.cerrar(m.id)).status).toBe(201);
    const retM = x.ganancias(await x.recibo(m.id))!.importe;
    const sac = await x.crear('SAC', 2026, 12, '2026-12-18');
    expect((await x.cerrar(sac.id)).status).toBe(201);
    const rs = await x.recibo(sac.id);
    expect(rs.hojaGanancias!.retenidoAnterior).toBe(retM);
    expect(D(retM).plus(x.ganancias(rs)?.importe ?? 0).toFixed(2)).toBe(D(rs.hojaGanancias!.impuesto).minus(rs.hojaGanancias!.noRetenido).toFixed(2));
  });

  it('cierre fuera de orden', async () => {
    const x = await escenario();
    const dic = await x.crear('MENSUAL', 2026, 12, '2026-12-20');
    expect((await x.cerrar(dic.id)).status).toBe(201);
    const numero = (await prisma.liquidacion.findUniqueOrThrow({ where: { id: dic.id } })).numero;
    const nov = await x.crear('MENSUAL', 2026, 11, '2026-12-05');
    const r = await x.cerrar(nov.id);
    expect([r.status, r.body.message]).toEqual([400, `Hay una liquidación cerrada con fecha de pago posterior (N° ${numero}): ciérrelas en orden de fecha de pago`]);
  });

  it('cierre fuera de orden sin retención posterior no bloquea', async () => {
    const x = await escenario();
    // Sueldo bajo: la liquidación posterior no retuvo nada, así que no hay nada que retener dos veces
    for (const mes of ['2026-11', '2026-12']) await x.escala('Vendedor B', mes, 300000);
    const dic = await x.crear('MENSUAL', 2026, 12, '2026-12-20');
    expect((await x.cerrar(dic.id)).status).toBe(201);
    expect(x.ganancias(await x.recibo(dic.id))).toBeUndefined();
    const nov = await x.crear('MENSUAL', 2026, 11, '2026-12-05');
    expect((await x.cerrar(nov.id)).status).toBe(201);
  });

  it('reabrir con posteriores cerradas avisa', async () => {
    const x = await escenario();
    const nov = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(nov.id);
    const dic = await x.crear('MENSUAL', 2026, 12);
    await x.cerrar(dic.id);
    const r = await x.http.post(`/api/sueldos/liquidaciones/${nov.id}/reabrir`);
    expect(r.status).toBe(201);
    expect(r.body.aviso).toContain('Hay liquidaciones posteriores cerradas: su retención de Ganancias no se recalcula');
  });

  it('F.572 nuevo recalcula el borrador', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    const antes = D(x.ganancias(await x.recibo(l.id))!.importe);
    const alquiler = '<deduccion tipo="22"><nroDoc>1</nroDoc><denominacion>DUENO</denominacion><periodos><periodo mesDesde="1" mesHasta="11" montoMensual="500000.00"/></periodos></deduccion>';
    await x.importar(f572({ extra: alquiler }));
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/recalcular`);
    const r = await x.recibo(l.id);
    expect(D(x.ganancias(r)?.importe ?? 0).lt(antes)).toBe(true);
    expect((r.hojaGanancias as unknown as { personales: { cargas: string } }).personales.cargas).not.toBe('0.00');
  });

  it('concepto exento', async () => {
    const x = await escenario();
    const c = await x.http.post('/api/sueldos/conceptos', { codigo: '900', nombre: 'Viático exento', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: { importe: 500000 }, orden: 900, exentoGanancias: true });
    expect(c.status).toBe(201);
    const l = await x.crear('MENSUAL', 2026, 11);
    const r = await x.recibo(l.id);
    expect(r.renglones.some((y) => y.codigo === '900')).toBe(true);
    expect(r.hojaGanancias!.bruta).toBe(D(r.totalRemunerativo).plus(r.totalNoRemunerativo).minus(500000).toFixed(2));
  });

  it('asiento y Libro', async () => {
    const x = await escenario();
    await prisma.empleado.update({ where: { id: x.e.id }, data: { cbu: '2850590940090418135201' } });
    const l = await x.crear('MENSUAL', 2026, 11);
    expect((await x.cerrar(l.id)).status).toBe(201);
    const ret = x.ganancias(await x.recibo(l.id))!.importe;
    const liq = await prisma.liquidacion.findUniqueOrThrow({ where: { id: l.id } });
    const cuenta = await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '2.1.02.002' } });
    const rs = await prisma.asientoRenglon.findMany({ where: { asientoId: liq.asientoId!, cuentaContableId: cuenta.id } });
    expect(rs.reduce((t, y) => t.plus(y.haber), D(0)).toFixed(2)).toBe(ret);
    const lsd = await x.http.get(`/api/sueldos/liquidaciones/${l.id}/lsd`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (b: Buffer) => p.push(b)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const linea = (lsd.body as Buffer).toString('latin1').split('\r\n').find((y) => y.startsWith('03') && y.slice(13, 23).trim() === '560');
    expect(linea!.slice(44, 45)).toBe('D');
  });

  it('hoja en PDF', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    const r = await x.recibo(l.id);
    const pdf = await x.http.get(`/api/sueldos/liquidaciones/${l.id}/recibos/${r.id}/ganancias.pdf`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (b: Buffer) => p.push(b)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('aviso de conceptos viejos', async () => {
    const x = await escenario();
    await x.http.post('/api/sueldos/conceptos', { codigo: '901', nombre: 'Ganancias 4ta', clase: 'DESCUENTO', tipo: 'FIJO', parametros: { importe: 0 }, orden: 901 });
    const avisos = (await x.http.get('/api/sueldos/conceptos/avisos')).body as string[];
    expect(avisos.some((a) => a.includes('901 Ganancias 4ta'))).toBe(true);
  });
});
