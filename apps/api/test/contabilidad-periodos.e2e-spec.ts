import { INestApplication } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';

describe('ejercicios, períodos y control de fechas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('una empresa nueva tiene el ejercicio 1 con sus 12 meses abiertos, que contiene hoy', async () => {
    const s = await sesionConPlan(app, prisma);
    const r = await s.http.get('/api/contabilidad/ejercicios');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    const e = r.body[0];
    const hoy = hoyEn(ZONA_ARGENTINA);
    expect(e).toMatchObject({ numero: 1, estado: 'ABIERTO' });
    expect(e.desde.slice(0, 10) <= hoy && e.hasta.slice(0, 10) >= hoy).toBe(true);
    expect(e.periodos).toHaveLength(12);
    expect(e.periodos.every((p: { estado: string }) => p.estado === 'ABIERTO')).toBe(true);
  });

  it('un comprobante con fecha sin ejercicio o en un mes cerrado se rechaza sin grabar nada', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const fuera = await s.http.post('/api/compras/comprobantes', {
      terceroId: proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: 1, fechaEmision: '2025-12-10', fechaContable: '2025-12-10', monedaCodigo: 'ARS',
      totalDeclarado: 121, renglones: [{ origen: 'DIRECTO', descripcion: 'x', cantidad: 1, precioUnitario: 100, alicuotaIva: 21 }],
    });
    expect(fuera.status).toBe(400);
    expect(fuera.body.message).toBe('No hay un ejercicio contable para la fecha 10/12/2025');
    expect(await prisma.movimientoCuentaCorriente.count()).toBe(0);
    await prisma.periodoContable.updateMany({ where: { empresaId: s.empresaId, anio: 2026, mes: 10 }, data: { estado: 'CERRADO' } });
    await expect(facturaPendiente(s.http, prisma, { proveedorId, neto: 100, fecha: '2026-10-15' })).rejects.toThrow('El período 10/2026 está cerrado');
    expect(await prisma.comprobanteCompra.count()).toBe(0);
    // Un mes abierto funciona
    await facturaPendiente(s.http, prisma, { proveedorId, neto: 100, fecha: '2026-11-02' });
    const asiento = await prisma.asiento.findFirstOrThrow();
    expect(asiento.ejercicioId).toBeTruthy();
    expect(asiento.tipo).toBe('AUTOMATICO');
  });

  it('abrir el ejercicio siguiente: como máximo dos abiertos', async () => {
    const s = await sesionConPlan(app, prisma);
    const r = await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    expect(r.status).toBe(201);
    expect(r.body.numero).toBe(2);
    const tercero = await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    expect(tercero.status).toBe(400);
    expect(tercero.body.message).toBe('Ya hay dos ejercicios abiertos: cierre el anterior primero');
  });

  it('no se cambia el inicio del ejercicio con asientos; otra empresa no ve los ejercicios', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    expect((await s.http.patch('/api/empresas/actual', { inicioEjercicioMes: 7 })).status).toBe(200);
    // Sin asientos el cambio rehace el ejercicio vacío
    const e = (await s.http.get('/api/contabilidad/ejercicios')).body[0];
    expect(new Date(e.desde).getUTCMonth()).toBe(6);
    await facturaPendiente(s.http, prisma, { proveedorId, neto: 100, fecha: '2026-11-02' });
    const r = await s.http.patch('/api/empresas/actual', { inicioEjercicioMes: 1 });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('No se puede cambiar el inicio del ejercicio con ejercicios en uso');
    const otra = await sesionConPlan(app, prisma);
    expect((await otra.http.get('/api/contabilidad/ejercicios')).body.map((x: { id: string }) => x.id)).not.toContain(e.id);
  });
});
