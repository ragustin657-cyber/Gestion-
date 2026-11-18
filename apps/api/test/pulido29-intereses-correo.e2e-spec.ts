import { INestApplication } from '@nestjs/common';
import { ZodError } from 'zod';
import { TransporteCorreo, TransporteMemoria } from '../src/correo/transporte';
import { PrismaService } from '../src/prisma/prisma.service';
import { esquemaComprobanteVenta } from '../src/ventas/comprobantes/dto';
import { AgendaCobranzasService } from '../src/ventas/cobranzas/agenda.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Nota { id: string; terceroId: string }
const CORREO = { servidor: 'smtp.prueba.local', puerto: 587, seguro: false, usuario: 'u', clave: 'clave-secreta-xyz', remitenteNombre: 'Cobranzas', remitenteEmail: 'cobranzas@demo.com', asunto: 'Resumen - {empresa}', cuerpo: 'Hola {cliente}' };

describe('pulido E29: intereses y correo', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let transporte: TransporteMemoria;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
    transporte = app.get(TransporteCorreo) as TransporteMemoria;
  });
  beforeEach(async () => { await limpiarBase(prisma); transporte.enviados.length = 0; transporte.fallarPara.clear(); });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    await v.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 5 });
    const octubre = (o: Record<string, unknown> = {}) => v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-10', ...o });
    const liquidar = () => v.http.post('/api/ventas/intereses', { anio: 2026, mes: 10 });
    const recibo = async (fc: { id: string }, importe: number, fecha: string) => {
      const r = await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha, puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe }, cheques: [], transferencias: [], retenciones: [], aplicaciones: [{ comprobanteId: fc.id, importe }] });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    };
    const renglones = async () => ((await v.http.get('/api/ventas/intereses?anio=2026&mes=10')).body.grupos as { renglones: { comprobanteId: string }[] }[]).flatMap((g) => g.renglones.map((r) => r.comprobanteId));
    return { ...v, octubre, liquidar, recibo, renglones };
  };

  it('nota eliminada muestra el cliente', async () => {
    const x = await escenario();
    await x.octubre();
    const n = ((await x.liquidar()).body.notas as Nota[])[0];
    await prisma.comprobanteVenta.update({ where: { id: n.id }, data: { estado: 'RECHAZADO', numero: null, cae: null } });
    await prisma.movimientoCuentaCorriente.deleteMany({ where: { origenTipo: 'VENTA', origenId: n.id } });
    expect((await x.http.delete(`/api/ventas/comprobantes/${n.id}`)).status).toBeLessThan(300);
    const [l] = (await x.http.get('/api/ventas/intereses/liquidaciones')).body as { notas: { estado: string; cliente: string }[] }[];
    expect([l.notas[0].estado, l.notas[0].cliente]).toEqual(['ELIMINADA', 'Distribuidora Norte SA']);
  });

  it('cálculo acotado', async () => {
    const x = await escenario();
    const pagada1 = await x.octubre();
    const pagada2 = await x.octubre({ fecha: '2026-10-02' });
    const pendiente = await x.octubre({ fecha: '2026-10-03' });
    const tarde = await x.octubre({ fecha: '2026-10-04' });
    await x.recibo(pagada1, 1210, '2026-10-15');
    await x.recibo(pagada2, 1210, '2026-10-15');
    await x.recibo(tarde, 1210, '2026-11-03');
    expect((await x.renglones()).sort()).toEqual([pendiente.id, tarde.id].sort());
  });

  it('configuraciones simultáneas', async () => {
    const x = await prepararVentas(app, prisma);
    const rs = await Promise.all([
      x.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 3 }),
      x.http.put('/api/ventas/intereses/configuracion', { tasaMensual: 4 }),
      x.http.put('/api/correo/configuracion', CORREO),
      x.http.put('/api/correo/configuracion', CORREO),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await prisma.configIntereses.count({ where: { empresaId: x.empresaId } })).toBe(1);
    expect(await prisma.configCorreo.count({ where: { empresaId: x.empresaId } })).toBe(1);
  });

  it('validación interna como 400', async () => {
    const x = await escenario();
    await x.octubre();
    // Ninguna entrada válida de la API llega hoy a romper el esquema: se simula el error de validación
    jest.spyOn(esquemaComprobanteVenta, 'safeParse').mockReturnValueOnce({ success: false, error: new ZodError([{ code: 'custom', path: ['renglones', 0, 'descripcion'], message: 'Descripción demasiado larga' }]) } as never);
    const r = await x.liquidar();
    expect([r.status, r.body.message]).toEqual([400, 'Distribuidora Norte SA: Descripción demasiado larga']);
  });

  it('auditoría del correo', async () => {
    const x = await prepararVentas(app, prisma);
    expect((await x.http.put('/api/correo/configuracion', CORREO)).status).toBe(200);
    const a = await prisma.auditoria.findMany({ where: { empresaId: x.empresaId, entidad: 'ConfigCorreo' } });
    expect(a.length).toBe(1);
    expect(JSON.stringify(a[0].datos)).not.toContain('clave-secreta-xyz');
    expect(JSON.stringify(a[0].datos)).not.toContain('claveCifrada');
    expect((a[0].datos as { servidor: string }).servidor).toBe('smtp.prueba.local');
  });

  it('masivo consulta una vez', async () => {
    const x = await prepararVentas(app, prisma);
    await x.http.put('/api/correo/configuracion', CORREO);
    await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { email: 'norte@x.com' });
    await x.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    const otro = (await x.http.post('/api/terceros', { esCliente: true, razonSocial: 'Otro SA', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO', email: 'otro@x.com' })).body as { id: string };
    await x.factura({ terceroId: otro.id, fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    const ficha = jest.spyOn(AgendaCobranzasService.prototype, 'ficha');
    const r = await x.http.post('/api/ventas/cobranzas/mail', { terceroIds: [x.clienteRI.id, otro.id] });
    expect([r.status, r.body.enviados.length]).toEqual([201, 2]);
    expect(ficha).toHaveBeenCalledTimes(2);
  });
});
