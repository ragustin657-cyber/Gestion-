import { INestApplication } from '@nestjs/common';
import { TransporteCorreo, TransporteMemoria } from '../src/correo/transporte';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('cobranzas: resumen por mail', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let transporte: TransporteMemoria;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
    transporte = app.get(TransporteCorreo) as TransporteMemoria;
  });
  beforeEach(async () => { await limpiarBase(prisma); transporte.enviados.length = 0; transporte.fallarPara.clear(); });
  afterAll(async () => app.close());

  const escenario = async (configurar = true) => {
    const v = await prepararVentas(app, prisma);
    if (configurar) await v.http.put('/api/correo/configuracion', { servidor: 'smtp.prueba.local', puerto: 587, seguro: false, usuario: 'u', clave: 'c', remitenteNombre: 'Cobranzas Demo', remitenteEmail: 'cobranzas@demo.com', asunto: 'Resumen de cuenta - {empresa}', cuerpo: 'Estimado/a {cliente}: vencido {vencido}, {diasAtraso} días, por vencer {porVencer}.' });
    await v.http.patch(`/api/terceros/${v.clienteRI.id}`, { email: 'cobranzas@norte.com' });
    await v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    const cliente = async (razonSocial: string, cuit: string, email: string | null) => (await v.http.post('/api/terceros', { esCliente: true, razonSocial, cuit, condicionIva: 'RESPONSABLE_INSCRIPTO', email })).body as { id: string };
    const gestiones = () => prisma.gestionCobranza.findMany({ where: { empresaId: v.empresaId } });
    return { ...v, cliente, gestiones };
  };

  it('previsualizar', async () => {
    const x = await escenario();
    const r = (await x.http.get(`/api/ventas/cobranzas/${x.clienteRI.id}/mail/previsualizar`)).body;
    expect(r.destinatario).toBe('cobranzas@norte.com');
    expect(r.cuerpo).toBe('Estimado/a Distribuidora Norte SA: vencido $ 1.210,00, 6 días, por vencer $ 0,00.');
    expect(r.asunto).toMatch(/^Resumen de cuenta - /);
  });

  it('envío individual', async () => {
    const x = await escenario();
    const r = await x.http.post(`/api/ventas/cobranzas/${x.clienteRI.id}/mail`, { cuerpo: 'Hola {cliente}, adjuntamos el resumen.' });
    expect([r.status, r.body.destinatario]).toEqual([201, 'cobranzas@norte.com']);
    const [m] = transporte.enviados;
    expect([m.para, m.texto, m.de, m.adjuntos.map((a) => a.nombre)]).toEqual(['cobranzas@norte.com', 'Hola Distribuidora Norte SA, adjuntamos el resumen.', '"Cobranzas Demo" <cobranzas@demo.com>', ['resumen-de-cuenta-distribuidora-norte-sa.pdf']]);
    expect(m.adjuntos[0].contenido.subarray(0, 4).toString()).toBe('%PDF');
    const g = await x.gestiones();
    expect(g.map((y) => [y.medio, y.nota])).toEqual([['MAIL', 'Resumen de cuenta enviado a cobranzas@norte.com']]);
  });

  it('falla del servidor', async () => {
    const x = await escenario();
    transporte.fallarPara.add('cobranzas@norte.com');
    const r = await x.http.post(`/api/ventas/cobranzas/${x.clienteRI.id}/mail`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('550');
    expect(await x.gestiones()).toEqual([]);
  });

  it('sin email', async () => {
    const x = await escenario();
    await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { email: '' });
    const r = await x.http.post(`/api/ventas/cobranzas/${x.clienteRI.id}/mail`, {});
    expect([r.status, r.body.message]).toEqual([400, 'El cliente no tiene email']);
  });

  it('masivo', async () => {
    const x = await escenario();
    const sinEmail = await x.cliente('Sin Email SA', '30-71234567-1', null);
    await x.factura({ terceroId: sinEmail.id, fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    const sinSaldo = await x.cliente('Sin Saldo SA', '30-70123456-8', 'saldo@x.com');
    const falla = await x.cliente('Falla SA', '30-71000000-6', 'falla@x.com');
    await x.factura({ terceroId: falla.id, fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    transporte.fallarPara.add('falla@x.com');
    const inexistente = '00000000-0000-4000-8000-000000000000';
    const r = await x.http.post('/api/ventas/cobranzas/mail', { terceroIds: [x.clienteRI.id, sinEmail.id, inexistente, sinSaldo.id, falla.id, x.clienteRI.id] });
    expect(r.status).toBe(201);
    expect(r.body.enviados.map((e: { destinatario: string }) => e.destinatario)).toEqual(['cobranzas@norte.com']);
    const motivos = Object.fromEntries((r.body.omitidos as { terceroId: string; motivo: string }[]).map((o) => [o.terceroId, o.motivo]));
    expect(motivos[sinEmail.id]).toBe('Sin email');
    expect(motivos[inexistente]).toBe('Cliente inexistente');
    expect(motivos[sinSaldo.id]).toBe('Sin saldo pendiente');
    expect(motivos[falla.id]).toContain('550');
    expect((await x.gestiones()).length).toBe(1);
  });

  it('tope y sin configuración', async () => {
    const x = await escenario();
    const muchos = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const r = await x.http.post('/api/ventas/cobranzas/mail', { terceroIds: muchos });
    expect([r.status, r.body.message]).toEqual([400, 'Se envían hasta 50 clientes por vez']);
    await prisma.configCorreo.deleteMany({ where: { empresaId: x.empresaId } });
    const s = await x.http.post(`/api/ventas/cobranzas/${x.clienteRI.id}/mail`, {});
    expect([s.status, s.body.message]).toEqual([400, 'Configure el correo de la empresa']);
  });

  it('permisos', async () => {
    const x = await escenario();
    const u = await otroUsuario(app, prisma, x.empresaId, ['venta.ver']);
    expect((await u.http.post(`/api/ventas/cobranzas/${x.clienteRI.id}/mail`, {})).status).toBe(403);
  });
});
