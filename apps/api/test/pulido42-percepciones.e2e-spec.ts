import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('pulido E42: percepciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('el alta del régimen de percepción de IVA espera el lock (un solo activo con altas simultáneas)', async () => {
    const s = await sesionConPlan(app, prisma);
    let soltar!: () => void;
    await new Promise<void>((ok) => {
      void prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `regimen-percepcion-iva:${s.empresaId}`);
        ok();
        await new Promise<void>((fin) => (soltar = fin));
      }, { timeout: 20000 });
    });
    let listo = false;
    const pedido = s.http.post('/api/pagos/config/regimenes-percepcion-iva', { codigo: '493', descripcion: 'RG 493', alicuotaGeneral: 3, alicuotaReducida: 1.5, minimoNeto: 0, activo: true }).then((r) => ((listo = true), r));
    await new Promise((ok) => setTimeout(ok, 600));
    expect(listo).toBe(false);
    soltar();
    expect((await pedido).status).toBe(201);
  });

  it('dos altas simultáneas de régimen de percepción de IVA activo: queda uno solo activo', async () => {
    const s = await sesionConPlan(app, prisma);
    const alta = (codigo: string) => s.http.post('/api/pagos/config/regimenes-percepcion-iva', { codigo, descripcion: `RG ${codigo}`, alicuotaGeneral: 3, alicuotaReducida: 1.5, minimoNeto: 0, activo: true });
    const rs = await Promise.all([alta('493'), alta('494'), alta('495')]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.regimenPercepcionIva.count({ where: { empresaId: s.empresaId, activo: true } })).toBe(1);
  });

  it('las percepciones del comprobante vienen en orden fijo (IIBB por jurisdicción, luego IVA por tramo)', async () => {
    const v = await prepararVentas(app, prisma);
    const cliente = await prisma.tercero.findUniqueOrThrow({ where: { id: v.clienteRI.id } });
    const j = (jurisdiccion: string) => ({ jurisdiccion, alicuotaDefecto: 0, minimoRetencion: 0, usaPadron: true, sinPadron: 'NO_RETENER', percibe: true, alicuotaPercepcionDefecto: 0, minimoPercepcion: 0, sinPadronPercepcion: 'NO_RETENER' });
    await v.http.put('/api/pagos/config/jurisdicciones', [j('902'), j('901')]);
    for (const jur of ['902', '901'])
      await prisma.padronIibb.create({ data: { jurisdiccion: jur, cuit: cliente.cuit, vigenciaDesde: new Date('2026-11-01'), vigenciaHasta: new Date('2026-11-30'), alicuotaPercepcion: 2 } });
    await v.http.patch('/api/empresas/actual', { agentePercepcionIva: true });
    await v.http.post('/api/pagos/config/regimenes-percepcion-iva', { codigo: '493', descripcion: 'RG 2408', alicuotaGeneral: 3, alicuotaReducida: 1.5, minimoNeto: 0 });
    const c = (await v.factura({ renglones: [{ descripcion: 'B', cantidad: 1, precioUnitario: 1000, alicuota: 10.5 }, { descripcion: 'A', cantidad: 1, precioUnitario: 1000, alicuota: 21 }] })) as unknown as { id: string };
    // El orden no puede depender de cómo se guardaron: se reordenan las filas en la base al revés antes de leer
    const filas = await prisma.comprobanteVentaPercepcion.findMany({ where: { comprobanteId: c.id } });
    await prisma.comprobanteVentaPercepcion.deleteMany({ where: { comprobanteId: c.id } });
    for (const f of [...filas].reverse()) await prisma.comprobanteVentaPercepcion.create({ data: { ...f, id: undefined } });
    const leido = (await v.http.get(`/api/ventas/comprobantes/${c.id}`)).body as { percepcionesDetalle: { tipo: string; jurisdiccion: string | null; tramo: string | null }[] };
    expect(leido.percepcionesDetalle.map((p) => `${p.tipo}${p.jurisdiccion ?? ''}${p.tramo ?? ''}`)).toEqual(['IIBB901', 'IIBB902', 'IVAGENERAL', 'IVAREDUCIDA']);
  });
});
