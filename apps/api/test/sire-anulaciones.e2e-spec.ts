import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';

let numero = 7000;
const pos = (l: string, desde: number, hasta: number) => l.slice(desde - 1, hasta);

describe('SIRE: anulaciones de retenciones ya presentadas (E43)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** OP con retención de IVA (50 %) y SUSS (6 %) de una factura de 100.000 + IVA, pagada. */
  const escenario = async () => {
    const s = await prepararPagos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionIva: true, agenteRetencionSuss: true } });
    const iva = await prisma.regimenIva.findFirstOrThrow({ where: { empresaId: s.empresaId, porcentaje: 50 } });
    const suss = await prisma.regimenSuss.findFirstOrThrow({ where: { empresaId: s.empresaId, descripcion: 'Limpieza de inmuebles' } });
    await prisma.regimenIva.update({ where: { id: iva.id }, data: { codigoSire: '499' } });
    await prisma.regimenSuss.update({ where: { id: suss.id }, data: { codigoSire: '755' } });
    await prisma.tercero.update({ where: { id: s.proveedorId }, data: { regimenIvaId: iva.id, regimenSussId: suss.id } });
    const r = await s.http.post('/api/compras/comprobantes', {
      terceroId: s.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 3, numero: ++numero, fechaEmision: '2026-10-02', fechaContable: '2026-10-02', monedaCodigo: 'ARS', totalDeclarado: 121000,
      renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: 100000, alicuotaIva: 21 }],
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    const op = await s.opAprobada([{ movimientoId: mov.id, importe: 121000 }]);
    const pago = await s.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: Number(op.netoPagar), cuentaBancariaId: s.ars.id }]);
    if (pago.status !== 200) throw new Error(JSON.stringify(pago.body));
    const rets = await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id }, orderBy: { impuesto: 'asc' } });
    const generar = (tipo: string, periodo: string) => s.http.post('/api/impuestos/presentaciones', { tipo, periodo });
    const lineas = async (tipo: string, periodo: string) => {
      const g = await generar(tipo, periodo);
      if (g.status !== 201) return { g, ls: [] as string[] };
      const b = await request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${g.body.id}/archivo`).set('Authorization', `Bearer ${s.token}`).buffer(true)
        .parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
      return { g, ls: (b.body as Buffer).toString('latin1').split('\r\n').filter(Boolean) };
    };
    const anular = () => s.http.post(`/api/pagos/ordenes/${op.id}/anular`, { version: pago.body.version, motivo: 'Error' });
    const opDb = await prisma.ordenPago.findUniqueOrThrow({ where: { id: op.id } });
    return { ...s, op: opDb, rets, generar, lineas, anular };
  };
  /** La OP se pagó en octubre (se corre la fecha en la base) y se anula hoy (noviembre, reloj de pruebas). */
  const pagadaEnOctubre = async (x: Awaited<ReturnType<typeof escenario>>) => {
    await prisma.ordenPago.update({ where: { id: x.op.id }, data: { fechaPago: new Date('2026-10-15') } });
  };

  it('anulada en un mes posterior: el SIRE del mes original no cambia y el de la anulación la informa', async () => {
    const x = await escenario();
    await pagadaEnOctubre(x);
    const antesIva = (await x.lineas('SIRE_IVA', '202610')).ls;
    const antesSuss = (await x.lineas('SIRE_SUSS', '202610')).ls;
    expect([antesIva.length, antesSuss.length]).toEqual([1, 1]);
    for (const r of x.rets) expect((await x.http.patch(`/api/pagos/retenciones/${r.id}/certificado-sire`, { certificadoSire: `SIRE-${r.impuesto}-1` })).status).toBe(200);
    expect((await x.anular()).status).toBe(200);
    const ret = await prisma.ordenPagoRetencion.findFirstOrThrow({ where: { ordenPagoId: x.op.id, impuesto: 'IVA' } });
    expect(ret.anuladaEn?.toISOString().slice(0, 10)).toBe('2026-11-06');
    // Regenerar octubre da lo mismo
    expect((await x.lineas('SIRE_IVA', '202610')).ls).toEqual(antesIva);
    expect((await x.lineas('SIRE_SUSS', '202610')).ls).toEqual(antesSuss);
    // Noviembre: anulación de IVA en su archivo y NC de SUSS
    const { g, ls } = await x.lineas('SIRE_IVA_ANULACIONES', '202611');
    expect(g.body.nombreArchivo).toMatch(/^SIRE-F2005-ANULACIONES_\d{11}_202611\.txt$/);
    expect(ls).toHaveLength(1);
    const [a] = ls;
    expect(a).toHaveLength(305);
    expect([pos(a, 1, 4), pos(a, 41, 43), pos(a, 256, 280).trimEnd(), pos(a, 305, 305)]).toEqual(['0100', '216', 'SIRE-IVA-1', '1']);
    expect((await x.lineas('SIRE_IVA', '202611')).ls).toEqual([]);
    const nc = (await x.lineas('SIRE_SUSS', '202611')).ls;
    expect(nc).toHaveLength(1);
    const [n] = nc;
    expect([pos(n, 47, 56), pos(n, 57, 58), pos(n, 59, 68), pos(n, 69, 84).trimEnd(), pos(n, 99, 112), pos(n, 113, 137).trim(), pos(n, 138, 147), pos(n, 148, 161)])
      .toEqual(['06/11/2026', '03', '06/11/2026', `00001-${String(x.op.numero).padStart(8, '0')}`, '00000006000.00', 'SIRE-SUSS-1', '15/10/2026', '00000006000.00']);
  });

  it('sin el certificado SIRE no se informa la anulación', async () => {
    const x = await escenario();
    await pagadaEnOctubre(x);
    await x.anular();
    const r = await x.generar('SIRE_IVA_ANULACIONES', '202611');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/^Cargue el número de certificado SIRE de la retención \d+ \(.+\) para informar su anulación$/);
  });

  it('pagada y anulada el mismo mes: no se informa en ningún archivo', async () => {
    const x = await escenario();
    await x.anular();
    expect((await x.lineas('SIRE_IVA', '202611')).ls).toEqual([]);
    expect((await x.lineas('SIRE_IVA_ANULACIONES', '202611')).ls).toEqual([]);
    expect((await x.lineas('SIRE_SUSS', '202611')).ls).toEqual([]);
  });

  it('anuladas antes de esta entrega (sin fecha de anulación): no se informan', async () => {
    const x = await escenario();
    await pagadaEnOctubre(x);
    await x.anular();
    await prisma.ordenPagoRetencion.updateMany({ where: { ordenPagoId: x.op.id }, data: { anuladaEn: null } });
    expect((await x.lineas('SIRE_IVA_ANULACIONES', '202611')).ls).toEqual([]);
    expect((await x.lineas('SIRE_IVA', '202610')).ls).toEqual([]);
  });

  it('el certificado SIRE se valida', async () => {
    const x = await escenario();
    const r = await x.http.patch(`/api/pagos/retenciones/${x.rets[0].id}/certificado-sire`, { certificadoSire: 'X'.repeat(26) });
    expect(r.status).toBe(400);
  });
});
