import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, otroUsuario } from './helpers';
import { prepararBienes } from './helpers-bienes';
import { prepararVentas } from './helpers-ventas';

describe('bienes de uso: correcciones de la revisión', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const ejercicio = (empresaId: string) => prisma.ejercicio.findFirstOrThrow({ where: { empresaId, numero: 1 } });

  it('cierre: con todo amortizado no exige un proceso del mes de cierre', async () => {
    const b = await prepararBienes(app, prisma);
    const rubro = await b.rubro('Equipos de computación');
    await b.http.post('/api/bienes-uso', { origen: 'INICIAL', descripcion: 'PC', rubroId: rubro.id, fechaAlta: '2023-01-10', valorOrigen: 3600, amortizacionInicial: 3600, fechaAmortizacionInicial: '2025-12-31' });
    const ej = await ejercicio(b.empresaId);
    const faltantes = (await b.http.get(`/api/contabilidad/ejercicios/${ej.id}/cierre/previa`)).body.faltantes as string[];
    expect(faltantes).not.toContain('Genere la amortización de bienes de uso de 12/2026');
  });

  it('no genera amortización mientras una venta del bien está en emisión', async () => {
    const v = await prepararVentas(app, prisma);
    const b = await prepararBienes(app, prisma, v);
    const { bien } = await b.facturaBien({ neto: 1200000 });
    await b.generar('2026-09');
    const c = (await v.http.post('/api/ventas/comprobantes', v.datos({ fecha: '2026-10-15', fechaVencimiento: '2026-11-15', renglones: [{ bienUsoId: bien.id, descripcion: 'Camioneta', cantidad: 1, precioUnitario: 1100000, alicuota: 21 }] }))).body;
    await prisma.comprobanteVenta.update({ where: { id: c.id }, data: { emisionEnCurso: new Date() } });
    expect((await b.http.post('/api/bienes-uso/amortizacion', { mes: '2026-10' })).body.message).toBe('El bien N° 1 se está vendiendo (comprobante en emisión): espere a que termine');
  });

  it('planilla a mitad de mes no incluye la amortización de ese mes', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1200000 });
    await b.generar('2026-09');
    await b.generar('2026-10');
    const ej = await ejercicio(b.empresaId);
    const p = (await b.http.get(`/api/bienes-uso/planilla?ejercicioId=${ej.id}&fecha=2026-10-15`)).body;
    expect(p.filas[0]).toMatchObject({ amortEjercicio: '140000.00' });
    expect(p.control).toEqual({ origen: '0.00', amortizacion: '0.00' });
  });

  it('anular la factura de un bien lleva la fecha de origen (el ajuste no deja diferencia)', async () => {
    const b = await prepararBienes(app, prisma);
    for (let m = 0; m <= 11; m++) {
      const [anio, mes] = m === 0 ? [2025, 12] : [2026, m];
      await prisma.indiceInflacion.create({ data: { anio, mes, valor: 100 + 10 * m, actualizadoPor: 't' } });
    }
    const ej = await ejercicio(b.empresaId);
    await b.http.put('/api/contabilidad/ajuste-inflacion/config', { primerEjercicioId: ej.id, anticuacion: [] });
    const { comprobanteId } = await b.facturaBien({ neto: 1200000 });
    expect((await b.http.post(`/api/compras/comprobantes/${comprobanteId}/anular`, { motivo: 'Error' })).status).toBe(200);
    const cuentas = (await b.http.get('/api/contabilidad/ajuste-inflacion/previa?fecha=2026-11-30')).body.cuentas as { codigo: string; reexpresado: string }[];
    expect(cuentas.find((x) => x.codigo === '1.2.01.002')?.reexpresado ?? '0.00').toBe('0.00');
  });

  it('el comprador ve los rubros y una factura desde OC a cuenta de rubro da de alta el bien', async () => {
    const b = await prepararBienes(app, prisma);
    const u = await otroUsuario(app, prisma, b.empresaId, ['fc.crear']);
    expect((await u.http.get('/api/bienes-uso/rubros')).status).toBe(200);
    const { articuloId } = await datosCompras(prisma, b.empresaId);
    await prisma.articulo.update({ where: { id: articuloId }, data: { cuentaCompraId: await b.cuenta('1.2.01.003') } });
    const oc = await ocAprobada(b.http, prisma, b.empresaId, { proveedorId: b.proveedorId, articuloId }, 1, 500000);
    const r = await b.http.post('/api/compras/comprobantes', {
      terceroId: b.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 2, numero: 777, fechaEmision: '2026-11-05', fechaContable: '2026-11-05', monedaCodigo: 'ARS', totalDeclarado: 605000,
      renglones: [{ origen: 'ORDEN_COMPRA', ordenCompraRenglonId: oc.renglones[0].id, descripcion: 'Servidor', cantidad: 1, precioUnitario: 500000, alicuotaIva: 21 }],
    });
    expect(r.status).toBe(201);
    expect(await prisma.bienUso.count({ where: { empresaId: b.empresaId, descripcion: 'Servidor', vidaUtilMeses: 36 } })).toBe(1);
  });

  it('editar una carga inicial revalida la amortización acumulada y no cambia de rubro', async () => {
    const b = await prepararBienes(app, prisma);
    const rubro = await b.rubro('Rodados');
    const otro = await b.rubro('Muebles y útiles');
    const r = (await b.http.post('/api/bienes-uso', { origen: 'INICIAL', descripcion: 'Auto', rubroId: rubro.id, fechaAlta: '2024-01-10', valorOrigen: 100000, amortizacionInicial: 80000, fechaAmortizacionInicial: '2025-12-31' })).body;
    expect((await b.http.put(`/api/bienes-uso/${r.id}`, { valorOrigen: 50000 })).body.message).toBe('La amortización acumulada no puede superar el valor amortizable');
    expect((await b.http.put(`/api/bienes-uso/${r.id}`, { fechaAlta: '2026-02-01' })).body.message).toBe('La fecha de la amortización acumulada no puede ser anterior al alta');
    expect((await b.http.put(`/api/bienes-uso/${r.id}`, { rubroId: otro.id })).body.message).toBe('La fecha, el valor y el rubro salen de la factura o del asiento de alta');
  });

  it('control con el Mayor descuenta los ajustes por inflación de ejercicios anteriores incluidos en la apertura', async () => {
    const b = await prepararBienes(app, prisma);
    const ej = await ejercicio(b.empresaId);
    const anterior = await prisma.ejercicio.create({ data: { empresaId: b.empresaId, numero: 0, desde: new Date('2025-01-01T00:00:00Z'), hasta: new Date('2025-12-31T00:00:00Z'), estado: 'CERRADO' } });
    const rubro = await b.rubro('Rodados');
    await b.http.post('/api/bienes-uso', { origen: 'INICIAL', descripcion: 'Auto', rubroId: rubro.id, fechaAlta: '2024-01-10', valorOrigen: 600000, amortizacionInicial: 0, fechaAmortizacionInicial: '2024-01-31' });
    const ren = async (codigo: string, debe: number, haber: number) => ({ empresaId: b.empresaId, cuentaContableId: await b.cuenta(codigo), debe, haber });
    await prisma.asiento.create({ data: { empresaId: b.empresaId, numero: 9001, fecha: new Date('2025-12-31T00:00:00Z'), descripcion: 'Ajuste', origenTipo: 'AJUSTE_INFLACION', origenId: anterior.id, creadoPor: 't', tipo: 'AJUSTE_INFLACION', ejercicioId: anterior.id, renglones: { create: [await ren('1.2.01.002', 60000, 0), await ren('4.2.03', 0, 60000)] } } });
    await prisma.asiento.create({ data: { empresaId: b.empresaId, numero: 9002, fecha: ej.desde, descripcion: 'Apertura', origenTipo: 'APERTURA', origenId: ej.id, creadoPor: 't', tipo: 'APERTURA', ejercicioId: ej.id, renglones: { create: [await ren('1.2.01.002', 660000, 0), await ren('3.1.01', 0, 660000)] } } });
    const p = (await b.http.get(`/api/bienes-uso/planilla?ejercicioId=${ej.id}&fecha=2026-10-31`)).body;
    expect(p.control.origen).toBe('0.00');
  });
});
