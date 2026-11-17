import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('comisiones: maestro de vendedores', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    const emp = await s.empleado();
    const prov = (await s.http.post('/api/terceros', { esProveedor: true, razonSocial: 'Ruiz SRL', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' }));
    if (prov.status !== 201) throw new Error(JSON.stringify(prov.body));
    const cli = (await s.http.post('/api/terceros', { esCliente: true, razonSocial: 'Cliente SA', cuit: '20-17254359-7', condicionIva: 'RESPONSABLE_INSCRIPTO' })).body as { id: string };
    return { ...s, emp, prov: prov.body as { id: string }, cli };
  };

  it('alta de vendedores', async () => {
    const x = await escenario();
    expect((await x.http.post('/api/ventas/vendedores', { nombre: 'Pérez', tipo: 'EMPLEADO', porcentaje: 3, empleadoId: x.emp.id })).status).toBe(201);
    expect((await x.http.post('/api/ventas/vendedores', { nombre: 'Ruiz SRL', tipo: 'EXTERNO', porcentaje: 5, proveedorId: x.prov.id })).status).toBe(201);
    const l = (await x.http.get('/api/ventas/vendedores')).body as { nombre: string; porcentaje: string; activo: boolean }[];
    expect(l.map((v) => [v.nombre, v.porcentaje, v.activo])).toEqual([['Pérez', '3.00', true], ['Ruiz SRL', '5.00', true]]);
  });

  it('validaciones', async () => {
    const x = await escenario();
    const post = (d: object) => x.http.post('/api/ventas/vendedores', d);
    expect((await post({ nombre: 'A', tipo: 'EMPLEADO', porcentaje: 3 })).status).toBe(400);
    const noProv = await post({ nombre: 'B', tipo: 'EXTERNO', porcentaje: 3, proveedorId: x.cli.id });
    expect([noProv.status, noProv.body.message]).toEqual([400, 'El tercero no es proveedor']);
    await post({ nombre: 'Pérez', tipo: 'EMPLEADO', porcentaje: 3, empleadoId: x.emp.id });
    const mismo = await post({ nombre: 'Otro', tipo: 'EMPLEADO', porcentaje: 3, empleadoId: x.emp.id });
    expect([mismo.status, mismo.body.message]).toEqual([400, 'El empleado ya es vendedor']);
    const nombre = await post({ nombre: 'Pérez', tipo: 'EXTERNO', porcentaje: 3, proveedorId: x.prov.id });
    expect([nombre.status, nombre.body.message]).toEqual([400, 'Ya existe el vendedor Pérez']);
    expect((await post({ nombre: 'C', tipo: 'EXTERNO', porcentaje: 120, proveedorId: x.prov.id })).status).toBe(400);
  });

  it('empresa nueva trae el concepto de comisiones configurado', async () => {
    const x = await escenario();
    const c = await prisma.concepto.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '210' } });
    expect([c.nombre, c.tipo, c.clase, c.activo]).toEqual(['Comisiones', 'FIJO', 'NO_REMUNERATIVO', true]);
    expect((await x.http.get('/api/sueldos/configuracion')).body.conceptoComisionesId).toBe(c.id);
  });

  it('concepto de comisiones inválido', async () => {
    const x = await escenario();
    const cfg = (await x.http.get('/api/sueldos/configuracion')).body;
    const desc = await prisma.concepto.findFirstOrThrow({ where: { empresaId: x.empresaId, codigo: '520' } });
    const body = { cuentaSueldosId: cfg.cuentaSueldosId, cuentaContribucionesId: cfg.cuentaContribucionesId, cuentaSueldosAPagarId: cfg.cuentaSueldosAPagarId, cuentaCargasSocialesId: cfg.cuentaCargasSocialesId, cuentaRetencionesSindicalesId: cfg.cuentaRetencionesSindicalesId };
    const r = await x.http.put('/api/sueldos/configuracion', { ...body, conceptoComisionesId: desc.id });
    expect([r.status, r.body.message]).toEqual([400, 'Concepto de comisiones inválido: debe ser fijo, activo y no de descuento']);
    const sin = await x.http.put('/api/sueldos/configuracion', body);
    expect(sin.status).toBe(200);
    expect(sin.body.conceptoComisionesId).toBe(cfg.conceptoComisionesId);
  });

  it('permisos', async () => {
    const x = await escenario();
    const u = await otroUsuario(app, prisma, x.empresaId, ['venta.ver']);
    expect((await u.http.get('/api/ventas/vendedores')).status).toBe(200);
    expect((await u.http.post('/api/ventas/vendedores', { nombre: 'X', tipo: 'EMPLEADO', porcentaje: 1, empleadoId: x.emp.id })).status).toBe(403);
  });
});
