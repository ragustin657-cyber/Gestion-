import { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, sesionConPlan } from './helpers';

describe('presentaciones de retenciones: SICORE, ARBA y AGIP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  let numeroOp = 0;
  async function escenario() {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const proveedor = await prisma.tercero.findUniqueOrThrow({ where: { id: proveedorId } });
    const usuario = (await prisma.usuarioEmpresa.findFirstOrThrow({ where: { empresaId: s.empresaId } })).usuarioId;
    /** OP pagada con una retención (datos directos: el cálculo de retenciones ya se prueba en Pagos). */
    const retencion = async (o: { impuesto: 'GANANCIAS' | 'IIBB'; jurisdiccion?: string; regimen?: string; fechaPago: string; base: number; alicuota: string; importe: number; certificado: number; estado?: 'PAGADA' | 'ANULADA'; anulada?: boolean }) => {
      const op = await prisma.ordenPago.create({
        data: {
          empresaId: s.empresaId, numero: ++numeroOp, terceroId: proveedorId, fecha: new Date(`${o.fechaPago}T00:00:00Z`), estado: o.estado ?? 'PAGADA', fechaPago: new Date(`${o.fechaPago}T00:00:00Z`),
          totalCancelarPesos: o.base * 1.21, totalRetenciones: o.importe, netoPagar: o.base * 1.21 - o.importe, creadoPor: usuario,
        },
      });
      await prisma.ordenPagoRetencion.create({
        data: { empresaId: s.empresaId, ordenPagoId: op.id, impuesto: o.impuesto, jurisdiccion: o.jurisdiccion ?? null, regimen: o.regimen ?? null, base: o.base, alicuota: o.alicuota, importe: o.importe, detalle: {}, certificadoNumero: o.certificado, anulada: o.anulada ?? false },
      });
      return op;
    };
    const generar = (tipo: string, periodo: string, quincena?: number) => s.http.post('/api/impuestos/presentaciones', { tipo, periodo, quincena });
    const bajar = (id: string) =>
      request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${id}/archivo`).set('Authorization', `Bearer ${s.token}`).buffer(true).parse((res, cb) => {
        const p: Buffer[] = [];
        res.on('data', (c: Buffer) => p.push(c));
        res.on('end', () => cb(null, Buffer.concat(p)));
      });
    const lineas = async (id: string) => ((await bajar(id)).body as Buffer).toString('latin1').split('\r\n').filter(Boolean);
    return { s, proveedor, retencion, generar, bajar, lineas };
  }

  it('SICORE: registro de 145 posiciones, sin las anuladas', async () => {
    const { proveedor, retencion, generar, lineas } = await escenario();
    await retencion({ impuesto: 'GANANCIAS', regimen: '78', fechaPago: '2026-11-10', base: 10000, alicuota: '2', importe: 123.45, certificado: 1 });
    await retencion({ impuesto: 'GANANCIAS', regimen: '78', fechaPago: '2026-11-20', base: 20000, alicuota: '2', importe: 400, certificado: 2 });
    await retencion({ impuesto: 'GANANCIAS', regimen: '78', fechaPago: '2026-11-12', base: 5000, alicuota: '2', importe: 100, certificado: 3, estado: 'ANULADA', anulada: true });
    const g = await generar('SICORE', '202611');
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ nombreArchivo: 'SICORE_30712345671_202611.txt', registros: 2 });
    const [l] = await lineas(g.body.id);
    expect(l).toHaveLength(145);
    expect([l.slice(0, 2), l.slice(44, 48), l.slice(48, 51), l.slice(51, 52), l.slice(79, 93), l.slice(66, 76)]).toEqual(['06', '0217', '078', '1', '00000000123,45', '10/11/2026']);
    expect(l.slice(111, 131).trimEnd()).toBe(proveedor.cuit);
    const q = await generar('SICORE', '202611', 1);
    expect(q.body).toMatchObject({ nombreArchivo: 'SICORE_30712345671_202611_Q1.txt', registros: 1 });
    const vacio = await generar('SICORE', '202610');
    expect(vacio.status).toBe(201);
    expect(vacio.body.advertencias).toEqual(['No hay retenciones de Ganancias en 10/2026']);
  });

  it('ARBA: lote ZIP con nombre normado y correlativo', async () => {
    const { retencion, generar, bajar } = await escenario();
    await retencion({ impuesto: 'IIBB', jurisdiccion: '902', fechaPago: '2026-11-10', base: 10000, alicuota: '3', importe: 300, certificado: 7 });
    const g = await generar('ARBA', '202611');
    expect(g.status).toBe(201);
    expect(g.body.nombreArchivo).toMatch(/^ER-30712345671-2026110-6-LOTE00001\.zip$/);
    expect(g.body.advertencias).toContain('ARBA emite el comprobante de retención al procesar el lote (RN 22/25): entregue al proveedor el de ARBA.');
    const zip = await JSZip.loadAsync((await bajar(g.body.id)).body as Buffer);
    expect(Object.keys(zip.files)).toEqual(['ER-30712345671-2026110-6-LOTE00001.txt']);
    const [l] = Buffer.from(await zip.file('ER-30712345671-2026110-6-LOTE00001.txt')!.async('uint8array')).toString('latin1').split('\r\n');
    expect(l).toHaveLength(67);
    expect([l.slice(0, 20), l.slice(36, 46), l.slice(46, 51), l.slice(51, 67)]).toEqual(['00000000000000000007', '10/11/2026', '03.00', '0000000010000.00']);
    expect((await generar('ARBA', '202611')).body.nombreArchivo).toContain('LOTE00002');
  });

  it('AGIP: exige la situación de IIBB y genera 215 posiciones con la razón social recortada', async () => {
    const { s, proveedor, retencion, generar, lineas } = await escenario();
    await prisma.tercero.update({ where: { id: proveedor.id }, data: { razonSocial: 'Muñoz & Peña "La Única" Sociedad Anónima Comercial' } });
    await retencion({ impuesto: 'IIBB', jurisdiccion: '901', fechaPago: '2026-11-10', base: 10000, alicuota: '3', importe: 300, certificado: 5 });
    const sin = await generar('AGIP', '202611');
    expect(sin.status).toBe(400);
    expect(sin.body.message).toBe('Complete la situación de Ingresos Brutos de: Muñoz & Peña "La Única" Sociedad Anónima Comercial');
    await s.http.patch(`/api/terceros/${proveedor.id}`, { situacionIibb: 'CONVENIO', numeroIibb: '9011234567' });
    const g = await generar('AGIP', '202611');
    expect(g.status).toBe(201);
    const [l] = await lineas(g.body.id);
    expect(l).toHaveLength(215);
    expect([l.slice(87, 88), l.slice(88, 99), l.slice(100, 130), l.slice(183, 199)]).toEqual(['2', '09011234567', 'Munoz & Pena "La Unica" Socied', '0000000000300,00']);
    expect(g.body.advertencias.some((a: string) => a.includes('se recortó'))).toBe(true);
  });
});
