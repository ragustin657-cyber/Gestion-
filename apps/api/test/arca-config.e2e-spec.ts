import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { certificadoDePrueba } from '../src/arca/certificado-prueba';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('configuración de factura electrónica ARCA', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const subir = (token: string, c: { crt: string; key: string }) =>
    request(app.getHttpServer()).post('/api/arca/certificado').set({ Authorization: `Bearer ${token}` })
      .attach('certificado', Buffer.from(c.crt), 'empresa.crt').attach('clave', Buffer.from(c.key), 'empresa.key');

  it('ambiente, certificado y prueba de conexión', async () => {
    const { http, token, empresaId } = await sesionConPlan(app, prisma);
    expect((await http.get('/api/arca/config')).body).toMatchObject({ ambiente: 'SIMULADO', tieneCertificado: false });
    expect((await http.post('/api/arca/probar', {})).body).toMatchObject({ ok: true });

    expect((await http.put('/api/arca/config', { ambiente: 'HOMOLOGACION' })).status).toBe(200);
    const sinCert = await http.post('/api/arca/probar', {});
    expect(sinCert.status).toBe(400);
    expect(sinCert.body.message).toBe('La empresa no tiene certificado de ARCA cargado');

    const ajeno = await subir(token, certificadoDePrueba('20172543597'));
    expect(ajeno.status).toBe(400);
    expect(ajeno.body.message).toBe('El certificado es de otro CUIT (20-17254359-7)');

    const propio = certificadoDePrueba('30712345671');
    const cruzado = await subir(token, { crt: propio.crt, key: certificadoDePrueba('30712345671').key });
    expect(cruzado.status).toBe(400);
    expect(cruzado.body.message).toBe('El certificado no corresponde a la clave privada');

    const ok = await subir(token, propio);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ tieneCertificado: true, certificadoSujeto: expect.stringContaining('gestion-test'), venceProximo: false });
    const guardada = await prisma.configArca.findFirstOrThrow({ where: { empresaId } });
    expect(guardada.certificadoCifrado).not.toContain('BEGIN CERTIFICATE');
    expect(guardada.claveCifrada).not.toContain('PRIVATE KEY');
  });

  it('certificado vencido o por vencer', async () => {
    const { http, token, empresaId } = await sesionConPlan(app, prisma);
    expect((await subir(token, certificadoDePrueba('30712345671', 20))).body.venceProximo).toBe(true);
    await prisma.configArca.updateMany({ where: { empresaId }, data: { ambiente: 'HOMOLOGACION', certificadoVence: new Date('2026-05-10T12:00:00Z') } });
    const r = await http.post('/api/arca/probar', {});
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El certificado de ARCA venció el 10/05/2026');
  });

  it('requiere permiso', async () => {
    const { empresaId } = await sesionConPlan(app, prisma);
    const otro = await otroUsuario(app, prisma, empresaId, ['venta.ver']);
    expect((await otro.http.get('/api/arca/config')).status).toBe(403);
  });
});
