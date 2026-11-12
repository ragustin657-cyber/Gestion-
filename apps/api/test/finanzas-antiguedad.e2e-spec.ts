import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';

describe('finanzas: antigüedad a una fecha', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('informe, tablero y Compras coinciden a una fecha pasada', async () => {
    const p = await prepararPagos(app, prisma);
    await prisma.rol.updateMany({ where: { empresaId: p.empresaId }, data: { permisos: { push: 'informes.ver' } } });
    const fc = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000, fecha: '2026-09-01' });
    const op = await p.opAprobada([{ movimientoId: fc.movimientoId, importe: 1210 }]);
    expect((await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1210, cuentaBancariaId: p.ars.id }], '2026-11-03')).status).toBe(200);
    const informe = async (fecha: string) => (await p.http.get(`/api/informes/antiguedad?tipo=proveedores&fecha=${fecha}`)).body;
    const compras = async (fecha: string) => (await p.http.get(`/api/compras/antiguedad-deuda?fecha=${fecha}`)).body;
    expect((await informe('2026-10-31')).totales).toMatchObject({ d1_30: '1210.00', total: '1210.00' });
    expect(await compras('2026-10-31')).toEqual([expect.objectContaining({ terceroId: p.proveedorId, d0a30: '1210.00', total: '1210.00' })]);
    const tablero = (await p.http.get('/api/informes/tablero?desde=2026-10-01&hasta=2026-10-31')).body;
    expect(tablero.indicadores.deudaVencida.valor).toBe('1210.00');
    expect((await informe('2026-11-05')).filas).toEqual([]);
    expect(await compras('2026-11-05')).toEqual([]);
  });

  it('excluye movimientos posteriores al corte', async () => {
    const p = await prepararPagos(app, prisma);
    await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000, fecha: '2026-11-02' });
    expect((await p.http.get('/api/compras/antiguedad-deuda?fecha=2026-10-31')).body).toEqual([]);
    expect((await p.http.get('/api/compras/antiguedad-deuda?fecha=2026-11-05')).body).toHaveLength(1);
  });
});
