import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PadronService } from '../src/pagos/padron/padron.service';
import { crearApp, facturaPendiente, limpiarBase, sesion } from './helpers';
import { prepararPagos } from './helpers-pagos';

let numero = 90000;

describe('pagos: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('el mismo comprobante dos veces en una OP → 400', async () => {
    const p = await prepararPagos(app, prisma);
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const r = await p.http.post('/api/pagos/ordenes', { terceroId: p.proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: f.movimientoId, importe: 1210 }, { movimientoId: f.movimientoId, importe: 1210 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El comprobante figura más de una vez en la orden de pago');
  });

  it('pagar en dólares una OP sin cotización del dólar → 400', async () => {
    const p = await prepararPagos(app, prisma);
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    const r = await p.pagar(op, [{ tipo: 'EFECTIVO', monedaCodigo: 'USD', importe: 1210, cajaId: p.cajaUsd.id }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Para pagar en dólares, indique la cotización del dólar en la orden de pago');
  });

  it('OP con comprobantes en dólares y cotización 1 → 400', async () => {
    const p = await prepararPagos(app, prisma);
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    const r = await p.http.post('/api/pagos/ordenes', { terceroId: p.proveedorId, fecha: '2026-11-10', cotizacion: 1, imputaciones: [{ movimientoId: f.movimientoId, importe: 121 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cotización del dólar no es válida');
  });

  it('dos pagos simultáneos al mismo proveedor respetan el acumulado de Ganancias', async () => {
    const p = await prepararPagos(app, prisma, { regimen: '94' });
    const f1 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 53736 });
    const f2 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 53736 });
    const op1 = await p.opAprobada([{ movimientoId: f1.movimientoId, importe: 65020.56 }]);
    const op2 = await p.opAprobada([{ movimientoId: f2.movimientoId, importe: 65020.56 }]);
    // Ambos pagan el total asumiendo retención 0: solo uno puede acertar, el segundo debe retener 806,04
    const medio = [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 65020.56, cuentaBancariaId: p.ars.id }];
    const rs = await Promise.all([p.pagar(op1, medio), p.pagar(op2, medio)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('anular una OP con anticipo mientras otra lo aplica no deja el anticipo inconsistente', async () => {
    const p = await prepararPagos(app, prisma);
    const opA = await p.opAprobada([], { anticipo: { monedaCodigo: 'ARS', importe: 500 } });
    const pagadaA = (await p.pagar(opA, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 500, cuentaBancariaId: p.ars.id }])).body;
    const ant = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'ANTICIPO' } });
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const opB = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }, { movimientoId: ant.id, importe: -500 }]);
    await Promise.all([
      p.pagar(opB, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 710, cuentaBancariaId: p.ars.id }]),
      p.http.post(`/api/pagos/ordenes/${pagadaA.id}/anular`, { version: pagadaA.version, motivo: 'carrera' }),
    ]);
    const a = await prisma.ordenPago.findUniqueOrThrow({ where: { id: pagadaA.id } });
    const b = await prisma.ordenPago.findUniqueOrThrow({ where: { id: opB.id } });
    expect(a.estado === 'ANULADA' && b.estado === 'PAGADA').toBe(false);
  });

  it('anular una factura mientras se paga no deja pagos aplicados a una factura anulada', async () => {
    const p = await prepararPagos(app, prisma);
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    await Promise.all([
      p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1210, cuentaBancariaId: p.ars.id }]),
      p.http.post(`/api/compras/comprobantes/${f.comprobanteId}/anular`, { motivo: 'carrera' }),
    ]);
    const c = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: f.comprobanteId } });
    const o = await prisma.ordenPago.findUniqueOrThrow({ where: { id: op.id } });
    expect(c.estado === 'ANULADO' && o.estado === 'PAGADA').toBe(false);
  });

  it('las retenciones no pueden igualar o superar el total a cancelar', async () => {
    const p = await prepararPagos(app, prisma, { iibb: 3 });
    const base = { terceroId: p.proveedorId, letra: 'A', puntoVenta: 1, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS' };
    const fc = await p.http.post('/api/compras/comprobantes', { ...base, tipo: 'FACTURA', numero: ++numero, totalDeclarado: 2000, renglones: [{ origen: 'DIRECTO', descripcion: 'Exento', cantidad: 1, precioUnitario: 2000, alicuotaIva: 0 }] });
    const nc = await p.http.post('/api/compras/comprobantes', { ...base, tipo: 'NOTA_CREDITO', numero: ++numero, totalDeclarado: 1990, renglones: [{ origen: 'DIRECTO', descripcion: 'Bonif', cantidad: 1, precioUnitario: 1644.63, alicuotaIva: 21 }] });
    const mov = async (id: string) => (await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: id } })).id;
    const b = (await p.http.post('/api/pagos/ordenes', { terceroId: p.proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: await mov(fc.body.id), importe: 2000 }, { movimientoId: await mov(nc.body.id), importe: -1990 }] })).body;
    const r = await p.http.post(`/api/pagos/ordenes/${b.id}/confirmar`, { version: b.version });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Las retenciones superan el importe a pagar');
  });

  describe('padrones', () => {
    const FIX = `${__dirname}/fixtures`;
    const esperar = async (id: string) => {
      for (let i = 0; i < 50; i++) {
        const c = await prisma.padronCarga.findUniqueOrThrow({ where: { id } });
        if (c.estado !== 'PROCESANDO') return c;
        await new Promise((res) => setTimeout(res, 100));
      }
      throw new Error('no terminó');
    };

    it('solo el administrador general carga padrones', async () => {
      const admin = await sesion(app, prisma, { permisos: ['retenciones.config', 'empresa.administrar'] });
      const r = await request(app.getHttpServer()).post('/api/padrones').set('Authorization', `Bearer ${admin.token}`).field('jurisdiccion', '902').attach('archivo', `${FIX}/padron-arba.txt`);
      expect(r.status).toBe(403);
      const sa = await sesion(app, prisma, { superadmin: true });
      const ok = await request(app.getHttpServer()).post('/api/padrones').set('Authorization', `Bearer ${sa.token}`).field('jurisdiccion', '902').attach('archivo', `${FIX}/padron-arba.txt`);
      expect(ok.status).toBe(202);
      await esperar(ok.body.id);
    });

    it('cargar el archivo de percepciones no borra las alícuotas de retención del mismo período', async () => {
      const padron = app.get(PadronService);
      const r = await prisma.padronCarga.create({ data: { jurisdiccion: '902', archivo: 'r', creadoPor: 't' } });
      await padron.procesar(r.id, '902', Buffer.from('R;01102026;01112026;30112026;30700123452;D;N;N;1,75;0\n'));
      const pc = await prisma.padronCarga.create({ data: { jurisdiccion: '902', archivo: 'p', creadoPor: 't' } });
      await padron.procesar(pc.id, '902', Buffer.from('P;01102026;01112026;30112026;30700123452;D;N;N;2,00;0\n'));
      expect(await padron.alicuotaRetencion('902', '30700123452', new Date('2026-11-15T00:00:00Z'))).toBe('1.75');
      expect(await prisma.padronIibb.count()).toBe(1);
    });

    it('una carga en proceso de la misma jurisdicción bloquea otra; al reiniciar, las colgadas quedan en error', async () => {
      const sa = await sesion(app, prisma, { superadmin: true });
      await prisma.padronCarga.create({ data: { jurisdiccion: '902', archivo: 'colgada', creadoPor: 't' } });
      const r = await request(app.getHttpServer()).post('/api/padrones').set('Authorization', `Bearer ${sa.token}`).field('jurisdiccion', '902').attach('archivo', `${FIX}/padron-arba.txt`);
      expect(r.status).toBe(409);
      expect(r.body.message).toBe('Ya hay un padrón de esa jurisdicción en proceso');
      await (app.get(PadronService) as unknown as { onModuleInit(): Promise<void> }).onModuleInit();
      expect((await prisma.padronCarga.findFirstOrThrow({ where: { archivo: 'colgada' } })).estado).toBe('ERROR');
    });
  });
});
