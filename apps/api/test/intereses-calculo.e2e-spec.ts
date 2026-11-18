import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Grupo { terceroId: string; cliente: string; monedaCodigo: string; total: string; renglones: { comprobanteId: string; saldo: string; dias: number; interes: string; alicuota: string }[] }

describe('intereses: cálculo del mes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (tasa: number | null = 5) => {
    const v = await prepararVentas(app, prisma);
    if (tasa) await v.http.put('/api/ventas/intereses/configuracion', { tasaMensual: tasa });
    const octubre = (o: Record<string, unknown> = {}) => v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-10', ...o });
    const recibo = async (fc: { id: string }, importe: number, fecha: string) => {
      const r = await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha, puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe }, cheques: [], transferencias: [], retenciones: [], aplicaciones: [{ comprobanteId: fc.id, importe }] });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    };
    const calcular = async (mes = 10) => {
      const r = await v.http.get(`/api/ventas/intereses?anio=2026&mes=${mes}`);
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      return r.body.grupos as Grupo[];
    };
    return { ...v, octubre, recibo, calcular };
  };

  it('días e interés', async () => {
    const x = await escenario();
    await x.octubre();
    const [g] = await x.calcular();
    expect([g.monedaCodigo, g.total, g.renglones[0].dias, g.renglones[0].interes, g.renglones[0].saldo]).toEqual(['ARS', '42.35', 21, '42.35', '1210.00']);
  });

  it('vencida antes del mes', async () => {
    const x = await escenario();
    await x.octubre({ fecha: '2026-09-01', fechaVencimiento: '2026-09-15' });
    const [g] = await x.calcular();
    expect([g.renglones[0].dias, g.renglones[0].interes]).toEqual([31, '62.52']);
  });

  it('pagos antes y después del cierre', async () => {
    const x = await escenario();
    const fc = await x.octubre();
    await x.recibo(fc, 210, '2026-10-20');
    await x.recibo(fc, 500, '2026-11-03');
    const [g] = await x.calcular();
    expect([g.renglones[0].saldo, g.renglones[0].interes]).toEqual(['1000.00', '35.00']);
  });

  it('anticipo anterior aplicado después', async () => {
    const x = await escenario();
    const fc = await x.octubre();
    const { mov } = await x.cobro(1210, '2026-10-05');
    const deb = await x.movDe(fc.id);
    expect((await x.http.post('/api/ventas/aplicaciones', { terceroId: x.clienteRI.id, fecha: '2026-11-04', items: [{ creditoMovId: mov.id, debitoMovId: deb.id, importe: 1210 }] })).status).toBe(201);
    expect(await x.calcular()).toEqual([]);
  });

  it('alícuotas', async () => {
    const x = await escenario();
    await x.octubre({ renglones: [{ descripcion: 'A', cantidad: 1, precioUnitario: 1000, alicuota: 21 }, { descripcion: 'B', cantidad: 1, precioUnitario: 500, alicuota: 10.5 }] });
    await x.octubre({ renglones: [{ descripcion: 'Exento', cantidad: 1, precioUnitario: 1000, alicuota: 'EXENTO' }] });
    const [g] = await x.calcular();
    expect(g.renglones.map((r) => r.alicuota).sort()).toEqual(['21', 'EXENTO']);
  });

  it('vence el último día', async () => {
    const x = await escenario();
    await x.octubre({ fechaVencimiento: '2026-10-31' });
    expect(await x.calcular()).toEqual([]);
  });

  it('dólares', async () => {
    const x = await escenario();
    await x.octubre({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
    const [g] = await x.calcular();
    expect([g.monedaCodigo, g.total]).toEqual(['USD', '3.50']);
  });

  it('cliente exceptuado y mes no terminado', async () => {
    const x = await escenario();
    await x.octubre();
    const mes = await x.http.get('/api/ventas/intereses?anio=2026&mes=11');
    expect([mes.status, mes.body.message]).toEqual([400, 'Solo se liquidan meses terminados']);
    await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { sinIntereses: true });
    expect(await x.calcular()).toEqual([]);
    const sin = await escenario(null);
    const r = await sin.http.get('/api/ventas/intereses?anio=2026&mes=10');
    expect([r.status, r.body.message]).toEqual([400, 'Configure la tasa de interés por mora']);
  });
});
