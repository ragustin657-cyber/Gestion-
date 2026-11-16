import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: asiento de la liquidación', () => {
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
    const crear = async (tipo: string, anio: number, mes: number) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-28` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const novedades = (l: string, empleadoId: string) => s.http.put(`/api/sueldos/liquidaciones/${l}/novedades`, { empleadoId, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    const cerrar = (l: string) => s.http.post(`/api/sueldos/liquidaciones/${l}/cerrar`);
    const ver = async (l: string) => (await s.http.get(`/api/sueldos/liquidaciones/${l}`)).body;
    /** Renglones del asiento: [código, centro, debe, haber]. */
    const renglones = async (asientoId: string) => {
      const rs = await prisma.asientoRenglon.findMany({ where: { asientoId } });
      const cod = new Map((await prisma.cuentaContable.findMany({ where: { id: { in: rs.map((r) => r.cuentaContableId) } } })).map((c) => [c.id, c.codigo]));
      return rs.map((r) => [cod.get(r.cuentaContableId)!, r.centroCostoId, r.debe.toFixed(2), r.haber.toFixed(2)] as [string, string | null, string, string]).sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])));
    };
    return { ...s, crear, novedades, cerrar, ver, renglones };
  };

  it('asiento del ejemplo', async () => {
    const x = await escenario();
    const e = await x.empleado();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.novedades(l.id, e.id);
    expect((await x.ver(l.id)).contribuciones.total).toBe('311015.06');
    expect((await x.cerrar(l.id)).status).toBe(201);
    const v = await x.ver(l.id);
    expect(v.asiento.numero).toBeGreaterThan(0);
    expect(v.contribuciones.total).toBe('311015.06');
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: v.asiento.id } });
    expect(a.fecha.toISOString().slice(0, 10)).toBe('2026-11-30');
    expect(a.descripcion).toBe('Liquidación de sueldos 11/2026');
    expect(await x.renglones(a.id)).toEqual([
      ['2.1.03.001', null, '0.00', '941016.82'],
      ['2.1.03.002', null, '0.00', '509739.11'],
      ['2.1.03.003', null, '0.00', '29224.13'],
      ['5.2.09', null, '1168965.00', '0.00'],
      ['5.2.10', null, '311015.06', '0.00'],
    ]);
  });

  it('centros de costo', async () => {
    const x = await escenario();
    const ros = (await x.http.post('/api/centros-costo', { codigo: 'ROS', nombre: 'Rosario' })).body.id as string;
    const cba = (await x.http.post('/api/centros-costo', { codigo: 'CBA', nombre: 'Córdoba' })).body.id as string;
    await x.empleado({ centroCostoId: ros });
    await x.empleado({ centroCostoId: cba });
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    const rs = await x.renglones((await x.ver(l.id)).asiento.id);
    expect(rs.filter((r) => r[0] === '5.2.09').map((r) => r[1]).sort()).toEqual([ros, cba].sort());
    expect(rs.filter((r) => r[0] === '5.2.10')).toHaveLength(2);
    expect(rs.filter((r) => r[0].startsWith('2.')).every((r) => r[1] === null)).toBe(true);
    const suma = (i: 2 | 3) => rs.reduce((s, r) => s + Number(r[i]), 0).toFixed(2);
    expect(suma(2)).toBe(suma(3));
  });

  it('cerrar con mes contable cerrado', async () => {
    const x = await escenario();
    await x.empleado();
    const l = await x.crear('MENSUAL', 2026, 11);
    await prisma.periodoContable.updateMany({ where: { empresaId: x.empresaId, anio: 2026, mes: 11 }, data: { estado: 'CERRADO' } });
    const r = await x.cerrar(l.id);
    expect(r.status).toBe(400);
    const v = await x.ver(l.id);
    expect(v.estado).toBe('BORRADOR');
    expect(v.recibos[0].numero).toBeNull();
    expect(await prisma.talonario.findFirst({ where: { empresaId: x.empresaId, tipoComprobante: 'RECIBO_SUELDO', ultimoNumero: { gt: 0 } } })).toBeNull();
  });

  it('reabrir', async () => {
    const x = await escenario();
    await x.empleado();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    const asiento = (await x.ver(l.id)).asiento.id as string;
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/reabrir`)).status).toBe(201);
    expect(await prisma.asiento.count({ where: { anulaAId: asiento } })).toBe(1);
    const v = await x.ver(l.id);
    expect(v.asiento).toBeNull();
    expect(await prisma.reciboSueldoContribucion.count({ where: { empresaId: x.empresaId } })).toBe(0);
    await x.cerrar(l.id);
    expect((await x.ver(l.id)).asiento.id).not.toBe(asiento);
  });

  it('contabilizar cerradas sin asiento', async () => {
    const x = await escenario();
    await x.empleado();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    await prisma.liquidacion.update({ where: { id: l.id }, data: { asientoId: null } });
    await prisma.reciboSueldoContribucion.deleteMany({ where: { empresaId: x.empresaId } });
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/contabilizar`)).status).toBe(201);
    expect((await x.ver(l.id)).asiento).not.toBeNull();
    const r = await x.http.post(`/api/sueldos/liquidaciones/${l.id}/contabilizar`);
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación ya está contabilizada']);
  });

  it('SAC', async () => {
    const x = await escenario();
    const e = await x.empleado();
    const m = await x.crear('MENSUAL', 2026, 11);
    await x.novedades(m.id, e.id);
    await x.cerrar(m.id);
    const sac = await x.crear('SAC', 2026, 12);
    expect((await x.cerrar(sac.id)).status).toBe(201);
    const v = await x.ver(sac.id);
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: v.asiento.id } });
    expect(a.fecha.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(a.descripcion).toBe('SAC 2.º semestre 2026');
    const codigos = (await prisma.reciboSueldoContribucion.findMany({ where: { reciboId: v.recibos[0].id } })).map((c) => c.codigo);
    expect(codigos).not.toContain('SCVO');
    expect(v.contribuciones.porDestino.ART).toBe('14612.06');
  });
});
