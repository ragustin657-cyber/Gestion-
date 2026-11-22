import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';

const CONFIG = { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' };

describe('pulido E42: impuestos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('cambiar la configuración espera a un cierre en curso (lock de la posición de IVA)', async () => {
    const s = await sesionConPlan(app, prisma);
    let soltar!: () => void;
    const tomado = new Promise<void>((ok) => {
      void prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `posicion-iva:${s.empresaId}`);
        ok();
        await new Promise<void>((fin) => (soltar = fin));
      }, { timeout: 20000 });
    });
    await tomado;
    let listo = false;
    const pedido = s.http.put('/api/impuestos/config', { ...CONFIG, ivaInicioAnio: 2026, ivaInicioMes: 10 }).then((r) => ((listo = true), r));
    await new Promise((ok) => setTimeout(ok, 600));
    expect(listo).toBe(false);
    soltar();
    expect((await pedido).status).toBe(200);
  });

  it('el mes de IIBB cerrado conserva sus avisos', async () => {
    const s = await sesionConPlan(app, prisma);
    await s.http.put('/api/impuestos/config', { ...CONFIG, iibbInicioAnio: 2025, iibbInicioMes: 12 });
    const j = (jurisdiccion: string, coeficiente: number, saldoInicial = 0) => ({ jurisdiccion, coeficiente, alicuota: 3, actividad: '620100', saldoInicial });
    await s.http.put('/api/impuestos/iibb/jurisdicciones?anio=2025', { jurisdicciones: [j('901', 0.5), j('913', 0.5, 800)] });
    expect((await s.http.post('/api/impuestos/iibb/posicion/2025/12/cerrar')).status).toBe(201);
    await s.http.put('/api/impuestos/iibb/jurisdicciones?anio=2026', { jurisdicciones: [j('901', 1)] });
    const c = await s.http.post('/api/impuestos/iibb/posicion/2026/1/cerrar');
    expect(c.status).toBe(201);
    const p = (await s.http.get('/api/impuestos/iibb/posicion?anio=2026&mes=1')).body as { estado: string; avisos: string[] };
    expect(p.estado).toBe('CERRADA');
    expect(p.avisos).toContain('Los saldos a favor de 913 Mendoza (800.00) no pasan a 2026 porque la jurisdicción no está en el Convenio: quedan en la cuenta IIBB Saldo a favor');
  });

  it('informe por provincia: porcentaje del total 0 sin ingresos', async () => {
    const s = await sesionConPlan(app, prisma);
    const r = (await s.http.get('/api/impuestos/iibb/ingresos-por-provincia?anio=2026')).body as { porcentajeTotal: string };
    expect(r.porcentajeTotal).toBe('0.00');
  });

  it('no se cambia el destino del crédito de una compra anulada', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const c = await facturaPendiente(s.http, prisma, { proveedorId, neto: 100 });
    await s.http.post(`/api/compras/comprobantes/${c.comprobanteId}/anular`, { motivo: 'Error' });
    const r = await s.http.patch(`/api/compras/comprobantes/${c.comprobanteId}/destino-iva`, { destinoCreditoIva: 'COMUN' });
    expect([r.status, r.body.message]).toEqual([400, 'Solo se cambia el destino de una compra confirmada']);
  });
});
