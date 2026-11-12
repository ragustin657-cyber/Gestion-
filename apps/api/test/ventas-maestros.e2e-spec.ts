import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('ventas: maestros y configuración inicial', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('conceptos contables de ventas y retenciones sufridas', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    const cuentas = (await http.get('/api/compras/config')).body.cuentas as { concepto: string; cuentaContableId: string }[];
    expect(cuentas).toHaveLength(35);
    const codigo = async (c: string) => (await prisma.cuentaContable.findUniqueOrThrow({ where: { id: cuentas.find((x) => x.concepto === c)!.cuentaContableId } })).codigo;
    expect(await codigo('VENTAS')).toBe('4.1.01');
    expect(await codigo('IVA_DEBITO_FISCAL')).toBe('2.1.02.001');
    expect(await codigo('RETENCION_SUFRIDA_IIBB')).toBe('1.1.03.007');
    expect(empresaId).toBeTruthy();
  });

  it('una empresa nueva queda en ARCA simulado y su Administrador tiene los permisos de ventas', async () => {
    const { empresaId } = await sesionConPlan(app, prisma);
    expect((await prisma.configArca.findFirstOrThrow({ where: { empresaId } })).ambiente).toBe('SIMULADO');
    const rol = await prisma.rol.findFirstOrThrow({ where: { empresaId, nombre: 'Administrador' } });
    expect(rol.permisos).toEqual(expect.arrayContaining(['venta.emitir', 'cobro.registrar', 'venta.ver', 'arca.configurar']));
  });

  it('tipo de documento del cliente', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const alta = (d: object) => http.post('/api/terceros', { razonSocial: 'Cliente', condicionIva: 'CONSUMIDOR_FINAL', esCliente: true, ...d });
    const dni = await alta({ tipoDocumento: 'DNI', cuit: '30123456' });
    expect(dni.status).toBe(201);
    expect(dni.body.tipoDocumento).toBe('DNI');
    const corto = await alta({ tipoDocumento: 'DNI', cuit: '123' });
    expect(corto.status).toBe(400);
    expect(JSON.stringify(corto.body.campos)).toContain('cuit');
    expect((await alta({ tipoDocumento: 'OTRO', cuit: 'Consumidor final' })).status).toBe(201);
    expect((await alta({ cuit: '20-12345678-0' })).status).toBe(400);
    const cuit = await alta({ cuit: '20-17254359-7' });
    expect(cuit.status).toBe(201);
    expect(cuit.body.tipoDocumento).toBe('CUIT');
  });

  it('punto de venta electrónico y sucursal', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    const suc = await prisma.sucursal.findFirstOrThrow({ where: { empresaId } });
    const r = await http.post('/api/empresas/actual/puntos-venta', { numero: 3, descripcion: 'Web', electronico: true, sucursalId: suc.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ electronico: true, sucursalId: suc.id });
    expect((await http.post('/api/empresas/actual/puntos-venta', { numero: 4 })).body.electronico).toBe(true);
  });
});
