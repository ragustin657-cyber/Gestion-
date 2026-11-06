import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { validarCuit } from '@gestion/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { readFileSync } from 'node:fs';
import { ARCHIVO_EXTRACTO_DEMO, sembrarCompleto } from '../src/seed/demo-completo';
import { parsearExtracto, FormatoParseo } from '../src/conciliacion/interprete';
import { limpiarBase } from './helpers';

describe('seed demo', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await mod.init();
    prisma = app.get(PrismaService);
    await limpiarBase(prisma);
  });
  afterAll(async () => app.close());

  it('crea la empresa demo con maestros y circuito de compras; es idempotente', async () => {
    expect(await sembrarCompleto(app)).toBe('creada');
    expect(await sembrarCompleto(app)).toBe('existente');

    const terceros = await prisma.tercero.findMany();
    expect(terceros).toHaveLength(11);
    for (const t of terceros.filter((x) => x.tipoDocumento === 'CUIT')) expect(validarCuit(t.cuit)).toBe(true);
    expect(await prisma.articulo.count()).toBe(10);
    expect(await prisma.rol.count()).toBe(7);
    expect(await prisma.usuario.findUnique({ where: { email: 'aprobador@demo.com' } })).not.toBeNull();

    const ocs = await prisma.ordenCompra.findMany();
    expect(ocs).toHaveLength(5);
    expect(new Set(ocs.map((o) => o.estado))).toEqual(new Set(['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'PARCIALMENTE_RECIBIDA', 'CUMPLIDA']));
    expect(await prisma.comprobanteCompra.count()).toBe(3);

    expect(await prisma.usuario.findUnique({ where: { email: 'tesorero@demo.com' } })).not.toBeNull();
    const ops = await prisma.ordenPago.findMany();
    expect(new Set(ops.map((o) => o.estado))).toEqual(new Set(['PAGADA', 'APROBADA', 'PENDIENTE_APROBACION']));
    expect(await prisma.ordenPagoRetencion.count({ where: { certificadoNumero: { not: null } } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.padronIibb.count({ where: { jurisdiccion: '902' } })).toBe(3);

    // Tesorería
    const sucursales = await prisma.sucursal.findMany({ orderBy: { codigo: 'asc' } });
    expect(sucursales.map((s) => s.nombre)).toEqual(['Casa central', 'Sucursal Rosario']);
    const cajero = await prisma.usuario.findUniqueOrThrow({ where: { email: 'cajero.rosario@demo.com' }, include: { empresas: true } });
    expect(cajero.empresas[0].sucursalId).toBe(sucursales.find((s) => s.codigo === 'ROS')!.id);
    const estados = new Set((await prisma.chequeTercero.findMany()).map((c) => c.estado));
    for (const e of ['EN_CARTERA', 'EN_TRANSITO', 'DEPOSITADO']) expect(estados).toContain(e);
    expect(await prisma.traslado.count({ where: { estado: 'ENVIADO' } })).toBe(1);
    expect(await prisma.transferenciaRecibida.count({ where: { estado: 'PENDIENTE' } })).toBe(1);
    const diferidos = (await prisma.chequePropio.findMany({ where: { estado: 'EMITIDO' } })).filter((c) => c.fechaPago > c.fechaEmision);
    expect(diferidos).toHaveLength(1);

    // Conciliación
    expect(await prisma.reglaConciliacion.count()).toBe(10);
    const formato = await prisma.formatoExtracto.findFirstOrThrow();
    const leido = await parsearExtracto(readFileSync(ARCHIVO_EXTRACTO_DEMO), formato as unknown as FormatoParseo);
    expect(leido.errores).toEqual([]);
    expect(leido.advertencias).toEqual([]);
    expect(leido.lineas.map((l) => l.concepto)).toEqual(expect.arrayContaining(['IMP. LEY 25413 DEB', 'COMISION MANTENIMIENTO CTA', 'IVA COMISION']));
    const tesorero = await prisma.rol.findFirstOrThrow({ where: { nombre: 'Tesorero' } });
    expect(tesorero.permisos).toContain('conciliacion.operar');

    // Contabilidad
    const ejercicio = await prisma.ejercicio.findFirstOrThrow({ include: { periodos: true } });
    expect(ejercicio.periodos).toHaveLength(12);
    const aporte = await prisma.asiento.findFirstOrThrow({ where: { tipo: 'MANUAL', descripcion: 'Aporte de capital inicial' } });
    expect(aporte.ejercicioId).toBe(ejercicio.id);
    const contador = await prisma.usuario.findUniqueOrThrow({ where: { email: 'contador@demo.com' }, include: { empresas: { include: { rol: true } } } });
    expect(contador.empresas[0].rol.permisos).toEqual(expect.arrayContaining(['asiento.registrar', 'contabilidad.cerrar', 'plancuentas.ver']));
    expect(await prisma.asiento.count({ where: { ejercicioId: null } })).toBe(0);

    // Ventas
    expect((await prisma.configArca.findFirstOrThrow()).ambiente).toBe('SIMULADO');
    expect(await prisma.puntoVenta.findFirst({ where: { numero: 2, electronico: true } })).not.toBeNull();
    const fc = await prisma.comprobanteVenta.findFirstOrThrow({ where: { estado: 'AUTORIZADO' }, include: { tercero: true } });
    expect(fc).toMatchObject({ tipo: 'FACTURA', letra: 'A', concepto: 'SERVICIOS', numero: 1 });
    expect(fc.cae).toMatch(/^\d{14}$/);
    expect(fc.tercero.razonSocial).toBe('Distribuidora Norte SA');
    expect(await prisma.recibo.count({ where: { estado: 'CONFIRMADO' } })).toBe(1);
    const saldo = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'VENTA', origenId: fc.id } });
    expect(saldo.saldo.gt(0) && saldo.saldo.lt(fc.total)).toBe(true);
    const facturacion = await prisma.usuario.findUniqueOrThrow({ where: { email: 'facturacion@demo.com' }, include: { empresas: { include: { rol: true } } } });
    expect(facturacion.empresas[0].rol.permisos).toEqual(expect.arrayContaining(['venta.emitir', 'cobro.registrar', 'venta.ver']));

    for (const a of await prisma.asiento.findMany({ include: { renglones: true } })) {
      const debe = a.renglones.reduce((s, r) => s + Math.round(Number(r.debe) * 100), 0);
      const haber = a.renglones.reduce((s, r) => s + Math.round(Number(r.haber) * 100), 0);
      expect(debe).toBe(haber);
    }
  });
});
