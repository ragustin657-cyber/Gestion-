import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
interface Ret { impuesto: string; importe: string; base: string; comprobanteCompraId?: string | null }
let numero = 5000;
/** Texto de un PDF sin comprimir (como en contabilidad-libros). */
function textoPdf(pdf: Buffer): string {
  const partes: string[] = [];
  for (const m of pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) partes.push(Buffer.from([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join(''), 'hex').toString('latin1'));
  return partes.join('');
}

describe('retenciones de IVA y SUSS', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Empresa agente de IVA y SUSS; proveedor RI con IVA 50 % y SUSS 6 % (sin mínimos). */
  const escenario = async (o: { agente?: boolean } = {}) => {
    const s = await prepararPagos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionIva: o.agente ?? true, agenteRetencionSuss: o.agente ?? true } });
    const iva = await prisma.regimenIva.findFirstOrThrow({ where: { empresaId: s.empresaId, porcentaje: 50 } });
    const suss = await prisma.regimenSuss.findFirstOrThrow({ where: { empresaId: s.empresaId, descripcion: 'Limpieza de inmuebles' } });
    await prisma.tercero.update({ where: { id: s.proveedorId }, data: { regimenIvaId: iva.id, regimenSussId: suss.id } });
    const comprobante = async (d: { neto: number; tipo?: string; letra?: string | null; asociado?: string; moneda?: string; cotizacion?: number }) => {
      const letra = d.letra === undefined ? 'A' : d.letra;
      const conIva = letra === 'A' || letra === 'M';
      const total = conIva ? Math.round(d.neto * 121) / 100 : d.neto;
      const r = await s.http.post('/api/compras/comprobantes', {
        terceroId: s.proveedorId, tipo: d.tipo ?? 'FACTURA', letra, puntoVenta: 3, numero: ++numero,
        fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: d.moneda ?? 'ARS', cotizacion: d.cotizacion ?? null, totalDeclarado: total,
        comprobanteAsociadoId: d.asociado ?? null,
        renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: d.neto, alicuotaIva: conIva ? 21 : 0 }],
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
      return { id: r.body.id as string, movimientoId: mov.id, total, saldo: mov.saldo };
    };
    const retenciones = async (imputaciones: { movimientoId: string; importe: number | string }[]) => {
      const op = await s.opAprobada(imputaciones);
      return { op, rets: (await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id } })) as unknown as Ret[] };
    };
    return { ...s, iva, suss, comprobante, retenciones };
  };

  it('retiene IVA y SUSS por factura', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100000 });
    const b = await x.comprobante({ neto: 50000 });
    const { rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }, { movimientoId: b.movimientoId, importe: b.total }]);
    const de = (imp: string, c: string) => rets.find((r) => r.impuesto === imp && r.comprobanteCompraId === c)!;
    expect(D(de('IVA', a.id).importe).toFixed(2)).toBe('10500.00');
    expect(D(de('IVA', b.id).importe).toFixed(2)).toBe('5250.00');
    expect(D(de('SUSS', a.id).importe).toFixed(2)).toBe('6000.00');
    expect(D(de('SUSS', b.id).importe).toFixed(2)).toBe('3000.00');
  });

  it('sin agente no retiene', async () => {
    const x = await escenario({ agente: false });
    const a = await x.comprobante({ neto: 100000 });
    const { rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }]);
    expect(rets.filter((r) => ['IVA', 'SUSS'].includes(r.impuesto))).toEqual([]);
  });

  it('monotributo no retiene SUSS ni IVA', async () => {
    const x = await escenario();
    await prisma.tercero.update({ where: { id: x.proveedorId }, data: { condicionIva: 'MONOTRIBUTO' } });
    const a = await x.comprobante({ neto: 100000, letra: 'C' });
    const { rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }]);
    expect(rets.filter((r) => ['IVA', 'SUSS'].includes(r.impuesto))).toEqual([]);
  });

  it('exentoIva no retiene IVA', async () => {
    const x = await escenario();
    await prisma.tercero.update({ where: { id: x.proveedorId }, data: { exentoIva: true } });
    const a = await x.comprobante({ neto: 100000 });
    const { rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }]);
    expect(rets.map((r) => r.impuesto).filter((i) => ['IVA', 'SUSS'].includes(i))).toEqual(['SUSS']);
  });

  it('exclusión vigente a la mitad; vencida retiene completo', async () => {
    const x = await escenario();
    await prisma.tercero.update({ where: { id: x.proveedorId }, data: { exclusionIvaPorcentaje: 50, exclusionIvaHasta: new Date('2026-11-30T00:00:00Z') } });
    const a = await x.comprobante({ neto: 100000 });
    expect(D((await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }])).rets.find((r) => r.impuesto === 'IVA')!.importe).toFixed(2)).toBe('5250.00');
    await prisma.tercero.update({ where: { id: x.proveedorId }, data: { exclusionIvaHasta: new Date('2026-11-01T00:00:00Z') } });
    const b = await x.comprobante({ neto: 100000 });
    expect(D((await x.retenciones([{ movimientoId: b.movimientoId, importe: b.total }])).rets.find((r) => r.impuesto === 'IVA')!.importe).toFixed(2)).toBe('10500.00');
  });

  it('factura y nota de crédito en la misma OP', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100000 });
    const nc = await x.comprobante({ neto: 60000, tipo: 'NOTA_CREDITO', asociado: a.id });
    const { op, rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }, { movimientoId: nc.movimientoId, importe: Number(nc.saldo) }]);
    // Se pagan 40.000 + IVA: la base de IVA es 8.400 (50 % = 4.200) y la de SUSS 40.000 (6 % = 2.400)
    expect(rets.filter((r) => r.impuesto === 'IVA').map((r) => D(r.importe).toFixed(2))).toEqual(['4200.00']);
    expect(rets.filter((r) => r.impuesto === 'SUSS').map((r) => D(r.importe).toFixed(2))).toEqual(['2400.00']);
    expect(D(op.netoPagar).gt(0)).toBe(true);
  });

  it('pago parcial en dos OP', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100000 });
    const r1 = (await x.retenciones([{ movimientoId: a.movimientoId, importe: 50000 }])).rets.find((r) => r.impuesto === 'IVA')!;
    const r2 = (await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total - 50000 }])).rets.find((r) => r.impuesto === 'IVA')!;
    expect(D(r1.importe).plus(r2.importe).minus(10500).abs().lte(0.01)).toBe(true);
  });

  it('factura en dólares', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100, moneda: 'USD', cotizacion: 1000 });
    const { rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }]);
    // IVA USD 21 a la cotización de la OP (1000) → base 21.000, 50 % = 10.500
    expect(D(rets.find((r) => r.impuesto === 'IVA')!.importe).toFixed(2)).toBe('10500.00');
  });

  it('al pagar: constancia, asiento y consulta', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100000 });
    const b = await x.comprobante({ neto: 50000 });
    const { op } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }, { movimientoId: b.movimientoId, importe: b.total }]);
    const r = await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: Number(op.netoPagar), cuentaBancariaId: x.ars.id }]);
    expect(r.status).toBe(200);
    const rets = await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id, impuesto: { in: ['IVA', 'SUSS'] } }, orderBy: [{ impuesto: 'asc' }, { certificadoNumero: 'asc' }] });
    expect(rets.map((y) => [y.impuesto, y.certificadoNumero])).toEqual([['IVA', 1], ['IVA', 2], ['SUSS', 1], ['SUSS', 2]]);
    const as = await x.asiento(r.body.asientoId);
    expect(as['2.1.02.003']).toEqual(['0', '15750']);
    expect(as['2.1.02.005']).toEqual(['0', '9000']);
    const pdf = await x.http.get(`/api/pagos/ordenes/${op.id}/certificados/${rets[0].id}/pdf`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const texto = textoPdf(pdf.body as Buffer);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(texto).toContain('CONSTANCIA DE RETENCIÓN DE IVA');
    expect(texto).toContain('El certificado oficial se emite en el SIRE de ARCA');
    const consulta = (await x.http.get('/api/pagos/retenciones?desde=2026-11-01&hasta=2026-11-30&impuesto=IVA')).body as { certificado: string }[];
    expect(consulta.map((y) => y.certificado)).toEqual(['RET-IVA 00000001', 'RET-IVA 00000002']);
  });

  it('anular la OP anula sus retenciones de IVA y SUSS', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100000 });
    const { op } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }]);
    const r = await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: Number(op.netoPagar), cuentaBancariaId: x.ars.id }]);
    expect((await x.http.post(`/api/pagos/ordenes/${op.id}/anular`, { version: r.body.version, motivo: 'Error' })).status).toBe(200);
    expect(await prisma.ordenPagoRetencion.count({ where: { ordenPagoId: op.id, impuesto: { in: ['IVA', 'SUSS'] }, anulada: false } })).toBe(0);
  });

  it('ticket no retiene', async () => {
    const x = await escenario();
    const a = await x.comprobante({ neto: 100000, tipo: 'TICKET', letra: null });
    const { rets } = await x.retenciones([{ movimientoId: a.movimientoId, importe: a.total }]);
    expect(rets.filter((r) => ['IVA', 'SUSS'].includes(r.impuesto))).toEqual([]);
  });
});
