import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };
const NUMERO = '26001IC04012345K';

describe('despachos de importación (E41)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await sesionConPlan(app, prisma);
    const datos = (o: Record<string, unknown> = {}) => ({
      numeroDespacho: NUMERO, fechaEmision: '2026-10-15', fechaContable: '2026-10-15',
      renglones: [{ base: 100000, alicuotaIva: 21 }, { base: 50000, alicuotaIva: 10.5 }],
      percepcionIva: 3000, percepcionGanancias: 6000, percepcionesIibb: [{ jurisdiccion: '902', importe: 2500 }], derechosImportacion: 8000, tasaEstadistica: 2000,
      totalDeclarado: 47750, ...o,
    });
    const despacho = (o: Record<string, unknown> = {}) => s.http.post('/api/compras/despachos', datos(o));
    const asiento = async (id: string) => {
      const a = await prisma.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
      const r: Record<string, [string, string]> = {};
      for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toFixed(2), x.haber.toFixed(2)];
      return r;
    };
    return { ...s, despacho, datos, asiento };
  };

  it('carga el despacho: IVA por alícuota, deuda = lo liquidado y asiento de los tributos', async () => {
    const x = await escenario();
    const r = await x.despacho();
    expect(r.status).toBe(201);
    expect([r.body.tipo, r.body.numeroDespacho, r.body.iva, r.body.total, r.body.netoGravado]).toEqual(['DESPACHO_IMPORTACION', NUMERO, '26250', '47750', '150000']);
    const aduana = await prisma.tercero.findFirstOrThrow({ where: { empresaId: x.empresaId, cuit: '33693450239' } });
    expect([aduana.razonSocial, aduana.esProveedor, aduana.condicionIva, aduana.exentoGanancias]).toEqual(['Dirección General de Aduanas', true, 'EXENTO', true]);
    expect(r.body.terceroId).toBe(aduana.id);
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    expect(mov.importe.toFixed(2)).toBe('47750.00');
    const c = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(await x.asiento(c.asientoId!)).toEqual({
      '1.1.03.001': ['26250.00', '0.00'], '1.1.03.002': ['3000.00', '0.00'], '1.1.03.012': ['6000.00', '0.00'], '1.1.03.003': ['2500.00', '0.00'],
      '5.1.02': ['10000.00', '0.00'], '2.1.01.001': ['0.00', '47750.00'],
    });
    // El segundo despacho reusa la Aduana
    expect((await x.despacho({ numeroDespacho: '26001IC04012346L' })).status).toBe(201);
    expect(await prisma.tercero.count({ where: { empresaId: x.empresaId, cuit: '33693450239' } })).toBe(1);
  });

  it('solo IVA', async () => {
    const x = await escenario();
    const r = await x.despacho({ renglones: [{ base: 10000, alicuotaIva: 21 }], percepcionIva: 0, percepcionGanancias: 0, percepcionesIibb: [], derechosImportacion: 0, tasaEstadistica: 0, totalDeclarado: 2100 });
    expect([r.status, r.body.total]).toEqual([201, '2100']);
  });

  it('validaciones', async () => {
    const x = await escenario();
    expect((await x.despacho({ numeroDespacho: '123' })).body.message).toBe('El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)');
    expect((await x.despacho({ letra: 'A' })).body.message).toBe('El despacho no lleva letra ni número de comprobante');
    expect((await x.despacho({ totalDeclarado: 50000 })).status).toBe(400);
    expect((await x.despacho()).status).toBe(201);
    const rep = await x.despacho();
    expect([rep.status, rep.body.message]).toEqual([400, `Ya existe el despacho ${NUMERO}`]);
  });

  it('Aduana existente inactiva: se rechaza sin modificarla', async () => {
    const x = await escenario();
    await prisma.tercero.create({ data: { empresaId: x.empresaId, codigo: 900, razonSocial: 'DGA', cuit: '33693450239', condicionIva: 'EXENTO', esProveedor: true, activo: false } });
    const r = await x.despacho();
    expect([r.status, r.body.message]).toEqual([400, 'El tercero con el CUIT de la Aduana (DGA) no es un proveedor activo: actívelo o márquelo como proveedor']);
  });

  it('con la posición de IVA del mes cerrada no se carga ni se anula', async () => {
    const x = await escenario();
    const r = await x.despacho();
    await x.http.put('/api/impuestos/config', { ...CONFIG, ivaInicioAnio: 2026, ivaInicioMes: 10 });
    expect((await x.http.post('/api/impuestos/posicion-iva/2026/10/cerrar')).status).toBe(201);
    const MSG = 'La posición de IVA de 10/2026 está cerrada: use una fecha de un mes abierto o reabra la posición';
    expect((await x.despacho({ numeroDespacho: '26001IC04012346L' })).body.message).toBe(MSG);
    const an = await x.http.post(`/api/compras/comprobantes/${r.body.id}/anular`, { motivo: 'Error' });
    expect([an.status, an.body.message]).toEqual([400, MSG]);
  });

  it('la orden de pago a la Aduana no lleva retenciones', async () => {
    const x = await escenario();
    const r = await x.despacho({ fechaEmision: '2026-11-02', fechaContable: '2026-11-02' });
    await prisma.empresa.update({ where: { id: x.empresaId }, data: { agenteRetencionGanancias: true, jurisdiccionesIibb: ['902'] } });
    await prisma.tercero.update({ where: { id: r.body.terceroId }, data: { regimenGanancias: '78', exentoGanancias: false } });
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    const op = await x.http.post('/api/pagos/ordenes', { terceroId: r.body.terceroId, fecha: '2026-11-06', imputaciones: [{ movimientoId: mov.id, importe: 47750 }] });
    expect(op.status).toBe(201);
    const ret = await x.http.get(`/api/pagos/ordenes/${op.body.id}/retenciones?fechaPago=2026-11-15`);
    expect(ret.status).toBe(200);
    expect([ret.body.retenciones, ret.body.totalRetenciones]).toEqual([[], '0.00']);
  });
});
