import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Posicion {
  estado: string; totalCredito: string; saldoTecnicoAFavor: string; impuestoDeterminado: string; avisos: string[]; asientoId: string | null;
  coeficiente: string | null; creditoComun: string | null; creditoComputable: string | null; creditoNoComputable: string | null; ajusteProrrateo: string | null;
}
const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };

describe('prorrateo del crédito fiscal de IVA (E40)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  const base = async () => {
    const v = await prepararVentas(app, prisma);
    const { proveedorId } = await datosCompras(prisma, v.empresaId);
    const compra = async (neto: number, fecha: string, destino?: 'GRAVADO' | 'EXENTO' | 'COMUN', nc = false) => {
      const c = await facturaPendiente(v.http, prisma, { proveedorId, neto, fecha });
      if (destino || nc) await prisma.comprobanteCompra.update({ where: { id: c.comprobanteId }, data: { ...(destino ? { destinoCreditoIva: destino } : {}), ...(nc ? { tipo: 'NOTA_CREDITO' } : {}) } });
      return c.comprobanteId;
    };
    const venta = async (fecha: string, alicuota: number | 'EXENTO', precio = 1000) => {
      jest.setSystemTime(new Date(`${fecha}T15:00:00Z`));
      await v.factura({ fecha, renglones: [{ descripcion: 'V', cantidad: 1, precioUnitario: precio, alicuota }] });
      jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    };
    const config = (o: Record<string, unknown>) => v.http.put('/api/impuestos/config', { ...CONFIG, ...o });
    const ver = async (anio: number, mes: number) => (await v.http.get(`/api/impuestos/posicion-iva?anio=${anio}&mes=${mes}`)).body as Posicion;
    const cerrar = (anio: number, mes: number) => v.http.post(`/api/impuestos/posicion-iva/${anio}/${mes}/cerrar`);
    const asiento = async (id: string) => {
      const a = await prisma.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
      const r: Record<string, [string, string]> = {};
      for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toFixed(2), x.haber.toFixed(2)];
      return r;
    };
    return { ...v, proveedorId, compra, venta, config, ver, cerrar, asiento };
  };

  /** Octubre: venta gravada 1.000 y exenta 1.000; compras GRAVADO (IVA 210), EXENTO (IVA 105) y COMUN (IVA 210). */
  const escenario = async () => {
    const x = await base();
    await x.venta('2026-10-15', 21);
    await x.venta('2026-10-16', 'EXENTO');
    await x.compra(1000, '2026-10-10');
    await x.compra(500, '2026-10-11', 'EXENTO');
    const comun = await x.compra(1000, '2026-10-12', 'COMUN');
    return { ...x, comun };
  };
  const prorrateo = (o: Record<string, unknown> = {}) => ({ ivaInicioAnio: 2026, ivaInicioMes: 10, prorrateoIva: true, prorrateoDesdeAnio: 2026, prorrateoDesdeMes: 10, prorrateoInicioMes: 1, prorrateoGravadasIniciales: 0, prorrateoExentasIniciales: 0, ...o });

  it('sin prorrateo la posición es la de siempre', async () => {
    const x = await escenario();
    await x.config({ ivaInicioAnio: 2026, ivaInicioMes: 10 });
    const p = await x.ver(2026, 10);
    expect([p.totalCredito, p.saldoTecnicoAFavor, p.coeficiente, p.creditoComputable]).toEqual(['525.00', '315.00', null, null]);
  });

  it('crédito computable y no computable con el coeficiente del ejercicio; asiento del no computable', async () => {
    const x = await escenario();
    expect((await x.config(prorrateo())).status).toBe(200);
    const p = await x.ver(2026, 10);
    expect([p.coeficiente, p.creditoComun, p.creditoComputable, p.creditoNoComputable, p.saldoTecnicoAFavor]).toEqual(['0.5000', '210.00', '315.00', '210.00', '105.00']);
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const c = await x.ver(2026, 10);
    expect([c.estado, c.coeficiente, c.creditoNoComputable]).toEqual(['CERRADA', '0.5000', '210.00']);
    expect(await x.asiento(c.asientoId!)).toEqual({ '2.1.02.001': ['210.00', '0.00'], '1.1.03.001': ['0.00', '525.00'], '5.2.14': ['210.00', '0.00'], '1.1.03.009': ['105.00', '0.00'] });
  });

  it('ventas iniciales del ejercicio en el coeficiente', async () => {
    const x = await escenario();
    await x.config(prorrateo({ prorrateoGravadasIniciales: 3000 }));
    const p = await x.ver(2026, 10);
    expect([p.coeficiente, p.creditoComputable]).toEqual(['0.8000', '378.00']);
  });

  it('una nota de crédito de compra de uso común resta crédito común', async () => {
    const x = await escenario();
    await x.compra(500, '2026-10-13', 'COMUN', true);
    await x.config(prorrateo());
    expect((await x.ver(2026, 10)).creditoComun).toBe('105.00');
  });

  it('cambiar el destino de una compra: mes abierto cambia la posición; mes cerrado no se puede', async () => {
    const x = await escenario();
    await x.config(prorrateo());
    const r = await x.http.patch(`/api/compras/comprobantes/${x.comun}/destino-iva`, { destinoCreditoIva: 'GRAVADO' });
    expect(r.status).toBe(200);
    expect((await x.ver(2026, 10)).creditoComun).toBe('0.00');
    await x.cerrar(2026, 10);
    const c = await x.http.patch(`/api/compras/comprobantes/${x.comun}/destino-iva`, { destinoCreditoIva: 'COMUN' });
    expect([c.status, c.body.message]).toEqual([400, 'La posición de IVA de 10/2026 está cerrada: use una fecha de un mes abierto o reabra la posición']);
  });

  it('activar el prorrateo: con cerradas desde el primer mes no; con cerradas solo antes sí', async () => {
    const x = await escenario();
    await x.config({ ivaInicioAnio: 2026, ivaInicioMes: 9 });
    expect((await x.cerrar(2026, 9)).status).toBe(201);
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const no = await x.config(prorrateo({ ivaInicioMes: 9 }));
    expect([no.status, no.body.message]).toEqual([400, 'Hay posiciones de IVA cerradas desde 10/2026: reábralas para cambiar el prorrateo']);
    await x.http.post('/api/impuestos/posicion-iva/2026/10/reabrir');
    expect((await x.config(prorrateo({ ivaInicioMes: 9 }))).status).toBe(200);
  });

  it('ajuste anual en el último mes del ejercicio', async () => {
    const x = await base();
    // Ejercicio noviembre–octubre; prorrateo desde septiembre: septiembre gravada, octubre exenta → coeficiente anual 0,5
    await x.venta('2026-09-15', 21);
    await x.compra(1000, '2026-09-10', 'COMUN');
    await x.venta('2026-10-15', 'EXENTO');
    await x.config(prorrateo({ ivaInicioMes: 9, prorrateoDesdeMes: 9, prorrateoInicioMes: 11 }));
    const sep = await x.ver(2026, 9);
    expect([sep.coeficiente, sep.creditoComputable]).toEqual(['1.0000', '210.00']);
    expect((await x.cerrar(2026, 9)).status).toBe(201);
    const oct = await x.ver(2026, 10);
    expect([oct.coeficiente, oct.ajusteProrrateo, oct.creditoComputable, oct.creditoNoComputable]).toEqual(['0.5000', '-105.00', '-105.00', '105.00']);
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const a = await x.asiento((await x.ver(2026, 10)).asientoId!);
    expect(a['5.2.14']).toEqual(['105.00', '0.00']);
  });

  it('sin ventas en el ejercicio: coeficiente 1 y aviso', async () => {
    const x = await base();
    await x.compra(1000, '2026-10-12', 'COMUN');
    await x.config(prorrateo());
    const p = await x.ver(2026, 10);
    expect([p.coeficiente, p.creditoComputable]).toEqual(['1.0000', '210.00']);
    expect(p.avisos).toContain('Sin ventas en el ejercicio: el crédito de uso común se computa entero');
  });

  it('el Libro IVA Digital avisa el prorrateo con el coeficiente', async () => {
    const x = await escenario();
    await x.config(prorrateo());
    const g = await x.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202610' });
    expect(g.status).toBe(201);
    expect(g.body.advertencias).toContain('Con prorrateo del crédito fiscal: declare el prorrateo global en el Libro IVA Digital (coeficiente 0,5000)');
  });

  it('compras sabe si el prorrateo está activo sin permiso de impuestos', async () => {
    const x = await base();
    expect((await x.http.get('/api/compras/comprobantes/opciones')).body).toEqual({ prorrateoIva: false });
    await x.config(prorrateo());
    expect((await x.http.get('/api/compras/comprobantes/opciones')).body).toEqual({ prorrateoIva: true });
  });

  it('revisión: se puede desactivar con meses cerrados; se exige el primer mes y que no sea anterior al inicio de IVA', async () => {
    const x = await escenario();
    expect((await x.config(prorrateo())).status).toBe(200);
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const off = await x.config(prorrateo({ prorrateoIva: false }));
    expect(off.status).toBe(200);
    expect((await x.ver(2026, 10)).coeficiente).toBe('0.5000');
    const sinMes = await x.config(prorrateo({ prorrateoDesdeAnio: null, prorrateoDesdeMes: null }));
    expect([sinMes.status, sinMes.body.message]).toEqual([400, 'Indique el primer mes con prorrateo']);
    const antes = await x.config(prorrateo({ prorrateoDesdeMes: 9 }));
    expect([antes.status, antes.body.message]).toEqual([400, 'El primer mes con prorrateo no puede ser anterior al inicio de la posición de IVA']);
    // Volver a activarlo desde noviembre: las cerradas de antes no impiden
    expect((await x.config(prorrateo({ prorrateoDesdeMes: 11 }))).status).toBe(200);
  });

  it('revisión: la nota de crédito de compra hereda el destino de su factura', async () => {
    const x = await escenario();
    const r = await x.http.post('/api/compras/comprobantes', {
      terceroId: x.proveedorId, tipo: 'NOTA_CREDITO', letra: 'A', puntoVenta: 9, numero: 1, fechaEmision: '2026-10-20', fechaContable: '2026-10-20', monedaCodigo: 'ARS',
      totalDeclarado: 121, comprobanteAsociadoId: x.comun, renglones: [{ origen: 'DIRECTO', descripcion: 'NC', cantidad: 1, precioUnitario: 100, alicuotaIva: 21 }],
    });
    expect(r.status).toBe(201);
    expect((await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: r.body.id } })).destinoCreditoIva).toBe('COMUN');
  });
});
