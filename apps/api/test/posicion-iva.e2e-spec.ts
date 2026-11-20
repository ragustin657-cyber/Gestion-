import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Posicion {
  estado: string; debito: Record<string, string>; credito: Record<string, string>; retenciones: string; percepciones: string; saldoTecnicoAnterior: string; libreAnterior: string;
  saldoTecnicoAFavor: string; impuestoDeterminado: string; impuestoAPagar: string; libreDisponibilidad: string; avisos: string[]; asientoId: string | null;
}
const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };

describe('posición mensual de IVA', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  /** Octubre: venta A 1.000 al 21 % (IVA 210), compra A 500 (IVA 105, percepción 20) y un recibo con retención de IVA 30. */
  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    // La sesión se crea en noviembre (el token vencería si se creara en octubre); solo la emisión corre en octubre
    jest.setSystemTime(new Date('2026-10-20T15:00:00Z'));
    const fc = await v.factura({ fecha: '2026-10-15' });
    const { proveedorId } = await datosCompras(prisma, v.empresaId);
    const compra = await facturaPendiente(v.http, prisma, { proveedorId, neto: 500, fecha: '2026-10-10' });
    await prisma.comprobanteCompra.update({ where: { id: compra.comprobanteId }, data: { percepcionIva: 20 } });
    const r = await v.http.post('/api/ventas/recibos', {
      terceroId: v.clienteRI.id, fecha: '2026-10-18', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1180 }, cheques: [], transferencias: [],
      retenciones: [{ tipo: 'IVA', numeroCertificado: 'R-1', fecha: '2026-10-18', importe: 30 }], aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }],
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    const ver = async (anio: number, mes: number) => (await v.http.get(`/api/impuestos/posicion-iva?anio=${anio}&mes=${mes}`)).body as Posicion;
    const cerrar = (anio: number, mes: number) => v.http.post(`/api/impuestos/posicion-iva/${anio}/${mes}/cerrar`);
    const reabrir = (anio: number, mes: number) => v.http.post(`/api/impuestos/posicion-iva/${anio}/${mes}/reabrir`);
    const inicio = (anio: number, mes: number, tecnico = 0, libre = 0) =>
      v.http.put('/api/impuestos/config', { ...CONFIG, ivaInicioAnio: anio, ivaInicioMes: mes, ivaSaldoTecnicoInicial: tecnico, ivaSaldoLibreInicial: libre });
    const asiento = async (id: string) => {
      const a = await prisma.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
      const r2: Record<string, [string, string]> = {};
      for (const x of a.renglones) r2[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toFixed(2), x.haber.toFixed(2)];
      return { a, r: r2 };
    };
    return { ...v, proveedorId, ver, cerrar, reabrir, inicio, asiento };
  };

  it('borrador del mes con débito, crédito, retenciones y percepciones', async () => {
    const x = await escenario();
    const p = await x.ver(2026, 10);
    expect([p.estado, p.debito['21'], p.credito['21'], p.retenciones, p.percepciones]).toEqual(['BORRADOR', '210.00', '105.00', '30.00', '20.00']);
    expect([p.impuestoDeterminado, p.impuestoAPagar]).toEqual(['105.00', '55.00']);
  });

  it('sin inicio configurado no se cierra', async () => {
    const x = await escenario();
    const r = await x.cerrar(2026, 10);
    expect([r.status, r.body.message]).toEqual([400, 'Configure el primer mes y los saldos iniciales de IVA']);
  });

  it('cierre del mes de inicio: fila y asiento de liquidación', async () => {
    const x = await escenario();
    expect((await x.inicio(2026, 10)).status).toBe(200);
    const r = await x.cerrar(2026, 10);
    expect(r.status).toBe(201);
    const p = await x.ver(2026, 10);
    expect([p.estado, p.impuestoAPagar]).toEqual(['CERRADA', '55.00']);
    const { a, r: rs } = await x.asiento(p.asientoId!);
    expect(a.fecha.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(rs).toEqual({ '2.1.02.001': ['210.00', '0.00'], '1.1.03.001': ['0.00', '105.00'], '1.1.03.002': ['0.00', '20.00'], '1.1.03.005': ['0.00', '30.00'], '2.1.02.006': ['0.00', '55.00'] });
    // El libro del mes cerrado no avisa diferencias con el Mayor por la liquidación
    const libro = (await x.http.get('/api/impuestos/libro-iva-ventas?desde=2026-10-01&hasta=2026-10-31')).body as { advertencias: string[] };
    expect(libro.advertencias.filter((y) => y.includes('difiere'))).toEqual([]);
  });

  it('validaciones de cierre', async () => {
    const x = await escenario();
    await x.inicio(2026, 10);
    expect((await x.cerrar(2026, 9)).body.message).toBe('El mes es anterior al inicio de la liquidación de IVA en el sistema');
    await x.cerrar(2026, 10);
    expect((await x.cerrar(2026, 11)).body.message).toBe('Solo se cierra un mes terminado');
    const otra = await x.inicio(2026, 9);
    expect([otra.status, otra.body.message]).toEqual([400, 'Hay posiciones de IVA cerradas: reábralas para cambiar el inicio']);
  });

  it('el mes anterior tiene que estar cerrado; arrastre de saldos y aviso', async () => {
    const x = await escenario();
    await x.inicio(2026, 9, 500, 0);
    expect((await x.cerrar(2026, 10)).body.message).toBe('Cierre primero la posición de IVA de 09/2026');
    expect((await x.ver(2026, 10)).avisos).toContain('El mes anterior no está cerrado: los saldos anteriores pueden cambiar');
    // Septiembre sin movimientos: arrastra el saldo técnico inicial
    expect((await x.cerrar(2026, 9)).status).toBe(201);
    expect((await x.ver(2026, 9)).saldoTecnicoAFavor).toBe('500.00');
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const p = await x.ver(2026, 10);
    // 210 − 105 − 500 = −395 → técnico a favor 395; retenciones y percepciones a libre disponibilidad
    expect([p.saldoTecnicoAnterior, p.saldoTecnicoAFavor, p.libreDisponibilidad, p.impuestoAPagar]).toEqual(['500.00', '395.00', '50.00', '0.00']);
    const { r: rs } = await x.asiento(p.asientoId!);
    // Se cancela el técnico anterior (500 al haber) y se registra el nuevo (395 al debe): el motor agrupa por cuenta
    expect(rs['1.1.03.009']).toBeDefined();
    expect(rs['1.1.03.010']).toEqual(['50.00', '0.00']);
  });

  it('reabrir: solo el último cerrado; contraasiento del último día del mes', async () => {
    const x = await escenario();
    await x.inicio(2026, 9);
    await x.cerrar(2026, 9);
    await x.cerrar(2026, 10);
    const asientoId = (await x.ver(2026, 10)).asientoId!;
    expect((await x.reabrir(2026, 9)).body.message).toBe('Reabra primero la posición de IVA de 10/2026');
    expect((await x.reabrir(2026, 10)).status).toBe(201);
    expect((await x.ver(2026, 10)).estado).toBe('BORRADOR');
    const contra = await prisma.asiento.findFirstOrThrow({ where: { anulaAId: asientoId } });
    expect(contra.fecha.toISOString().slice(0, 10)).toBe('2026-10-31');
  });

  it('meses del año y descargas', async () => {
    const x = await escenario();
    await x.inicio(2026, 10);
    await x.cerrar(2026, 10);
    const meses = (await x.http.get('/api/impuestos/posicion-iva/meses?anio=2026')).body as { mes: number; estado: string | null }[];
    expect(meses).toHaveLength(12);
    expect(meses.find((m) => m.mes === 10)!.estado).toBe('CERRADA');
    const xlsx = await x.http.get('/api/impuestos/posicion-iva?anio=2026&mes=10&formato=xlsx');
    expect([xlsx.status, String(xlsx.headers['content-type'])]).toEqual([200, expect.stringContaining('spreadsheet')]);
    const pdf = await x.http.get('/api/impuestos/posicion-iva?anio=2026&mes=10&formato=pdf');
    expect([pdf.status, String(pdf.headers['content-type'])]).toEqual([200, expect.stringContaining('pdf')]);
  });

  it('un mes cerrado bloquea sus libros (compras y ventas)', async () => {
    const x = await escenario();
    const { proveedorId } = x;
    // Compra de septiembre cargada antes del cierre (para probar la anulación)
    const deSeptiembre = await facturaPendiente(x.http, prisma, { proveedorId, neto: 100, fecha: '2026-09-12' });
    await x.inicio(2026, 9);
    expect((await x.cerrar(2026, 9)).status).toBe(201);
    const MSG = 'La posición de IVA de 09/2026 está cerrada: use una fecha de un mes abierto o reabra la posición';
    const compra = (fechaContable: string, numero: number) => x.http.post('/api/compras/comprobantes', {
      terceroId: proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 8, numero, fechaEmision: '2026-09-10', fechaContable, monedaCodigo: 'ARS', totalDeclarado: 121,
      renglones: [{ origen: 'DIRECTO', descripcion: 'X', cantidad: 1, precioUnitario: 100, alicuotaIva: 21 }],
    });
    const r1 = await compra('2026-09-15', 1);
    expect([r1.status, r1.body.message]).toEqual([400, MSG]);
    expect((await compra('2026-10-01', 2)).status).toBe(201);
    const an = await x.http.post(`/api/compras/comprobantes/${deSeptiembre.comprobanteId}/anular`, { motivo: 'Error' });
    expect([an.status, an.body.message]).toEqual([400, MSG]);
    // Venta con fecha en septiembre (el reloj en septiembre para que ARCA acepte la fecha)
    jest.setSystemTime(new Date('2026-09-25T15:00:00Z'));
    const v = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ fecha: '2026-09-20' }), emitir: true });
    expect([v.status, v.body.message]).toEqual([400, MSG]);
  });
});
