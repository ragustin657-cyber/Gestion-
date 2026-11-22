import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { descripcionRetencionOP, detalleExterior } from '../src/pagos/consultas/consultas-pagos.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';

let numero = 8000;
const ddmmaaaa = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const pos = (l: string, desde: number, hasta: number) => l.slice(desde - 1, hasta);
interface Ret { impuesto: string; importe: string; base: string; detalle: Record<string, unknown>; certificadoNumero: number | null }

describe('Ganancias a beneficiarios del exterior (E43)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Proveedor del exterior con régimen 31,5 % (código 100) y CDI 15 % (código 200); factura de 100.000 sin IVA. */
  const escenario = async (o: { cdi?: boolean; acrecentamiento?: boolean; sinRegimen?: boolean; conCdiEnRegimen?: boolean } = {}) => {
    const s = await prepararPagos(app, prisma);
    const reg = await s.http.post('/api/pagos/config/regimenes-exterior', {
      codigoSire: '160', descripcion: 'Honorarios del exterior', alicuotaSinCdi: 31.5, codigoAlicuotaSinCdi: 100,
      ...(o.conCdiEnRegimen === false ? {} : { alicuotaConCdi: 15, codigoAlicuotaConCdi: 200 }),
    });
    if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
    // También tiene régimen local de Ganancias, IIBB e IVA/SUSS: no deben aplicarse al exterior
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionGanancias: true, agenteRetencionIva: true, agenteRetencionSuss: true, jurisdiccionesIibb: ['902'] } });
    await prisma.tercero.update({
      where: { id: s.proveedorId },
      data: {
        residenteExterior: true, nif: 'US-123456789', paisSire: 212, domicilioExterior: '1 Main St, New York', tipoPersona: 'J',
        regimenExteriorId: o.sinRegimen ? null : reg.body.id, aplicaCdi: !!o.cdi, acrecentamiento: !!o.acrecentamiento, condicionIva: 'EXENTO',
      },
    });
    const factura = async (neto: number, moneda: 'ARS' | 'USD' = 'ARS', cotizacion?: number) => {
      const r = await s.http.post('/api/compras/comprobantes', {
        terceroId: s.proveedorId, tipo: 'FACTURA', letra: 'C', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-02', fechaContable: '2026-11-02',
        monedaCodigo: moneda, cotizacion: cotizacion ?? null, totalDeclarado: neto, renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: neto, alicuotaIva: 0 }],
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    };
    return { ...s, regimenId: reg.body.id as string, factura };
  };
  const rets = async (opId: string) => (await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: opId } })) as unknown as Ret[];

  it('retiene con la alícuota sin convenio; neto y asiento', async () => {
    const x = await escenario();
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    const rs = await rets(op.id);
    expect(rs.map((r) => [r.impuesto, Number(r.importe)])).toEqual([['GANANCIAS_EXTERIOR', 31500]]);
    expect(Number(op.netoPagar)).toBe(68500);
    const pago = await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 68500, cuentaBancariaId: x.ars.id }]);
    expect(pago.status).toBe(200);
    const a = await x.asiento(pago.body.asientoId);
    expect(a['2.1.02.002']).toEqual(['0', '31500']);
    expect((await rets(op.id))[0].certificadoNumero).toBe(1);
    expect(await prisma.talonario.findFirst({ where: { tipoComprobante: 'RET-GAN-EXT' } })).not.toBeNull();
  });

  it('con convenio usa la alícuota con CDI; sin ella en el régimen, error', async () => {
    const x = await escenario({ cdi: true });
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    expect(Number((await rets(op.id))[0].importe)).toBe(15000);
    const y = await escenario({ cdi: true, conCdiEnRegimen: false });
    const m2 = await y.factura(100000);
    const b = await y.http.post('/api/pagos/ordenes', { terceroId: y.proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: m2.id, importe: 100000 }] });
    const c = await y.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version });
    expect([c.status, c.body.message]).toEqual([400, 'El régimen Honorarios del exterior no tiene alícuota con convenio']);
  });

  it('con acrecentamiento: el proveedor cobra todo y la empresa asume el impuesto', async () => {
    const x = await escenario({ acrecentamiento: true });
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    expect(Number((await rets(op.id))[0].importe)).toBe(45985.4);
    expect(Number(op.netoPagar)).toBe(100000);
    const pago = await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 100000, cuentaBancariaId: x.ars.id }]);
    expect(pago.status).toBe(200);
    const a = await x.asiento(pago.body.asientoId);
    expect([a['2.1.02.002'], a['5.2.15']]).toEqual([['0', '45985.4'], ['45985.4', '0']]);
  });

  it('factura en dólares: base en pesos', async () => {
    const x = await escenario();
    const m = await x.factura(100, 'USD', 1000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100 }], { cotizacion: 1000 });
    const [r] = await rets(op.id);
    expect([Number(r.base), Number(r.importe)]).toEqual([100000, 31500]);
  });

  it('sin régimen: sin retención y con aviso', async () => {
    const x = await escenario({ sinRegimen: true });
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    const rs = await rets(op.id);
    expect(rs.every((r) => Number(r.importe) === 0)).toBe(true);
    expect(JSON.stringify(rs)).toContain('El proveedor del exterior');
  });

  it('el SICORE del mes no incluye la retención al exterior', async () => {
    const x = await escenario();
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 68500, cuentaBancariaId: x.ars.id }]);
    const g = await x.http.post('/api/impuestos/presentaciones', { tipo: 'SICORE', periodo: '202611' });
    expect(g.body.registros).toBe(0);
  });

  it('la ficha del tercero guarda los datos del exterior y el certificado sale como constancia', async () => {
    const x = await escenario();
    const r = await x.http.patch(`/api/terceros/${x.proveedorId}`, { residenteExterior: true, nif: 'DE-999', paisSire: 205, domicilioExterior: 'Berlín', tipoPersona: 'F', nacimientoPais: 205, nacimientoFecha: '1980-05-01', aplicaCdi: true, acrecentamiento: false });
    expect(r.status).toBe(200);
    const t = await prisma.tercero.findUniqueOrThrow({ where: { id: x.proveedorId } });
    expect([t.nif, t.paisSire, t.tipoPersona, t.nacimientoFecha?.toISOString().slice(0, 10)]).toEqual(['DE-999', 205, 'F', '1980-05-01']);
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    const pago = await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 85000, cuentaBancariaId: x.ars.id }]);
    expect(pago.status).toBe(200);
    const [ret] = await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id } });
    const pdf = await x.http.get(`/api/pagos/ordenes/${op.id}/certificados/${ret.id}/pdf`);
    expect(pdf.status).toBe(200);
  });

  it('retenciones practicadas: certificado RET-GAN-EXT, régimen y certificado SIRE; motivo de anulación configurable', async () => {
    const x = await escenario();
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 68500, cuentaBancariaId: x.ars.id }]);
    const [ret] = await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id } });
    await x.http.patch(`/api/pagos/retenciones/${ret.id}/certificado-sire`, { certificadoSire: 'ABC-1' });
    const l = await x.http.get('/api/pagos/retenciones?desde=2026-11-01&hasta=2026-11-30');
    expect(l.body.map((f: Record<string, unknown>) => [f.certificado, f.regimen, f.certificadoSire])).toEqual([['RET-GAN-EXT 00000001', 'Honorarios del exterior', 'ABC-1']]);
    const c = await x.http.get('/api/impuestos/config');
    expect(c.body.sireMotivoAnulacion).toBe(1);
    const n = (k: string) => Number(c.body[k]);
    c.body = { ...c.body, ivaSaldoTecnicoInicial: n('ivaSaldoTecnicoInicial'), ivaSaldoLibreInicial: n('ivaSaldoLibreInicial'), prorrateoGravadasIniciales: n('prorrateoGravadasIniciales'), prorrateoExentasIniciales: n('prorrateoExentasIniciales') };
    expect((await x.http.put('/api/impuestos/config', { ...c.body, sireMotivoAnulacion: 3 })).status).toBe(200);
    expect((await x.http.get('/api/impuestos/config')).body.sireMotivoAnulacion).toBe(3);
    expect((await x.http.put('/api/impuestos/config', { ...c.body, sireMotivoAnulacion: 10 })).status).toBe(400);
  });

  it('revisión: el PDF de la OP y la constancia describen la retención al exterior (no IIBB ni jurisdicción)', async () => {
    const x = await escenario({ cdi: true });
    const m = await x.factura(100000);
    const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
    const [r] = await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id } });
    expect(descripcionRetencionOP(r)).toBe('Ganancias exterior (régimen 160)');
    const reg = await prisma.regimenExterior.findUniqueOrThrow({ where: { id: x.regimenId } });
    expect(detalleExterior(reg, r.detalle)).toBe('Honorarios del exterior — régimen SIRE 160 — con convenio de doble imposición');
    expect(detalleExterior(reg, { ...(r.detalle as object), aplicaCdi: 'false', acrecentamiento: 'true' })).toBe('Honorarios del exterior — régimen SIRE 160 — con acrecentamiento (impuesto a cargo del pagador)');
  });

  describe('F.2003', () => {
    const lineas = async (x: Awaited<ReturnType<typeof escenario>>, periodo: string) => {
      const g = await x.http.post('/api/impuestos/presentaciones', { tipo: 'SIRE_GANANCIAS_EXTERIOR', periodo });
      if (g.status !== 201) return { g, ls: [] as string[] };
      const b = await request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${g.body.id}/archivo`).set('Authorization', `Bearer ${x.token}`).buffer(true)
        .parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
      return { g, ls: (b.body as Buffer).toString('latin1').split('\r\n').filter(Boolean) };
    };
    const pagada = async (x: Awaited<ReturnType<typeof escenario>>) => {
      const m = await x.factura(100000);
      const op = await x.opAprobada([{ movimientoId: m.id, importe: 100000 }]);
      const pago = await x.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: Number(op.netoPagar), cuentaBancariaId: x.ars.id }]);
      if (pago.status !== 200) throw new Error(JSON.stringify(pago.body));
      return { op: await prisma.ordenPago.findUniqueOrThrow({ where: { id: op.id } }), version: pago.body.version as number };
    };

    it('un registro de 415 posiciones por retención, con los datos del beneficiario', async () => {
      const x = await escenario({ cdi: true });
      await prisma.tercero.update({ where: { id: x.proveedorId }, data: { tipoPersona: 'F', nacimientoPais: 205, nacimientoFecha: new Date('1980-05-01') } });
      const { op } = await pagada(x);
      const { g, ls } = await lineas(x, '202611');
      expect(g.status).toBe(201);
      expect(g.body.nombreArchivo).toMatch(/^SIRE-F2003_\d{11}_202611\.txt$/);
      expect(ls).toHaveLength(1);
      const [l] = ls;
      expect(l).toHaveLength(415);
      const empresa = await prisma.empresa.findUniqueOrThrow({ where: { id: x.empresaId } });
      const cuit = empresa.cuit.replace(/\D/g, '');
      const t = await prisma.tercero.findUniqueOrThrow({ where: { id: x.proveedorId } });
      expect([
        pos(l, 1, 4), pos(l, 5, 8), pos(l, 9, 18).trim(), pos(l, 19, 29), pos(l, 30, 32), pos(l, 33, 35), pos(l, 36, 46), pos(l, 47, 56), pos(l, 57, 58),
        pos(l, 69, 84).trimEnd(), pos(l, 85, 98), pos(l, 113, 191).trim(), pos(l, 192, 192), pos(l, 223, 223), pos(l, 224, 227), pos(l, 228, 228),
        pos(l, 229, 278).trimEnd(), pos(l, 279, 338).trimEnd(), pos(l, 339, 398).trimEnd(), pos(l, 399, 401), pos(l, 402, 402), pos(l, 403, 405), pos(l, 406, 415),
      ]).toEqual([
        '2003', '0100', '00000001', cuit, '218', '160', cuit, ddmmaaaa(op.fechaPago!), '06',
        String(op.numero).padStart(8, '0'), '00000100000.00', '', '0', '1', '0200', '0',
        'US-123456789', t.razonSocial, '1 Main St, New York', '212', 'F', '205', '01/05/1980',
      ]);
      expect(pos(l, 59, 68)).toBe(ddmmaaaa(op.fecha));
      expect(Number(g.body.total)).toBe(15000);
    });

    it('faltan datos del exterior del proveedor: error', async () => {
      const x = await escenario();
      await pagada(x);
      await prisma.tercero.update({ where: { id: x.proveedorId }, data: { nif: null, tipoPersona: 'F' } });
      const { g } = await lineas(x, '202611');
      expect([g.status, g.body.message]).toEqual([400, `Complete los datos del exterior de: ${(await prisma.tercero.findUniqueOrThrow({ where: { id: x.proveedorId } })).razonSocial}`]);
    });

    it('anulada el mes siguiente: nota de crédito en el F.2003 de la anulación', async () => {
      const x = await escenario();
      const { op, version } = await pagada(x);
      await prisma.ordenPago.update({ where: { id: op.id }, data: { fechaPago: new Date('2026-10-15') } });
      const antes = (await lineas(x, '202610')).ls;
      expect(antes).toHaveLength(1);
      const [ret] = await prisma.ordenPagoRetencion.findMany({ where: { ordenPagoId: op.id } });
      expect((await x.http.patch(`/api/pagos/retenciones/${ret.id}/certificado-sire`, { certificadoSire: 'SIRE-EXT-1' })).status).toBe(200);
      expect((await x.http.post(`/api/pagos/ordenes/${op.id}/anular`, { version, motivo: 'Error' })).status).toBe(200);
      expect((await lineas(x, '202610')).ls).toEqual(antes);
      const { g, ls } = await lineas(x, '202611');
      expect(ls).toHaveLength(1);
      const [n] = ls;
      expect(n).toHaveLength(415);
      expect([pos(n, 47, 56), pos(n, 57, 58), pos(n, 59, 68), pos(n, 69, 84).trimEnd(), pos(n, 85, 98), pos(n, 113, 137).trim(), pos(n, 138, 147), pos(n, 148, 161), pos(n, 162, 191).trimEnd(), pos(n, 192, 192)])
        .toEqual(['06/11/2026', '03', '06/11/2026', `00001-${String(op.numero).padStart(8, '0')}`, '00000100000.00', 'SIRE-EXT-1', '15/10/2026', '00000031500.00', 'Anulacion de la orden de pago', '0']);
      expect(Number(g.body.total)).toBe(-31500);
    });
  });
});
