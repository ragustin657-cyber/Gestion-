import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAMPOS_F931 } from '../src/sueldos/f931-diseno';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

function textoPdf(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) partes.push(Buffer.from([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join(''), 'hex').toString('latin1'));
  return partes.join('\n');
}
function campo(linea: string, n: number): string {
  let pos = 0;
  for (const c of CAMPOS_F931) { if (c.numero === n) return linea.slice(pos, pos + c.largo); pos += c.largo; }
  throw new Error(`campo ${n}`);
}

describe('pulido 22: copias, convenio y textos', () => {
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
    const mensual = async () => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    const bin = (url: string) => s.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    return { ...s, e, mensual, bin };
  };

  it('forma de pago copiada', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    await x.http.put(`/api/sueldos/empleados/${x.e.id}`, { formaPago: 'EFECTIVO' });
    const t = textoPdf((await x.bin(`/api/sueldos/liquidaciones/${m.id}/recibos.pdf`)).body as Buffer);
    expect(t).toContain('Transferencia bancaria');
    expect(t).not.toContain('Forma de pago: Efectivo');
  });

  it('parámetros copiados', async () => {
    const x = await escenario();
    const m = await x.mensual();
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    const linea = async () => ((await x.bin('/api/sueldos/f931?anio=2026&mes=11')).body as Buffer).toString('latin1').split('\r\n')[0];
    const antes = campo(await linea(), 14);
    expect(antes).toBe('  1137465,00');
    await x.http.put('/api/sueldos/parametros', { anio: 2026, mes: 11, baseMaximaAportes: 500000, detraccion: 1000 });
    const despues = await linea();
    expect([campo(despues, 14), campo(despues, 58)]).toEqual([antes, '     7003,68']);
  });

  it('segundo convenio', async () => {
    const x = await escenario();
    const conv = (await x.http.post('/api/sueldos/convenios', { nombre: 'Otro convenio', codigo: 'OTRO', horasMensuales: 200 })).body as { id: string };
    await x.http.post('/api/sueldos/categorias', { convenioId: conv.id, nombre: 'Operario único', orden: 1 });
    await x.escala('Operario único', '2026-11', 800000);
    const otro = await x.empleado({ categoria: 'Operario único' });
    const m = await x.mensual();
    const recibos = (await x.http.get(`/api/sueldos/liquidaciones/${m.id}`)).body.recibos as { empleadoId: string; renglones: { codigo: string }[] }[];
    const codigos = (id: string) => recibos.find((r) => r.empleadoId === id)!.renglones.map((y) => y.codigo);
    for (const c of ['120', '530', '540']) {
      expect(codigos(otro.id)).not.toContain(c);
      expect(codigos(x.e.id)).toContain(c);
    }
  });

  it('asiento del pago de una final', async () => {
    const x = await escenario();
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' })).body as { id: string };
    await x.http.post(`/api/sueldos/liquidaciones/${f.id}/cerrar`);
    const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const ars = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002') })).body;
    await x.http.post(`/api/sueldos/liquidaciones/${f.id}/pagos`, { fecha: '2026-11-19', cuentaBancariaId: ars.id });
    const pago = await prisma.pagoSueldos.findFirstOrThrow({ where: { empresaId: x.empresaId } });
    expect((await prisma.asiento.findUniqueOrThrow({ where: { id: pago.asientoId! } })).descripcion).toBe('Pago de sueldos N° 1 - Final 11/2026 - Pérez, Juan 1');
  });
});
