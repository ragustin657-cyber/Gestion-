import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Detalle { jurisdiccion: string; coeficiente: string; alicuota: string; base: string; impuesto: string; retenciones: string; percepciones: string; saldoAnterior: string; aPagar: string; saldoAFavor: string }
interface Posicion { estado: string; ingresos: string; detalle: Detalle[]; totales: Record<string, string>; avisos: string[]; asientoId: string | null }
const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };
const J2026 = [
  { jurisdiccion: '901', coeficiente: 0.6, alicuota: 3, actividad: '620100' },
  { jurisdiccion: '902', coeficiente: 0.4, alicuota: 4, actividad: '620100' },
];

describe('liquidación de IIBB por Convenio Multilateral', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  /**
   * Octubre: factura A 1.000 neto, NC 200 neto, factura exenta USD 100 a 1.000 (100.000) → ingresos 100.800.
   * Recibo con retención IIBB 902 de 30 y 913 de 10 (fuera del Convenio); compra con percepción IIBB 902 de 20.
   */
  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    jest.setSystemTime(new Date('2026-10-20T15:00:00Z'));
    const fc = await v.factura({ fecha: '2026-10-15' });
    const nc = await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, fecha: '2026-10-16', aplicarAAsociado: false, renglones: [{ descripcion: 'Bonif', cantidad: 1, precioUnitario: 200, alicuota: 21 }], emitir: true }));
    if (nc.status !== 201) throw new Error(JSON.stringify(nc.body));
    await v.factura({ fecha: '2026-10-17', monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
    const { proveedorId } = await datosCompras(prisma, v.empresaId);
    const compra = await facturaPendiente(v.http, prisma, { proveedorId, neto: 500, fecha: '2026-10-10' });
    await prisma.comprobanteCompraPercepcionIibb.create({ data: { empresaId: v.empresaId, comprobanteId: compra.comprobanteId, jurisdiccion: '902', importe: 20 } });
    const r = await v.http.post('/api/ventas/recibos', {
      terceroId: v.clienteRI.id, fecha: '2026-10-18', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1170 }, cheques: [], transferencias: [],
      retenciones: [{ tipo: 'IIBB', jurisdiccion: '902', numeroCertificado: 'R-1', fecha: '2026-10-18', importe: 30 }, { tipo: 'IIBB', jurisdiccion: '913', numeroCertificado: 'R-2', fecha: '2026-10-18', importe: 10 }],
      aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }],
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    const ver = async (anio: number, mes: number) => (await v.http.get(`/api/impuestos/iibb/posicion?anio=${anio}&mes=${mes}`)).body as Posicion;
    const cerrar = (anio: number, mes: number) => v.http.post(`/api/impuestos/iibb/posicion/${anio}/${mes}/cerrar`);
    const reabrir = (anio: number, mes: number) => v.http.post(`/api/impuestos/iibb/posicion/${anio}/${mes}/reabrir`);
    const inicio = (anio: number, mes: number) => v.http.put('/api/impuestos/config', { ...CONFIG, iibbInicioAnio: anio, iibbInicioMes: mes });
    const jurisdicciones = (anio: number, lista: Record<string, unknown>[]) => v.http.put(`/api/impuestos/iibb/jurisdicciones?anio=${anio}`, { jurisdicciones: lista });
    const asiento = async (id: string) => {
      const a = await prisma.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
      const r2: Record<string, [string, string]> = {};
      for (const x of a.renglones) r2[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toFixed(2), x.haber.toFixed(2)];
      return { a, r: r2 };
    };
    const de = (p: Posicion, j: string) => p.detalle.find((d) => d.jurisdiccion === j)!;
    return { ...v, proveedorId, ver, cerrar, reabrir, inicio, jurisdicciones, asiento, de };
  };

  it('jurisdicciones del año: reemplaza la lista; el saldo inicial solo en el año de inicio', async () => {
    const x = await escenario();
    await x.inicio(2026, 10);
    expect((await x.jurisdicciones(2026, [{ ...J2026[0], saldoInicial: 100 }, J2026[1]])).status).toBe(200);
    expect((await x.jurisdicciones(2026, [{ ...J2026[0], coeficiente: 1, saldoInicial: 150 }])).status).toBe(200);
    const l = (await x.http.get('/api/impuestos/iibb/jurisdicciones?anio=2026')).body as { jurisdiccion: string; coeficiente: string; saldoInicial: string }[];
    expect(l.map((j) => [j.jurisdiccion, j.coeficiente, j.saldoInicial])).toEqual([['901', '1', '150']]);
    await x.jurisdicciones(2027, [{ ...J2026[0], coeficiente: 1, saldoInicial: 999 }]);
    const l27 = (await x.http.get('/api/impuestos/iibb/jurisdicciones?anio=2027')).body as { saldoInicial: string }[];
    expect(l27[0].saldoInicial).toBe('0');
    const mal = await x.jurisdicciones(2026, [J2026[0], J2026[0]]);
    expect(mal.status).toBe(400);
  });

  it('borrador del mes: ingresos en pesos con NC, retenciones, percepciones y aviso fuera del Convenio', async () => {
    const x = await escenario();
    await x.jurisdicciones(2026, J2026);
    const p = await x.ver(2026, 10);
    expect([p.estado, p.ingresos]).toEqual(['BORRADOR', '100800.00']);
    expect(x.de(p, '901')).toMatchObject({ base: '60480.00', impuesto: '1814.40', aPagar: '1814.40' });
    expect(x.de(p, '902')).toMatchObject({ base: '40320.00', impuesto: '1612.80', retenciones: '30.00', percepciones: '20.00', aPagar: '1562.80' });
    expect(p.avisos).toContain('Hay retenciones o percepciones de la jurisdicción 913 Mendoza, que no está en el Convenio de 2026');
  });

  it('validaciones de cierre', async () => {
    const x = await escenario();
    expect((await x.cerrar(2026, 10)).body.message).toBe('Configure el primer mes de la liquidación de IIBB');
    await x.inicio(2026, 10);
    expect((await x.cerrar(2026, 10)).body.message).toBe('Cargue las jurisdicciones y coeficientes de Convenio Multilateral de 2026');
    await x.jurisdicciones(2026, [J2026[0], { ...J2026[1], coeficiente: 0.3 }]);
    expect((await x.cerrar(2026, 10)).body.message).toBe('Los coeficientes de 2026 suman 0.9000: deben sumar 1');
    await x.jurisdicciones(2026, J2026);
    expect((await x.cerrar(2026, 9)).body.message).toBe('El mes es anterior al inicio de la liquidación de IIBB en el sistema');
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    expect((await x.cerrar(2026, 11)).body.message).toBe('Solo se cierra un mes terminado');
    const otra = await x.inicio(2026, 9);
    expect([otra.status, otra.body.message]).toEqual([400, 'Hay liquidaciones de IIBB cerradas: reábralas para cambiar el inicio']);
    const cambio = await x.jurisdicciones(2026, J2026);
    expect([cambio.status, cambio.body.message]).toEqual([400, 'Hay meses de 2026 liquidados: reábralos para cambiar las jurisdicciones']);
  });

  it('cierre: fila y asiento de liquidación', async () => {
    const x = await escenario();
    await x.inicio(2026, 10);
    await x.jurisdicciones(2026, J2026);
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const p = await x.ver(2026, 10);
    expect([p.estado, p.totales.aPagar]).toEqual(['CERRADA', '3377.20']);
    const { a, r } = await x.asiento(p.asientoId!);
    expect(a.fecha.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(r).toEqual({ '5.2.13': ['3427.20', '0.00'], '1.1.03.007': ['0.00', '30.00'], '1.1.03.003': ['0.00', '20.00'], '2.1.02.007': ['0.00', '3377.20'] });
  });

  it('el anterior tiene que estar cerrado; arrastre del saldo a favor por jurisdicción', async () => {
    const x = await escenario();
    await x.inicio(2026, 9);
    await x.jurisdicciones(2026, [{ ...J2026[0], saldoInicial: 5000 }, J2026[1]]);
    expect((await x.cerrar(2026, 10)).body.message).toBe('Cierre primero la liquidación de IIBB de 09/2026');
    expect((await x.ver(2026, 10)).avisos).toContain('El mes anterior no está cerrado: los saldos anteriores pueden cambiar');
    expect(x.de(await x.ver(2026, 10), '901').saldoAnterior).toBe('5000.00');
    expect((await x.cerrar(2026, 9)).status).toBe(201);
    expect(x.de(await x.ver(2026, 9), '901').saldoAFavor).toBe('5000.00');
    expect((await x.cerrar(2026, 10)).status).toBe(201);
    const p = await x.ver(2026, 10);
    expect(x.de(p, '901')).toMatchObject({ saldoAnterior: '5000.00', aPagar: '0.00', saldoAFavor: '3185.60' });
    expect(x.de(p, '902').aPagar).toBe('1562.80');
    const { r } = await x.asiento(p.asientoId!);
    // Se cancela el saldo anterior (5.000) y se registra el nuevo (3.185,60): neto 1.814,40 al haber
    expect(r['1.1.03.011']).toEqual(['0.00', '1814.40']);
    expect(r['2.1.02.007']).toEqual(['0.00', '1562.80']);
  });

  it('el saldo a favor de una jurisdicción que sale del Convenio no pasa al año siguiente', async () => {
    const x = await escenario();
    await x.inicio(2025, 12);
    await x.jurisdicciones(2025, [{ ...J2026[0], coeficiente: 0.5 }, { jurisdiccion: '913', coeficiente: 0.5, alicuota: 2, actividad: '620100', saldoInicial: 800 }]);
    expect((await x.cerrar(2025, 12)).status).toBe(201);
    await x.jurisdicciones(2026, [{ ...J2026[0], coeficiente: 1 }]);
    const p = await x.ver(2026, 1);
    expect(p.avisos).toContain('Los saldos a favor de 913 Mendoza (800.00) no pasan a 2026 porque la jurisdicción no está en el Convenio: quedan en la cuenta IIBB Saldo a favor');
    expect(p.detalle.map((d) => [d.jurisdiccion, d.saldoAnterior])).toEqual([['901', '0.00']]);
  });

  it('reabrir: solo el último cerrado; contraasiento del último día del mes', async () => {
    const x = await escenario();
    await x.inicio(2026, 9);
    await x.jurisdicciones(2026, J2026);
    await x.cerrar(2026, 9);
    await x.cerrar(2026, 10);
    const asientoId = (await x.ver(2026, 10)).asientoId!;
    expect((await x.reabrir(2026, 9)).body.message).toBe('Reabra primero la liquidación de IIBB de 10/2026');
    expect((await x.reabrir(2026, 10)).status).toBe(201);
    expect((await x.ver(2026, 10)).estado).toBe('BORRADOR');
    const contra = await prisma.asiento.findFirstOrThrow({ where: { anulaAId: asientoId } });
    expect(contra.fecha.toISOString().slice(0, 10)).toBe('2026-10-31');
  });

  it('meses del año y descargas', async () => {
    const x = await escenario();
    await x.inicio(2026, 10);
    await x.jurisdicciones(2026, J2026);
    await x.cerrar(2026, 10);
    const meses = (await x.http.get('/api/impuestos/iibb/posicion/meses?anio=2026')).body as { mes: number; estado: string | null; aPagar: string | null }[];
    expect(meses).toHaveLength(12);
    expect(meses.find((m) => m.mes === 10)).toMatchObject({ estado: 'CERRADA', aPagar: '3377.20' });
    const xlsx = await x.http.get('/api/impuestos/iibb/posicion?anio=2026&mes=10&formato=xlsx');
    expect([xlsx.status, String(xlsx.headers['content-type'])]).toEqual([200, expect.stringContaining('spreadsheet')]);
    const pdf = await x.http.get('/api/impuestos/iibb/posicion?anio=2026&mes=10&formato=pdf');
    expect([pdf.status, String(pdf.headers['content-type'])]).toEqual([200, expect.stringContaining('pdf')]);
  });
});
