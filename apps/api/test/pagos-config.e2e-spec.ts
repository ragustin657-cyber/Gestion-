import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, sesion, sesionConPlan } from './helpers';

describe('configuración de pagos y retenciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('una empresa nueva tiene regímenes, escala, jurisdicciones y conceptos contables', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const reg = (await http.get('/api/pagos/config/regimenes')).body;
    expect(reg.map((r: { codigo: string }) => r.codigo).sort()).toEqual(['110', '116', '78', '94']);
    expect(reg.find((r: { codigo: string }) => r.codigo === '94')).toMatchObject({ minimoNoSujeto: '67170', verificar: true });
    expect((await http.get('/api/pagos/config/escala')).body).toHaveLength(8);
    const jur = (await http.get('/api/pagos/config/jurisdicciones')).body;
    expect(jur.find((j: { jurisdiccion: string }) => j.jurisdiccion === '902')).toMatchObject({ usaPadron: true, sinPadron: 'NO_RETENER' });
    expect(jur.find((j: { jurisdiccion: string }) => j.jurisdiccion === '904')).toMatchObject({ usaPadron: false, sinPadron: 'ALICUOTA_DEFECTO' });
    expect((await http.get('/api/compras/config')).body.cuentas).toHaveLength(35);
  });

  it('monto límite de OP', async () => {
    const { http } = await sesionConPlan(app, prisma);
    expect((await http.get('/api/pagos/config')).body.montoAprobacionOp).toBe('0');
    const r = await http.patch('/api/pagos/config', { montoAprobacionOp: 500000 });
    expect(r.body.montoAprobacionOp).toBe('500000');
  });

  it('escala con tramos no contiguos → 400', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.put('/api/pagos/config/escala', [
      { desde: 0, hasta: 8000, fijo: 0, porcentaje: 5 },
      { desde: 9000, hasta: null, fijo: 400, porcentaje: 9 },
    ]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La escala debe tener tramos contiguos y crecientes');
    const ok = await http.put('/api/pagos/config/escala', [
      { desde: 0, hasta: 8000, fijo: 0, porcentaje: 5 },
      { desde: 8000, hasta: null, fijo: 400, porcentaje: 9 },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(2);
  });

  it('editar un régimen apaga la advertencia de verificar', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r94 = (await http.get('/api/pagos/config/regimenes')).body.find((r: { codigo: string }) => r.codigo === '94');
    const r = await http.patch(`/api/pagos/config/regimenes/${r94.id}`, { minimoNoSujeto: 70000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ minimoNoSujeto: '70000', verificar: false });
  });

  it('jurisdicciones: PUT actualiza', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.put('/api/pagos/config/jurisdicciones', [{ jurisdiccion: '904', alicuotaDefecto: 2.5, minimoRetencion: 100, usaPadron: false, sinPadron: 'ALICUOTA_DEFECTO' }]);
    expect(r.status).toBe(200);
    expect(r.body.find((j: { jurisdiccion: string }) => j.jurisdiccion === '904')).toMatchObject({ alicuotaDefecto: '2.5', minimoRetencion: '100' });
  });

  it('sin retenciones.config → 403; el Administrador nuevo tiene op.anular', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['op.ver'] });
    expect((await http.patch('/api/pagos/config', { montoAprobacionOp: 1 })).status).toBe(403);
    const { empresaId } = await sesionConPlan(app, prisma);
    const rol = await prisma.rol.findFirstOrThrow({ where: { empresaId, nombre: 'Administrador' } });
    expect(rol.permisos).toEqual(expect.arrayContaining(['op.anular', 'retenciones.config', 'op.ver']));
  });

  it('el proveedor guarda inscriptoGanancias', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, empresaId);
    const r = await http.patch(`/api/terceros/${proveedorId}`, { inscriptoGanancias: false });
    expect(r.body.inscriptoGanancias).toBe(false);
  });
});
