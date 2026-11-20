import { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('percepciones en ventas: libros y archivos (E39)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Noviembre: factura A 1.000 + IVA con percepción IIBB 902 (3 % → 30), 901 (2 % → 20) e IVA (3 % → 30); NC de 500 que revierte la mitad. */
  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const cliente = await prisma.tercero.findUniqueOrThrow({ where: { id: v.clienteRI.id } });
    const j = (jurisdiccion: string) => ({ jurisdiccion, alicuotaDefecto: 0, minimoRetencion: 0, usaPadron: true, sinPadron: 'NO_RETENER', percibe: true, alicuotaPercepcionDefecto: 0, minimoPercepcion: 0, sinPadronPercepcion: 'NO_RETENER' });
    await v.http.put('/api/pagos/config/jurisdicciones', [j('901'), j('902')]);
    for (const [jur, a] of [['902', 3], ['901', 2]] as const)
      await prisma.padronIibb.create({ data: { jurisdiccion: jur, cuit: cliente.cuit, vigenciaDesde: new Date('2026-11-01'), vigenciaHasta: new Date('2026-11-30'), alicuotaPercepcion: a } });
    await v.http.patch('/api/empresas/actual', { agentePercepcionIva: true });
    await v.http.post('/api/pagos/config/regimenes-percepcion-iva', { codigo: '493', descripcion: 'RG 2408', alicuotaGeneral: 3, alicuotaReducida: 1.5, minimoNeto: 0 });
    const fc = await v.factura();
    const nc = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, aplicarAAsociado: false, renglones: [{ descripcion: 'NC', cantidad: 1, precioUnitario: 500, alicuota: 21 }], emitir: true }));
    if (nc.status !== 201) throw new Error(JSON.stringify(nc.body));
    const generar = (tipo: string, periodo = '202611', quincena?: number) => v.http.post('/api/impuestos/presentaciones', { tipo, periodo, quincena });
    const bajar = (id: string) => request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${id}/archivo`).set('Authorization', `Bearer ${v.token}`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    return { ...v, cliente, fc, generar, bajar };
  };

  it('Libro IVA Ventas: columnas de percepciones y el total con ellas', async () => {
    const x = await escenario();
    const l = (await x.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body as { filas: Record<string, string>[]; totales: Record<string, string> };
    expect([l.filas[0].percepcionesIibb, l.filas[0].percepcionesIva, l.filas[0].total]).toEqual(['50.00', '30.00', '1290.00']);
    expect([l.filas[1].percepcionesIibb, l.filas[1].percepcionesIva]).toEqual(['-25.00', '-15.00']);
    expect([l.totales.percepcionesIibb, l.totales.percepcionesIva]).toEqual(['25.00', '15.00']);
    const xlsx = await x.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30&formato=xlsx');
    expect(xlsx.status).toBe(200);
  });

  it('Libro IVA Digital: percepciones nacionales y de IIBB en ventas', async () => {
    const x = await escenario();
    const g = (await x.generar('LIBRO_IVA_DIGITAL')).body;
    const p = await prisma.presentacion.findUniqueOrThrow({ where: { id: g.id } });
    const zip = await JSZip.loadAsync(Buffer.from(p.contenido));
    const [l] = Buffer.from(await zip.file('VENTAS_CBTE.txt')!.async('uint8array')).toString('latin1').split('\r\n');
    expect([l.slice(108, 123), l.slice(168, 183), l.slice(183, 198)]).toEqual(['000000000129000', '000000000003000', '000000000005000']);
  });

  it('ARBA percepciones: lote propio con la factura y la NC en negativo', async () => {
    const x = await escenario();
    const g = await x.generar('ARBA_PERCEPCIONES');
    expect(g.status).toBe(201);
    expect(g.body.nombreArchivo).toBe('AR-30712345671-2026110-7-LOTE00001.zip');
    const zip = await JSZip.loadAsync((await x.bajar(g.body.id)).body as Buffer);
    const lineas = Buffer.from(await zip.file('AR-30712345671-2026110-7-LOTE00001.txt')!.async('uint8array')).toString('latin1').split('\r\n').filter(Boolean);
    expect(lineas).toHaveLength(2);
    const [f, n] = lineas;
    expect(f).toHaveLength(61);
    expect([f.slice(0, 13), f.slice(13, 23), f.slice(23, 24), f.slice(24, 25), f.slice(25, 29), f.slice(29, 37), f.slice(37, 49), f.slice(49, 60), f.slice(60)])
      .toEqual(['20-17254359-7', '02/11/2026', 'F', 'A', '0001', '00000001', '000001000.00', '00000030.00', 'A']);
    expect([n.slice(23, 24), n.slice(37, 49), n.slice(49, 60)]).toEqual(['C', '-00000500.00', '-0000015.00']);
    expect((await x.generar('ARBA_PERCEPCIONES')).body.nombreArchivo).toContain('LOTE00002');
    // El correlativo de retenciones no se movió
    expect(await prisma.talonario.findFirst({ where: { tipoComprobante: 'ARBA-LOTE' } })).toBeNull();
  });

  it('AGIP: percepciones de la factura (operación 2) y aviso por las notas de crédito', async () => {
    const x = await escenario();
    const sin = await x.generar('AGIP');
    expect([sin.status, sin.body.message]).toEqual([400, 'Complete la situación de Ingresos Brutos de: Distribuidora Norte SA']);
    await x.http.patch(`/api/terceros/${x.cliente.id}`, { situacionIibb: 'CONVENIO', numeroIibb: '9011234567' });
    const g = await x.generar('AGIP');
    expect(g.status).toBe(201);
    const lineas = ((await x.bajar(g.body.id)).body as Buffer).toString('latin1').split('\r\n').filter(Boolean);
    expect(lineas).toHaveLength(1);
    const [l] = lineas;
    expect([l.slice(0, 1), l.slice(14, 16), l.slice(16, 17), l.slice(183, 199)]).toEqual(['2', '01', 'A', '0000000000020,00']);
    expect(g.body.advertencias).toContain('Hay notas de crédito con percepciones de CABA: cárguelas en e-ARCIBA');
  });

  it('SIRE de IVA: aviso de percepciones e informe de percepciones practicadas', async () => {
    const x = await escenario();
    const g = await x.generar('SIRE_IVA');
    expect(g.status).toBe(201);
    expect(g.body.advertencias).toContain('Hay percepciones de IVA en 11/2026: cárguelas en el SIRE con el informe de percepciones practicadas');
    const r = (await x.http.get('/api/impuestos/percepciones-practicadas?desde=2026-11-01&hasta=2026-11-30&tipo=IVA')).body as { filas: { comprobante: string; importe: string }[]; total: string };
    expect(r.filas.map((f) => f.importe)).toEqual(['30.00', '-15.00']);
    expect(r.total).toBe('15.00');
    const xlsx = await x.http.get('/api/impuestos/percepciones-practicadas?desde=2026-11-01&hasta=2026-11-30&tipo=IIBB&formato=xlsx');
    expect(xlsx.status).toBe(200);
  });
});
