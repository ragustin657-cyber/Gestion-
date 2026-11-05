import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, otroUsuario, sesion } from './helpers';

const PERMISOS_COMPRADOR = ['oc.ver', 'oc.crear', 'oc.aprobar', 'oc.anular'] as const;

describe('órdenes de compra', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function preparar(permisos: string[] = [...PERMISOS_COMPRADOR]) {
    const s = await sesion(app, prisma, { permisos: permisos as never });
    const d = await datosCompras(prisma, s.empresa.id);
    const oc = (extra: object = {}) => ({
      terceroId: d.proveedorId, fecha: '2026-11-05', monedaCodigo: 'ARS',
      renglones: [{ articuloId: d.articuloId, descripcion: 'Tornillos', cantidad: 2, precioUnitario: 1000, alicuotaIva: 21 }],
      ...extra,
    });
    return { ...s, ...d, oc };
  }
  const limite = (empresaId: string, monto: number) =>
    prisma.empresa.update({ where: { id: empresaId }, data: { montoAprobacionOc: monto } });

  it('alta de borrador con totales y sin número', async () => {
    const { http, oc } = await preparar();
    const r = await http.post('/api/compras/ordenes', oc());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ estado: 'BORRADOR', numero: null, neto: '2000', iva: '420', total: '2420' });
    expect(r.body.renglones[0].importe).toBe('2000');
  });

  it('sin renglones o con cantidad 0 → 400', async () => {
    const { http, oc } = await preparar();
    const sin = await http.post('/api/compras/ordenes', oc({ renglones: [] }));
    expect(sin.status).toBe(400);
    expect(sin.body.message).toBe('La orden debe tener al menos un renglón');
    const cero = await http.post('/api/compras/ordenes', oc({ renglones: [{ descripcion: 'x', cantidad: 0, precioUnitario: 1, alicuotaIva: 21 }] }));
    expect(cero.status).toBe(400);
    expect(cero.body.campos['renglones.0.cantidad']).toBeDefined();
  });

  it('tercero que no es proveedor → 400', async () => {
    const { http, oc, empresa } = await preparar();
    const cli = await prisma.tercero.create({ data: { empresaId: empresa.id, codigo: 99, razonSocial: 'Cliente', cuit: '30719998883', condicionIva: 'RESPONSABLE_INSCRIPTO', esCliente: true } });
    const r = await http.post('/api/compras/ordenes', oc({ terceroId: cli.id }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El tercero no es un proveedor activo');
  });

  it('confirmar con límite 0 queda pendiente de aprobación con número 1', async () => {
    const { http, oc } = await preparar();
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const r = await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'PENDIENTE_APROBACION', numero: 1 });
  });

  it('bajo el límite se aprueba automáticamente y se audita', async () => {
    const { http, oc, empresa } = await preparar();
    await limite(empresa.id, 1000000);
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const r = await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version });
    expect(r.body).toMatchObject({ estado: 'APROBADA', aprobadoPor: null });
    const aud = await prisma.auditoria.findFirst({ where: { entidadId: b.id, accion: 'APROBAR' } });
    expect((aud!.datos as { automatica: boolean }).automatica).toBe(true);
  });

  it('OC en USD calcula totalPesos; sin cotización → 400', async () => {
    const { http, oc } = await preparar();
    const b = (await http.post('/api/compras/ordenes', oc({ monedaCodigo: 'USD' }))).body;
    const r = await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version });
    expect(r.body.totalPesos).toBe('2420000');
    const vieja = (await http.post('/api/compras/ordenes', oc({ monedaCodigo: 'USD', fecha: '2026-10-01' }))).body;
    const e = await http.post(`/api/compras/ordenes/${vieja.id}/confirmar`, { version: vieja.version });
    expect(e.status).toBe(400);
    expect(e.body.message).toBe('No hay cotización de USD para el 01/10/2026');
  });

  it('el creador no puede aprobar si hay otro aprobador; el otro sí', async () => {
    const { http, oc, empresa } = await preparar();
    const aprobador = await otroUsuario(app, prisma, empresa.id, ['oc.ver', 'oc.aprobar']);
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const r = await http.post(`/api/compras/ordenes/${b.id}/aprobar`, { version: c.version });
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('No puede aprobar una orden creada por usted');
    const ok = await aprobador.http.post(`/api/compras/ordenes/${b.id}/aprobar`, { version: c.version });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ estado: 'APROBADA', aprobadoPor: aprobador.usuario.id });
  });

  it('autoaprobación si es el único aprobador', async () => {
    const { http, oc } = await preparar();
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const r = await http.post(`/api/compras/ordenes/${b.id}/aprobar`, { version: c.version });
    expect(r.status).toBe(200);
    const aud = await prisma.auditoria.findFirst({ where: { entidadId: b.id, accion: 'APROBAR' } });
    expect((aud!.datos as { autoaprobacion: boolean }).autoaprobacion).toBe(true);
  });

  it('rechazar exige motivo y vuelve a borrador', async () => {
    const { http, oc } = await preparar();
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    expect((await http.post(`/api/compras/ordenes/${b.id}/rechazar`, { version: c.version })).status).toBe(400);
    const r = await http.post(`/api/compras/ordenes/${b.id}/rechazar`, { version: c.version, motivo: 'Precio alto' });
    expect(r.body).toMatchObject({ estado: 'BORRADOR', motivoRechazo: 'Precio alto' });
  });

  it('dos aprobaciones simultáneas: una 200 y otra 409', async () => {
    const { oc, empresa, http } = await preparar(['oc.ver', 'oc.crear']);
    const a1 = await otroUsuario(app, prisma, empresa.id, ['oc.ver', 'oc.aprobar']);
    const a2 = await otroUsuario(app, prisma, empresa.id, ['oc.ver', 'oc.aprobar']);
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const rs = await Promise.all([
      a1.http.post(`/api/compras/ordenes/${b.id}/aprobar`, { version: c.version }),
      a2.http.post(`/api/compras/ordenes/${b.id}/aprobar`, { version: c.version }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.status === 409)!.body.message).toBe('El comprobante fue modificado por otro usuario');
  });

  it('anular: borrador → 400; aprobada sin recepciones → ANULADA', async () => {
    const { http, oc, empresa } = await preparar();
    await limite(empresa.id, 1000000);
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    expect((await http.post(`/api/compras/ordenes/${b.id}/anular`, { version: b.version, motivo: 'x' })).status).toBe(400);
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const r = await http.post(`/api/compras/ordenes/${b.id}/anular`, { version: c.version, motivo: 'No se compra' });
    expect(r.body.estado).toBe('ANULADA');
  });

  it('cerrar una aprobada → CUMPLIDA', async () => {
    const { http, oc, empresa } = await preparar();
    await limite(empresa.id, 1000000);
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const c = (await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    expect((await http.post(`/api/compras/ordenes/${b.id}/cerrar`, { version: c.version })).body.estado).toBe('CUMPLIDA');
  });

  it('PATCH de confirmada → 400; borrador se modifica y se borra', async () => {
    const { http, oc } = await preparar();
    const b = (await http.post('/api/compras/ordenes', oc())).body;
    const m = await http.patch(`/api/compras/ordenes/${b.id}`, oc({ observaciones: 'Urgente' }));
    expect(m.body.observaciones).toBe('Urgente');
    const b2 = (await http.post('/api/compras/ordenes', oc())).body;
    expect((await http.delete(`/api/compras/ordenes/${b2.id}`)).status).toBe(200);
    await http.post(`/api/compras/ordenes/${b.id}/confirmar`, { version: m.body.version });
    const r = await http.patch(`/api/compras/ordenes/${b.id}`, oc());
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Solo se pueden modificar órdenes en borrador');
  });

  it('lista con filtro de estado y aislamiento entre empresas', async () => {
    const a = await preparar();
    const b = (await a.http.post('/api/compras/ordenes', a.oc())).body;
    expect((await a.http.get('/api/compras/ordenes?estado=BORRADOR')).body.total).toBe(1);
    const otra = await preparar();
    expect((await otra.http.get(`/api/compras/ordenes/${b.id}`)).status).toBe(404);
    expect((await otra.http.get('/api/compras/ordenes')).body.total).toBe(0);
  });
});
