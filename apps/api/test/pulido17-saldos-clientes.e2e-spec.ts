import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('pulido 17: saldos de clientes a una fecha', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('usa el saldo de ese día y excluye lo posterior', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-05' });
    await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-03', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1210 }, aplicaciones: [{ comprobanteId: fc.id, importe: 1210 }] });
    const saldos = async (fecha: string) => (await v.http.get(`/api/ventas/saldos?fecha=${fecha}`)).body.filas;
    expect(await saldos('2026-10-31')).toEqual([expect.objectContaining({ terceroId: v.clienteRI.id, saldo: '1210.00', d1a30: '1210.00' })]);
    expect(await saldos('2026-11-05')).toEqual([]);
    await v.factura({ fecha: '2026-11-04', fechaVencimiento: '2026-12-04' });
    expect(await saldos('2026-11-03')).toEqual([]);
  });
});
