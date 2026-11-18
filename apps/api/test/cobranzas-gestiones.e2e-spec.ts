import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('cobranzas: gestiones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    await v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    const gestion = (d: Record<string, unknown>, http = v.http, terceroId = v.clienteRI.id) => http.post(`/api/ventas/cobranzas/${terceroId}/gestiones`, { medio: 'LLAMADO', nota: 'Llamé', ...d });
    return { ...v, gestion };
  };

  it('registrar gestión', async () => {
    const x = await escenario();
    const r = await x.gestion({ nota: 'Dice que paga el viernes', proximaAccion: '2026-11-10', promesaFecha: '2026-11-13', promesaImporte: 1000 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ fecha: '2026-11-06', medio: 'LLAMADO', nota: 'Dice que paga el viernes', proximaAccion: '2026-11-10', promesaFecha: '2026-11-13', promesaImporte: '1000.00' });
  });

  it('validaciones', async () => {
    const x = await escenario();
    const msg = async (d: Record<string, unknown>) => { const r = await x.gestion(d); return [r.status, r.body.message]; };
    expect(await msg({ nota: ' ' })).toEqual([400, 'Indique una nota']);
    expect(await msg({ proximaAccion: '2026-11-01' })).toEqual([400, 'La próxima acción no puede ser anterior a la gestión']);
    expect(await msg({ promesaFecha: '2026-11-10' })).toEqual([400, 'La promesa necesita fecha e importe mayor a cero']);
    expect(await msg({ promesaFecha: '2026-11-01', promesaImporte: 100 })).toEqual([400, 'La fecha de la promesa no puede ser anterior a la gestión']);
    expect(await msg({ fecha: '2026-11-07' })).toEqual([400, 'La fecha de la gestión no puede ser futura']);
    const prov = await x.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Prov SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    const r = await x.gestion({}, x.http, prov.body.id);
    expect([r.status, r.body.message]).toEqual([400, 'El tercero no es cliente']);
  });

  it('eliminar solo el mismo día', async () => {
    const x = await escenario();
    const hoy = (await x.gestion({})).body as { id: string };
    expect((await x.http.delete(`/api/ventas/cobranzas/gestiones/${hoy.id}`)).status).toBe(200);
    const vieja = await prisma.gestionCobranza.create({ data: { empresaId: x.empresaId, terceroId: x.clienteRI.id, fecha: new Date('2026-11-05'), medio: 'MAIL', nota: 'x', creadoPor: 't', creadoEn: new Date('2026-11-05T12:00:00Z') } });
    const r = await x.http.delete(`/api/ventas/cobranzas/gestiones/${vieja.id}`);
    expect([r.status, r.body.message]).toEqual([400, 'Solo se eliminan gestiones del día']);
  });

  it('permisos', async () => {
    const x = await escenario();
    const ver = await otroUsuario(app, prisma, x.empresaId, ['venta.ver']);
    expect((await x.gestion({}, ver.http)).status).toBe(403);
    const gest = await otroUsuario(app, prisma, x.empresaId, ['cobranzas.gestionar']);
    expect((await x.gestion({}, gest.http)).status).toBe(201);
  });
});
