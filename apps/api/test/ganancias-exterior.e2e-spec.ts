import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';

let numero = 8000;
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
});
