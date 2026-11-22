import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };
type Detalle = { jurisdiccion: string; recaudaciones: string; aPagar: string; saldoAFavor: string };

describe('recaudaciones bancarias SIRCREB (E48)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    await v.http.put('/api/impuestos/config', { ...CONFIG, iibbInicioAnio: 2026, iibbInicioMes: 10 });
    await v.http.put('/api/impuestos/iibb/jurisdicciones?anio=2026', { jurisdicciones: [{ jurisdiccion: '902', coeficiente: 1, alicuota: 4, actividad: '620100' }] });
    const ver = async () => (await v.http.get('/api/impuestos/iibb/posicion?anio=2026&mes=10')).body as { detalle: Detalle[]; totales: Record<string, string>; avisos: string[]; asientoId: string | null };
    const alta = (o: Record<string, unknown> = {}) => v.http.post('/api/impuestos/recaudaciones-bancarias', { periodo: '202610', jurisdiccion: '902', importe: 2000, ...o });
    return { ...v, ver, alta };
  };

  it('la liquidación de IIBB resta la recaudación y el asiento cancela la cuenta 1.1.03.003', async () => {
    const x = await escenario();
    expect((await x.alta()).status).toBe(201);
    let p = await x.ver();
    expect([p.detalle[0].recaudaciones, p.detalle[0].saldoAFavor, p.totales.recaudaciones]).toEqual(['2000.00', '2000.00', '2000.00']);
    expect((await x.alta({ jurisdiccion: '913', importe: 100 })).status).toBe(201);
    p = await x.ver();
    expect(p.avisos.some((a) => a.includes('Chubut') || a.includes('913'))).toBe(true);
    expect((await x.http.post('/api/impuestos/iibb/posicion/2026/10/cerrar')).status).toBe(201);
    const pos = await prisma.posicionIibb.findFirstOrThrow({ where: { anio: 2026, mes: 10 } });
    const rs = await prisma.asientoRenglon.findMany({ where: { asientoId: pos.asientoId! } });
    const cuenta = await x.cuenta('1.1.03.003');
    expect(rs.filter((r) => r.cuentaContableId === cuenta).map((r) => r.haber.toFixed(2))).toEqual(['2000.00']);
  });

  it('importación: actualiza las filas repetidas; línea mala con su número', async () => {
    const x = await escenario();
    expect((await x.http.post('/api/impuestos/recaudaciones-bancarias/importar', { texto: 'periodo;jurisdiccion;importe\n202610;902;1500,50\n' })).status).toBe(201);
    expect((await x.http.post('/api/impuestos/recaudaciones-bancarias/importar', { texto: '202610;902;1700\n' })).status).toBe(201);
    const l = (await x.http.get('/api/impuestos/recaudaciones-bancarias?periodo=202610')).body as { jurisdiccion: string; importe: string; nombre: string }[];
    expect(l.map((r) => [r.jurisdiccion, r.importe, r.nombre])).toEqual([['902', '1700.00', 'Buenos Aires']]);
    const mala = await x.http.post('/api/impuestos/recaudaciones-bancarias/importar', { texto: '202610;902;1\n202610;999;5\n' });
    expect([mala.status, mala.body.message]).toEqual([400, 'Línea 2 inválida: jurisdicción']);
  });

  it('con la liquidación del período cerrada no se modifica; 404 y permisos', async () => {
    const x = await escenario();
    const a = await x.alta();
    expect((await x.http.post('/api/impuestos/iibb/posicion/2026/10/cerrar')).status).toBe(201);
    const msg = 'La liquidación de IIBB de 10/2026 está cerrada';
    for (const q of [() => x.alta({ jurisdiccion: '901' }), () => x.http.put(`/api/impuestos/recaudaciones-bancarias/${a.body.id}`, { periodo: '202610', jurisdiccion: '902', importe: 1 }),
      () => x.http.delete(`/api/impuestos/recaudaciones-bancarias/${a.body.id}`), () => x.http.post('/api/impuestos/recaudaciones-bancarias/importar', { texto: '202610;902;1\n' })]) {
      const r = await q();
      expect([r.status, r.body.message]).toEqual([400, msg]);
    }
    const r = await x.http.delete('/api/impuestos/recaudaciones-bancarias/00000000-0000-0000-0000-000000000000');
    expect([r.status, r.body.message]).toEqual([404, 'Recaudación no encontrada']);
    const otro = await otroUsuario(app, prisma, x.empresaId, ['bienes.ver']);
    expect((await otro.http.get('/api/impuestos/recaudaciones-bancarias?periodo=202610')).status).toBe(403);
  });
});
