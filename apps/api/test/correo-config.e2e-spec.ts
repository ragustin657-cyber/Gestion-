import { INestApplication } from '@nestjs/common';
import { descifrar } from '../src/arca/cifrado';
import { TransporteCorreo, TransporteMemoria } from '../src/correo/transporte';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('correo: configuración', () => {
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

  const datos = (o: Record<string, unknown> = {}) => ({
    servidor: 'smtp.prueba.local', puerto: 587, seguro: false, usuario: 'cobranzas@demo.com', remitenteNombre: 'Cobranzas Demo', remitenteEmail: 'cobranzas@demo.com',
    asunto: 'Resumen de cuenta - {empresa}', cuerpo: 'Hola {cliente}', ...o,
  });

  it('guardar y leer sin la clave', async () => {
    const s = await sesionConPlan(app, prisma);
    expect((await s.http.put('/api/correo/configuracion', datos({ clave: 'secreta' }))).status).toBe(200);
    const r = await s.http.get('/api/correo/configuracion');
    expect(JSON.stringify(r.body)).not.toContain('secreta');
    expect(r.body).toMatchObject({ servidor: 'smtp.prueba.local', claveCargada: true });
    const c = await prisma.configCorreo.findFirstOrThrow({ where: { empresaId: s.empresaId } });
    expect(c.claveCifrada.startsWith('v1:')).toBe(true);
    expect(c.claveCifrada).not.toContain('secreta');
  });

  it('clave vacía conserva la anterior', async () => {
    const s = await sesionConPlan(app, prisma);
    await s.http.put('/api/correo/configuracion', datos({ clave: 'secreta' }));
    expect((await s.http.put('/api/correo/configuracion', datos({ servidor: 'otro.local' }))).status).toBe(200);
    const c = await prisma.configCorreo.findFirstOrThrow({ where: { empresaId: s.empresaId } });
    expect([c.servidor, descifrar(c.claveCifrada)]).toEqual(['otro.local', 'secreta']);
  });

  it('sin clave maestra', async () => {
    const s = await sesionConPlan(app, prisma);
    const previa = process.env.ARCA_CLAVE_MAESTRA;
    delete process.env.ARCA_CLAVE_MAESTRA;
    try {
      const r = await s.http.put('/api/correo/configuracion', datos({ clave: 'secreta' }));
      expect([r.status, r.body.message]).toEqual([400, 'El servidor no tiene configurada la clave de cifrado (ARCA_CLAVE_MAESTRA): no se puede guardar la clave del correo']);
    } finally {
      process.env.ARCA_CLAVE_MAESTRA = previa;
    }
  });

  it('envío de prueba', async () => {
    const s = await sesionConPlan(app, prisma);
    await s.http.put('/api/correo/configuracion', datos({ clave: 'secreta' }));
    expect((await s.http.post('/api/correo/prueba', { destinatario: 'a@b.com' })).status).toBe(201);
    expect(transporte.enviados.map((m) => [m.para, m.de])).toEqual([['a@b.com', { nombre: 'Cobranzas Demo', email: 'cobranzas@demo.com' }]]);
    transporte.fallarPara.add('x@y.com');
    const r = await s.http.post('/api/correo/prueba', { destinatario: 'x@y.com' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('550');
  });

  it('plantillas por defecto', async () => {
    const s = await sesionConPlan(app, prisma);
    const r = await s.http.get('/api/correo/configuracion');
    expect(r.body).toMatchObject({ servidor: null, asunto: 'Resumen de cuenta - {empresa}', claveCargada: false });
  });

  it('permisos', async () => {
    const s = await sesionConPlan(app, prisma);
    const u = await otroUsuario(app, prisma, s.empresaId, ['cobranzas.gestionar']);
    expect((await u.http.get('/api/correo/configuracion')).status).toBe(403);
  });

  it('revisión: no se permite apuntar a la red interna ni a puertos que no son de correo', async () => {
    const s = await sesionConPlan(app, prisma);
    for (const servidor of ['127.0.0.1', '10.0.0.5', '169.254.169.254', 'localhost', '192.168.1.10']) {
      const r = await s.http.put('/api/correo/configuracion', datos({ servidor, clave: 'x' }));
      expect([servidor, r.status, r.body.message]).toEqual([servidor, 400, 'Servidor de correo no permitido: use un servidor público']);
    }
    const p = await s.http.put('/api/correo/configuracion', datos({ puerto: 5432, clave: 'x' }));
    expect(p.status).toBe(400);
  });
});
