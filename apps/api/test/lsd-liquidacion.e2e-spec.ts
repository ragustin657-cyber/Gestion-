import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAMPOS_F931 } from '../src/sueldos/f931-diseno';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

const CBU = '2850590940090418135201';

/** Valor del campo n de una línea del F.931, en centavos (para comparar con el Libro). */
function centavosF931(linea: string, n: number): string {
  let pos = 0;
  for (const c of CAMPOS_F931) { if (c.numero === n) return linea.slice(pos, pos + c.largo).trim().replace(',', '').padStart(15, '0'); pos += c.largo; }
  throw new Error(`campo ${n}`);
}

describe('LSD: archivo de la liquidación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (d: Record<string, unknown> = { cbu: CBU }) => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const e = await s.empleado(d);
    const empresa = await prisma.empresa.findUniqueOrThrow({ where: { id: s.empresaId } });
    const crear = async (tipo: string, anio: number, mes: number) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-28` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const cerrar = async (id: string) => { const r = await s.http.post(`/api/sueldos/liquidaciones/${id}/cerrar`); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); };
    const bin = (url: string) => s.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const lsd = (id: string) => bin(`/api/sueldos/liquidaciones/${id}/lsd`);
    const lineas = (b: Buffer) => b.toString('latin1').split('\r\n').filter((x) => x);
    const de = (ls: string[], tipo: string) => ls.filter((l) => l.startsWith(tipo));
    const r03 = (ls: string[], codigo: string) => de(ls, '03').find((l) => l.slice(13, 23).trim() === codigo);
    return { ...s, e, empresa, crear, cerrar, bin, lsd, lineas, de, r03 };
  };

  it('mensual', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    const r = await x.lsd(l.id);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain(`LSD-${x.empresa.cuit.replace(/-/g, '')}-202611-1.txt`);
    const ls = x.lineas(r.body as Buffer);
    const [l01] = ls;
    expect(l01).toHaveLength(35);
    expect([l01.slice(0, 2), l01.slice(2, 13), l01.slice(13, 22), l01.slice(22, 29), l01.slice(29, 35)]).toEqual(['01', x.empresa.cuit.replace(/-/g, ''), 'SJ202611M', '0000130', '000001']);
    const [l02] = x.de(ls, '02');
    expect(l02).toHaveLength(115);
    expect([l02.slice(2, 13), l02.slice(73, 95), l02.slice(95, 98), l02.slice(98, 106), l02.slice(114)]).toEqual(['20172543597', CBU, '000', '20261128', '3']);
    const recibo = await prisma.reciboSueldo.findFirstOrThrow({ where: { liquidacionId: l.id }, include: { renglones: true } });
    expect(x.de(ls, '03')).toHaveLength(recibo.renglones.filter((y) => !y.importe.isZero()).length);
    expect(x.de(ls, '03').every((y) => y.length === 51)).toBe(true);
    expect(x.r03(ls, '100')!.slice(44)).toBe('C000000');
    expect(x.r03(ls, '500')!.slice(44, 45)).toBe('D');
    const [l04] = x.de(ls, '04');
    expect(l04).toHaveLength(370);
    const f931 = x.lineas((await x.bin('/api/sueldos/f931?anio=2026&mes=11')).body as Buffer)[0];
    expect([l04.slice(175, 190), l04.slice(340, 355), l04.slice(355, 370)]).toEqual([centavosF931(f931, 14), centavosF931(f931, 60), centavosF931(f931, 58)]);
    // Orden: 01, después 02, 03… y 04 del empleado
    expect(ls.map((y) => y.slice(0, 2))).toEqual(['01', '02', ...x.de(ls, '03').map(() => '03'), '04']);
  });

  it('ausencia y horas extra', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 10 }, { tipo: 'AUSENCIA_INJUSTIFICADA', cantidad: 1 }] });
    await x.cerrar(l.id);
    const ls = x.lineas((await x.lsd(l.id)).body as Buffer);
    expect(x.r03(ls, '130')!.slice(23, 29)).toBe('01000H');
    expect(x.r03(ls, '140')!.slice(44)).toBe('D000000');
  });

  it('SAC después de la mensual', async () => {
    const x = await escenario();
    await x.http.put('/api/sueldos/parametros', { anio: 2026, mes: 12, baseMaximaAportes: 1000000, detraccion: 7003.68 });
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    const m = await x.crear('MENSUAL', 2026, 12);
    await x.cerrar(m.id);
    const sac = await x.crear('SAC', 2026, 12);
    await x.cerrar(sac.id);
    const lm = x.lineas((await x.lsd(m.id)).body as Buffer);
    expect(lm[0].slice(22, 27)).toBe('00001');
    const r = await x.lsd(sac.id);
    const ls = x.lineas(r.body as Buffer);
    expect(ls[0].slice(22, 27)).toBe('00002');
    expect(x.de(ls, '04')[0].slice(47, 49)).toBe(x.de(lm, '04')[0].slice(47, 49));
    expect(x.de(ls, '04')[0].slice(47, 49)).not.toBe('00');
    expect(x.r03(ls, '200')!.slice(23, 29)).toMatch(/^\d{5}D$/);
  });

  it('final', async () => {
    const x = await escenario();
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' })).body as { id: string };
    await x.cerrar(f.id);
    const r = await x.lsd(f.id);
    expect(r.status).toBe(200);
    const ls = x.lineas(r.body as Buffer);
    expect(ls.every((y) => [35, 115, 51, 370].includes(y.length))).toBe(true);
    const recibo = await prisma.reciboSueldo.findFirstOrThrow({ where: { liquidacionId: f.id }, include: { renglones: true } });
    expect(x.r03(ls, '200')).toBeUndefined();
    expect(x.r03(ls, '201')!.slice(28, 29)).toBe('D');
    expect(x.r03(ls, '300')!.slice(28, 29)).toBe('A');
    const pre = recibo.renglones.find((y) => y.codigo === '310')!;
    expect(x.r03(ls, '310')!.slice(23, 29)).toBe(`${String(Number(pre.cantidad) * 30 * 100).padStart(5, '0')}D`);
    // Cantidad con decimales: centavos del renglón (Review Focus 3)
    const vac = recibo.renglones.find((y) => y.codigo === '330')!;
    expect(Number(vac.cantidad) % 1).not.toBe(0);
    expect(x.r03(ls, '330')!.slice(23, 28)).toBe(String(Math.round(Number(vac.cantidad) * 100)).padStart(5, '0'));
    expect(x.de(ls, '02')[0].slice(95, 98)).toBe(String(recibo.diasTrabajados).padStart(3, '0'));
  });

  it('número estable', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    const num = async () => x.lineas((await x.lsd(l.id)).body as Buffer)[0].slice(22, 27);
    expect(await num()).toBe('00001');
    expect(await num()).toBe('00001');
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/reabrir`)).status).toBe(201);
    await x.cerrar(l.id);
    expect(await num()).toBe('00001');
  });

  it('números simultáneos', async () => {
    const x = await escenario();
    await x.http.put('/api/sueldos/parametros', { anio: 2026, mes: 12, baseMaximaAportes: 1000000, detraccion: 7003.68 });
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    const m = await x.crear('MENSUAL', 2026, 12);
    await x.cerrar(m.id);
    const sac = await x.crear('SAC', 2026, 12);
    await x.cerrar(sac.id);
    const rs = await Promise.all([x.lsd(m.id), x.lsd(sac.id)]);
    expect(rs.map((r) => x.lineas(r.body as Buffer)[0].slice(22, 27)).sort()).toEqual(['00001', '00002']);
  });

  it('fijar número', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    expect((await x.http.put(`/api/sueldos/liquidaciones/${l.id}/numero-lsd`, { numero: 5 })).status).toBe(200);
    expect(x.lineas((await x.lsd(l.id)).body as Buffer)[0].slice(22, 27)).toBe('00005');
    // Revisión: se puede cambiar después (ARCA ya tenía ese número), siempre hacia arriba de las demás del período
    expect((await x.http.put(`/api/sueldos/liquidaciones/${l.id}/numero-lsd`, { numero: 7 })).status).toBe(200);
    expect(x.lineas((await x.lsd(l.id)).body as Buffer)[0].slice(22, 27)).toBe('00007');
  });

  it('revisión: el número fijado supera al de las demás liquidaciones del período', async () => {
    const x = await escenario();
    await x.http.put('/api/sueldos/parametros', { anio: 2026, mes: 12, baseMaximaAportes: 1000000, detraccion: 7003.68 });
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    const m = await x.crear('MENSUAL', 2026, 12);
    await x.cerrar(m.id);
    const sac = await x.crear('SAC', 2026, 12);
    await x.cerrar(sac.id);
    expect((await x.http.put(`/api/sueldos/liquidaciones/${m.id}/numero-lsd`, { numero: 5 })).status).toBe(200);
    const r = await x.http.put(`/api/sueldos/liquidaciones/${sac.id}/numero-lsd`, { numero: 3 });
    expect([r.status, r.body.message]).toEqual([400, 'El número del Libro debe ser mayor que 5, el último del período']);
    expect((await x.http.put(`/api/sueldos/liquidaciones/${sac.id}/numero-lsd`, { numero: 6 })).status).toBe(200);
  });

  it('revisión: fijar el número mientras se descarga no cambia el número del archivo', async () => {
    const x = await escenario();
    await x.http.put('/api/sueldos/parametros', { anio: 2026, mes: 12, baseMaximaAportes: 1000000, detraccion: 7003.68 });
    const ids: string[] = [];
    for (const [tipo, mes] of [['MENSUAL', 11], ['MENSUAL', 12], ['SAC', 12]] as const) { const l = await x.crear(tipo, 2026, mes); await x.cerrar(l.id); ids.push(l.id); }
    for (const [i, id] of ids.entries()) {
      const l = { id };
      const [d, p] = await Promise.all([x.lsd(l.id), x.http.put(`/api/sueldos/liquidaciones/${l.id}/numero-lsd`, { numero: 20 + i * 10 })]);
      const enArchivo = Number(x.lineas(d.body as Buffer)[0].slice(22, 27));
      const guardado = (await prisma.liquidacion.findUniqueOrThrow({ where: { id: l.id } })).numeroLsd;
      // O el PUT ganó (archivo y base con 9), o la descarga ganó y el PUT fijó 9 > 1 después: nunca el archivo con un número y la base con otro sin que el PUT lo informe
      // El PUT solo puede ganar o fijarse después si lo informa con 200; si respondió 400, la base conserva el número del archivo
      if (p.status === 200) expect(guardado).toBe(20 + i * 10);
      else expect(guardado).toBe(enArchivo);
      expect([200, 400]).toContain(p.status);
    }
  });

  it('no cerrada', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    const r = await x.http.get(`/api/sueldos/liquidaciones/${l.id}/lsd`);
    expect([r.status, r.body.message]).toEqual([400, 'Solo se descarga el Libro de una liquidación cerrada']);
  });

  it('sin CBU', async () => {
    const x = await escenario({});
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' })).body as { id: string };
    await x.cerrar(f.id);
    const r = await x.http.get(`/api/sueldos/liquidaciones/${f.id}/lsd`);
    expect([r.status, r.body.message]).toEqual([400, 'Pérez, Juan 1: falta el CBU (22 dígitos) para la acreditación en cuenta']);
  });

  it('revisión: informa todos los empleados sin CBU juntos', async () => {
    const x = await escenario({});
    await x.empleado({});
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    const r = await x.http.get(`/api/sueldos/liquidaciones/${l.id}/lsd`);
    expect([r.status, r.body.message]).toEqual([400, 'Pérez, Juan 1; Pérez, Juan 2: falta el CBU (22 dígitos) para la acreditación en cuenta']);
    // Un 400 no gasta número
    expect((await prisma.liquidacion.findUniqueOrThrow({ where: { id: l.id } })).numeroLsd).toBeNull();
  });

  it('permisos', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(l.id);
    const u = await otroUsuario(app, prisma, x.empresaId, ['venta.ver']);
    expect((await u.http.get(`/api/sueldos/liquidaciones/${l.id}/lsd`)).status).toBe(403);
    const v = await otroUsuario(app, prisma, x.empresaId, ['sueldos.ver']);
    expect((await v.http.get(`/api/sueldos/liquidaciones/${l.id}/lsd`)).status).toBe(200);
    expect((await v.http.put(`/api/sueldos/liquidaciones/${l.id}/numero-lsd`, { numero: 3 })).status).toBe(403);
  });
});
