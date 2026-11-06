import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';

describe('Libro Diario, Mayor y balance de sumas y saldos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function escenario() {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const adm = await prisma.centroCosto.create({ data: { empresaId: s.empresaId, codigo: 'ADM', nombre: 'Administración' } });
    const banco = await s.cuenta('1.1.01.002');
    const capital = await s.cuenta('3.1.01');
    const gasto = await s.cuenta('5.2.01');
    const caja = await s.cuenta('1.1.01.001');
    await s.http.post('/api/contabilidad/asientos', { fecha: '2026-11-01', descripcion: 'Aporte de capital', renglones: [{ cuentaContableId: banco, debe: 1000000 }, { cuentaContableId: capital, haber: 1000000 }] });
    const fc = await facturaPendiente(s.http, prisma, { proveedorId, neto: 1000, fecha: '2026-11-02' });
    await s.http.post('/api/contabilidad/asientos', { fecha: '2026-11-03', descripcion: 'Gasto administrativo', renglones: [{ cuentaContableId: gasto, centroCostoId: adm.id, debe: 500 }, { cuentaContableId: caja, haber: 500 }] });
    return { ...s, adm, gasto, fc };
  }

  it('Libro Diario con totales, origen y filtro', async () => {
    const s = await escenario();
    const r = (await s.http.get('/api/contabilidad/diario?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(r.total).toBe(3);
    expect(r.totales).toEqual({ debe: '1001710', haber: '1001710' });
    expect(r.items.map((a: { descripcion: string }) => a.descripcion)[0]).toBe('Aporte de capital');
    const factura = r.items.find((a: { origen: { tipo: string } }) => a.origen.tipo === 'COMPRA');
    expect(factura.origen.ruta).toBe(`/compras/comprobantes?id=${s.fc.comprobanteId}`);
    expect(factura.renglones.some((x: { cuenta: { codigo: string } }) => x.cuenta.codigo === '2.1.01.001')).toBe(true);
    expect((await s.http.get('/api/contabilidad/diario?desde=2026-11-01&hasta=2026-11-30&origenTipo=MANUAL')).body.total).toBe(2);
    const det = await s.http.get(`/api/contabilidad/asientos/${factura.id}`);
    expect(det.status).toBe(200);
    expect(det.body.origen.ruta).toBe(factura.origen.ruta);
  });

  it('Mayor con saldo inicial, centro de costo y rubro', async () => {
    const s = await escenario();
    const m = (await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${s.gasto}&desde=2026-11-01&hasta=2026-11-30`)).body;
    expect(m.saldoInicial).toBe('0');
    expect(m.movimientos.map((x: { debe: string; saldo: string }) => [x.debe, x.saldo])).toEqual([['1000', '1000'], ['500', '1500']]);
    expect(m.saldoFinal).toBe('1500');
    const desde = (await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${s.gasto}&desde=2026-11-03&hasta=2026-11-30`)).body;
    expect(desde.saldoInicial).toBe('1000');
    expect(desde.movimientos).toHaveLength(1);
    const cc = (await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${s.gasto}&desde=2026-11-01&hasta=2026-11-30&centroCostoId=${s.adm.id}`)).body;
    expect(cc.movimientos.map((x: { debe: string }) => x.debe)).toEqual(['500']);
    const rubro = (await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${await s.cuenta('5.2')}&desde=2026-11-01&hasta=2026-11-30`)).body;
    expect(rubro.saldoFinal).toBe('1500');
  });

  it('sumas y saldos: totales que coinciden, rubros y nivel', async () => {
    const s = await escenario();
    const r = (await s.http.get('/api/contabilidad/sumas-saldos')).body;
    expect(r.totales.debe).toBe(r.totales.haber);
    expect(r.totales.saldoDeudor).toBe(r.totales.saldoAcreedor);
    const fila = (codigo: string) => r.filas.find((f: { codigo: string }) => f.codigo === codigo);
    expect(fila('1.1.01.002')).toMatchObject({ debe: '1000000', haber: '0', saldoDeudor: '1000000', saldoAcreedor: '0', imputable: true });
    expect(fila('1.1')).toMatchObject({ debe: '1000210', haber: '500', saldoDeudor: '999710' });
    expect(fila('2.1.01.001')).toMatchObject({ saldoAcreedor: '1210' });
    const n2 = (await s.http.get('/api/contabilidad/sumas-saldos?nivel=2')).body;
    expect(n2.filas.every((f: { nivel: number }) => f.nivel <= 2)).toBe(true);
    expect(n2.totales).toEqual(r.totales);
  });

  it('rango que cruza ejercicios → 400; exportación; otra empresa → 404', async () => {
    const s = await escenario();
    await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    const cruzado = await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${s.gasto}&desde=2026-12-15&hasta=2027-01-15`);
    expect(cruzado.status).toBe(400);
    expect(cruzado.body.message).toBe('El rango debe estar dentro de un mismo ejercicio');
    expect((await s.http.get('/api/contabilidad/sumas-saldos?desde=2026-12-15&hasta=2027-01-15')).status).toBe(400);
    const xlsx = await s.http.get('/api/contabilidad/diario?desde=2026-11-01&hasta=2026-11-30&formato=xlsx');
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await s.http.get(`/api/contabilidad/mayor?cuentaContableId=${s.gasto}&desde=2026-11-01&hasta=2026-11-30&formato=pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await s.http.get('/api/contabilidad/sumas-saldos?formato=pdf')).headers['content-type']).toContain('application/pdf');
    const a = await prisma.asiento.findFirstOrThrow({ where: { empresaId: s.empresaId } });
    const otra = await sesionConPlan(app, prisma);
    expect((await otra.http.get(`/api/contabilidad/asientos/${a.id}`)).status).toBe(404);
  });
});
