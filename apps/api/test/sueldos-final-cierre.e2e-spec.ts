import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAMPOS_F931 } from '../src/sueldos/f931-diseno';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

function campo(linea: string, n: number): string {
  let pos = 0;
  for (const c of CAMPOS_F931) { if (c.numero === n) return linea.slice(pos, pos + c.largo); pos += c.largo; }
  throw new Error(`campo ${n}`);
}
function textoPdf(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) partes.push(Buffer.from([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join(''), 'hex').toString('latin1'));
  return partes.join('\n');
}

describe('sueldos: cierre de la liquidación final', () => {
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
    const e = await s.empleado();
    const f = (await s.http.post('/api/sueldos/egresos', { empleadoId: e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' })).body as { id: string };
    const cerrar = () => s.http.post(`/api/sueldos/liquidaciones/${f.id}/cerrar`);
    const bin = (url: string) => s.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    return { ...s, e, f, cerrar, bin };
  };

  it('cierre de la final', async () => {
    const x = await escenario();
    expect((await x.cerrar()).status).toBe(201);
    const l = await prisma.liquidacion.findUniqueOrThrow({ where: { id: x.f.id } });
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: l.asientoId! } });
    expect(a.fecha.toISOString().slice(0, 10)).toBe('2026-11-15');
    expect(a.descripcion).toBe('Liquidación final - Pérez, Juan 1 - Despido sin causa');
    const rs = await prisma.asientoRenglon.findMany({ where: { asientoId: a.id } });
    const cod = new Map((await prisma.cuentaContable.findMany({ where: { id: { in: rs.map((r) => r.cuentaContableId) } } })).map((c) => [c.id, c.codigo]));
    const debe = (c: string) => rs.filter((r) => cod.get(r.cuentaContableId) === c).reduce((s, r) => s + Number(r.debe), 0).toFixed(2);
    expect(debe('5.2.11')).toBe('10810067.44');
    expect(debe('5.2.09')).toBe('995281.88');
    expect(rs.reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0).toFixed(2)).toBe('0.00');
    const sipa = await prisma.reciboSueldoContribucion.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: 'SIPA' } });
    expect(sipa.base.toFixed(2)).toBe('988278.20');
  });

  it('pago de la final', async () => {
    const x = await escenario();
    await x.cerrar();
    const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const ars = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002') })).body;
    expect((await x.http.post(`/api/sueldos/liquidaciones/${x.f.id}/pagos`, { fecha: '2026-11-19', cuentaBancariaId: ars.id })).status).toBe(201);
    const m = await prisma.movimientoTesoreria.findFirstOrThrow({ where: { empresaId: x.empresaId, origenTipo: 'PAGO_SUELDOS' } });
    expect(m.importe.toFixed(2)).toBe('11611269.34');
  });

  it('F.931 con la final', async () => {
    const x = await escenario();
    await x.cerrar();
    const r = await x.bin('/api/sueldos/f931?anio=2026&mes=11');
    expect(r.status).toBe(200);
    const linea = (r.body as Buffer).toString('latin1').split('\r\n')[0];
    expect(linea).toHaveLength(499);
    expect(campo(linea, 13)).toBe('   995281,88');
    expect(campo(linea, 37)).toBe('   426549,38');
    expect(campo(linea, 51)).toBe('        0,00');
    await x.empleado({ categoria: 'Vendedor B' });
    await x.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' });
    const r2 = await x.bin('/api/sueldos/f931?anio=2026&mes=11');
    expect([r2.status, JSON.parse((r2.body as Buffer).toString()).message]).toEqual([400, 'La liquidación mensual de 11/2026 no está cerrada']);
  });

  it('recibo de la final', async () => {
    const x = await escenario();
    await x.cerrar();
    const t = textoPdf((await x.bin(`/api/sueldos/liquidaciones/${x.f.id}/recibos.pdf`)).body as Buffer);
    for (const s of ['LIQUIDACIÓN FINAL', 'Despido sin causa', '15/11/2026', 'Indemnización por antigüedad', 'Final 11/2026']) expect(t).toContain(s);
  });
});
