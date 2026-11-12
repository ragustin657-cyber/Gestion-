import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion, sesionConPlan } from './helpers';

describe('configuración de compras', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('una empresa nueva tiene los 35 conceptos y modo AVISAR', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.get('/api/compras/config');
    expect(r.status).toBe(200);
    expect(r.body.modoTresVias).toBe('AVISAR');
    expect(r.body.montoAprobacionOc).toBe('0');
    expect(r.body.cuentas.map((c: { concepto: string }) => c.concepto).sort()).toEqual(
      ['ANTICIPOS_PROVEEDORES', 'BAJAS_BIENES_USO', 'CHEQUES_DIFERIDOS', 'CHEQUES_RECHAZADOS', 'COSTO_MERCADERIAS_VENDIDAS', 'DEUDORES_POR_VENTAS', 'DIFERENCIAS_DE_CAJA', 'DIFERENCIA_CAMBIO_NEGATIVA',
        'DIFERENCIA_CAMBIO_POSITIVA', 'FALTANTES_INVENTARIO', 'GASTOS_BANCARIOS', 'GASTO_POR_DEFECTO', 'IMPUESTOS_INTERNOS', 'IVA_CREDITO_FISCAL', 'IVA_DEBITO_FISCAL', 'MERCADERIAS', 'MERCADERIA_A_FACTURAR', 'PERCEPCION_IIBB', 'PERCEPCION_IVA',
        'PROVEEDORES', 'RECPAM', 'RESULTADOS_NO_ASIGNADOS', 'RESULTADO_DEL_EJERCICIO', 'RESULTADO_VENTA_BIENES_USO', 'RETENCION_GANANCIAS', 'RETENCION_IIBB', 'RETENCION_SUFRIDA_GANANCIAS', 'RETENCION_SUFRIDA_IIBB', 'RETENCION_SUFRIDA_IVA', 'RETENCION_SUFRIDA_SUSS',
        'SOBRANTES_INVENTARIO', 'TRANSFERENCIAS_A_ACREDITAR', 'VALORES_A_DEPOSITAR', 'VALORES_EN_TRANSITO', 'VENTAS'],
    );
  });

  it('PATCH persiste monto límite y tolerancias', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.patch('/api/compras/config', { montoAprobacionOc: 500000, toleranciaPrecioPct: 3, modoTresVias: 'BLOQUEAR' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ montoAprobacionOc: '500000', toleranciaPrecioPct: '3', modoTresVias: 'BLOQUEAR' });
    expect((await http.patch('/api/compras/config', { toleranciaPrecioPct: -1 })).status).toBe(400);
  });

  it('PUT cuentas con cuenta no imputable → 400; imputable → 200', async () => {
    const { http, cuenta } = await sesionConPlan(app, prisma);
    const mala = await http.put('/api/compras/config/cuentas', [{ concepto: 'PROVEEDORES', cuentaContableId: await cuenta('2.1.01') }]);
    expect(mala.status).toBe(400);
    const ok = await http.put('/api/compras/config/cuentas', [{ concepto: 'PROVEEDORES', cuentaContableId: await cuenta('2.1.01.002') }]);
    expect(ok.status).toBe(200);
    const c = (await http.get('/api/compras/config')).body.cuentas.find((x: { concepto: string }) => x.concepto === 'PROVEEDORES');
    expect(c.cuentaContableId).toBe(await cuenta('2.1.01.002'));
  });

  it('sin compras.config → 403', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['oc.crear'] });
    expect((await http.get('/api/compras/config')).status).toBe(403);
  });

  it('el rol Administrador de una empresa nueva incluye oc.anular', async () => {
    const { empresaId } = await sesionConPlan(app, prisma);
    const rol = await prisma.rol.findFirstOrThrow({ where: { empresaId, nombre: 'Administrador' } });
    expect(rol.permisos).toContain('oc.anular');
  });
});
