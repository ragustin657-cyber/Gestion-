import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararBienes } from './helpers-bienes';
import { prepararVentas } from './helpers-ventas';

describe('pulido 17: bienes de uso', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('numeración atómica continúa la existente', async () => {
    const b = await prepararBienes(app, prisma);
    const rubro = await b.rubro('Rodados');
    await prisma.bienUso.create({ data: { empresaId: b.empresaId, numero: 7, descripcion: 'Viejo', rubroId: rubro.id, fechaAlta: new Date('2024-01-01T00:00:00Z'), valorOrigen: 100, vidaUtilMeses: 60, origen: 'INICIAL', creadoPor: 't' } });
    await prisma.talonario.deleteMany({ where: { empresaId: b.empresaId, tipoComprobante: 'BIEN_USO' } });
    // La migración deja el talonario en el máximo existente: lo simulamos para esta empresa nueva
    await prisma.talonario.create({ data: { empresaId: b.empresaId, tipoComprobante: 'BIEN_USO', puntoVenta: 0, ultimoNumero: 7 } });
    const alta = (descripcion: string) => b.http.post('/api/bienes-uso', { origen: 'MANUAL', descripcion, rubroId: rubro.id, fechaAlta: '2026-05-10', valorOrigen: 1000, cuentaContrapartidaId: b.cuentaCapital });
    const r = await alta('Uno');
    expect(r.body.numero).toBe(8);
    const [x, y] = await Promise.all([alta('Dos'), alta('Tres')]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(new Set([x.body.numero, y.body.numero]).size).toBe(2);
  });

  it('rubro con bienes no cambia sus cuentas', async () => {
    const b = await prepararBienes(app, prisma);
    const rubro = await b.rubro('Rodados');
    await b.facturaBien({ neto: 1000 });
    const datos = { nombre: rubro.nombre, cuentaOrigenId: rubro.cuentaOrigenId, cuentaAmortizacionId: rubro.cuentaAmortizacionId, cuentaGastoId: rubro.cuentaGastoId, vidaUtilMeses: 60 };
    const otra = await b.cuenta('5.2.08');
    expect((await b.http.put(`/api/bienes-uso/rubros/${rubro.id}`, { ...datos, cuentaGastoId: otra })).body.message).toBe('El rubro tiene bienes: no se pueden cambiar sus cuentas');
    expect((await b.http.put(`/api/bienes-uso/rubros/${rubro.id}`, { ...datos, vidaUtilMeses: 48 })).status).toBe(200);
    await prisma.bienUso.updateMany({ where: { empresaId: b.empresaId }, data: { estado: 'BAJA' } });
    expect((await b.http.put(`/api/bienes-uso/rubros/${rubro.id}`, { ...datos, cuentaGastoId: otra })).status).toBe(400);
  });

  it('venta de un bien en nota de débito', async () => {
    const v = await prepararVentas(app, prisma);
    const b = await prepararBienes(app, prisma, v);
    const { bien } = await b.facturaBien({ neto: 1200000 });
    await b.generar('2026-10');
    const f = await v.factura();
    const nd = await v.http.post('/api/ventas/comprobantes', { ...v.datos({ tipo: 'NOTA_DEBITO', comprobanteAsociadoId: f.id, fecha: '2026-11-03', fechaVencimiento: '2026-11-30', renglones: [{ bienUsoId: bien.id, descripcion: 'Camioneta', cantidad: 1, precioUnitario: 1000000, alicuota: 21 }] }), emitir: true });
    expect(nd.body.estado).toBe('AUTORIZADO');
    expect((await b.http.get(`/api/bienes-uso/${bien.id}`)).body).toMatchObject({ estado: 'BAJA', motivoBaja: 'VENTA', fechaBaja: '2026-11-03' });
  });

  it('facturación ve los bienes activos', async () => {
    const b = await prepararBienes(app, prisma);
    await b.facturaBien({ neto: 1000 });
    const u = await otroUsuario(app, prisma, b.empresaId, ['venta.emitir']);
    const r = await u.http.get('/api/bienes-uso?estado=ACTIVO');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });
});
