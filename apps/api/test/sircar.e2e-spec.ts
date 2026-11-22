import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';
import { prepararVentas } from './helpers-ventas';

let numero = 9500;
const jur = (jurisdiccion: string, o: Record<string, unknown> = {}) => ({ jurisdiccion, alicuotaDefecto: 0, minimoRetencion: 0, usaPadron: false, sinPadron: 'ALICUOTA_DEFECTO', percibe: false, alicuotaPercepcionDefecto: 0, minimoPercepcion: 0, sinPadronPercepcion: 'NO_RETENER', ...o });

describe('SIRCAR (E48)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const herramientas = (s: { http: { post: (u: string, b: object) => Promise<{ status: number; body: Record<string, unknown> }> }; token: string }) => {
    const generar = (tipo: string, periodo = '202611') => s.http.post('/api/impuestos/presentaciones', { tipo, periodo });
    const lineas = async (tipo: string, periodo = '202611') => {
      const g = await generar(tipo, periodo);
      if (g.status !== 201) return { g, ls: [] as string[] };
      const b = await request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${g.body.id}/archivo`).set('Authorization', `Bearer ${s.token}`).buffer(true)
        .parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
      return { g, ls: (b.body as Buffer).toString('latin1').split('\r\n').filter(Boolean) };
    };
    return { generar, lineas };
  };
  const config = async (http: { get: (u: string) => Promise<{ body: Record<string, unknown> }>; put: (u: string, b: object) => Promise<{ status: number }> }, jurisdiccionesSircar: string[]) => {
    const c = (await http.get('/api/impuestos/config')).body;
    return http.put('/api/impuestos/config', { ...c, jurisdiccionesSircar });
  };

  it('retenciones: solo las jurisdicciones adheridas, con su régimen; anulada después sigue en su mes', async () => {
    const s = await prepararPagos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { jurisdiccionesIibb: ['904', '902'] } });
    expect((await s.http.put('/api/pagos/config/jurisdicciones', [jur('904', { alicuotaDefecto: 2, regimenSircarRetencion: '011' }), jur('902', { alicuotaDefecto: 1 })])).status).toBe(200);
    expect((await config(s.http, ['904', '909'])).status).toBe(200);
    const f = await s.http.post('/api/compras/comprobantes', {
      terceroId: s.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS', totalDeclarado: 121000,
      renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: 100000, alicuotaIva: 21 }],
    });
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: f.body.id as string } });
    const op = await s.opAprobada([{ movimientoId: mov.id, importe: 121000 }]);
    const pago = await s.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: Number(op.netoPagar), cuentaBancariaId: s.ars.id }]);
    expect(pago.status).toBe(200);
    const ret = await prisma.ordenPagoRetencion.findFirstOrThrow({ where: { ordenPagoId: op.id, jurisdiccion: '904' } });
    const opDb = await prisma.ordenPago.findUniqueOrThrow({ where: { id: op.id }, include: { tercero: true } });
    const { lineas } = herramientas(s);
    const { g, ls } = await lineas('SIRCAR_RETENCIONES');
    expect(g.body.nombreArchivo).toMatch(/^SIRCAR-RETENCIONES_\d{11}_202611\.txt$/);
    expect(ls).toEqual([[
      '00001', 'OP', String(opDb.numero).padStart(12, '0'), opDb.tercero.cuit.replace(/\D/g, ''), opDb.fechaPago!.toISOString().slice(0, 10).split('-').reverse().join('/'),
      ret.base.toFixed(2), Number(ret.alicuota).toFixed(2), ret.importe.toFixed(2), '011', '904',
    ].join(',')]);
    // Anulada en diciembre: sigue en noviembre
    await prisma.ordenPagoRetencion.updateMany({ where: { ordenPagoId: op.id }, data: { anulada: true, anuladaEn: new Date('2026-12-05') } });
    expect((await lineas('SIRCAR_RETENCIONES')).ls).toHaveLength(1);
  });

  it('percepciones: factura positiva y nota de crédito negativa; régimen vacío → 000', async () => {
    const v = await prepararVentas(app, prisma);
    const cliente = await prisma.tercero.findUniqueOrThrow({ where: { id: v.clienteRI.id } });
    await v.http.put('/api/pagos/config/jurisdicciones', [jur('909', { usaPadron: true, sinPadron: 'NO_RETENER', percibe: true })]);
    await prisma.padronIibb.create({ data: { jurisdiccion: '909', cuit: cliente.cuit, vigenciaDesde: new Date('2026-11-01'), vigenciaHasta: new Date('2026-11-30'), alicuotaPercepcion: 3 } });
    await config(v.http, ['909']);
    const fc = await v.factura();
    const nc = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, aplicarAAsociado: false, renglones: [{ descripcion: 'NC', cantidad: 1, precioUnitario: 500, alicuota: 21 }], emitir: true }));
    expect(nc.status).toBe(201);
    const { lineas } = herramientas(v);
    const { ls } = await lineas('SIRCAR_PERCEPCIONES');
    expect(ls).toHaveLength(2);
    const [a, b] = ls.map((l) => l.split(','));
    expect([a[0], a[1], a[5], a[6], a[7], a[8], a[9]]).toEqual(['00001', 'FA', '1000.00', '3.00', '30.00', '000', '909']);
    expect([b[0], b[1], b[5], b[7]]).toEqual(['00002', 'NC', '-500.00', '-15.00']);
    expect(a[2]).toHaveLength(12);
  });

  it('sin adheridas: error; sin movimientos: archivo vacío con aviso', async () => {
    const s = await prepararPagos(app, prisma);
    const { generar } = herramientas(s);
    const r = await generar('SIRCAR_RETENCIONES');
    expect([r.status, r.body.message]).toEqual([400, 'Configure las jurisdicciones adheridas a SIRCAR']);
    await config(s.http, ['904']);
    const g = await generar('SIRCAR_PERCEPCIONES');
    expect([g.status, g.body.registros, g.body.advertencias]).toEqual([201, 0, ['No hay percepciones de SIRCAR en 11/2026']]);
    expect((await config(s.http, ['999'])).status).toBe(400);
  });
});
