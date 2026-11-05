import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, sesionConPlan } from './helpers';

let numero = 1000;

describe('facturas de proveedor', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function preparar() {
    const s = await sesionConPlan(app, prisma);
    const d = await datosCompras(prisma, s.empresaId);
    const oc = await ocAprobada(s.http, prisma, s.empresaId, d);
    const recibir = async (cantidad: number, prov = d.proveedorId, renglon = oc.renglones[0].id) => {
      const r = await s.http.post('/api/compras/recepciones', { terceroId: prov, fecha: '2026-11-06', remitoNumero: `1-${++numero}`, renglones: [{ ordenCompraRenglonId: renglon, cantidad }] });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { renglones: { id: string }[] };
    };
    const fc = (extra: Record<string, unknown> = {}) => ({
      terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero,
      fechaEmision: '2026-11-07', fechaContable: '2026-11-07', monedaCodigo: 'ARS', ...extra,
    });
    const asientoDe = async (comprobanteId: string) => {
      const a = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'COMPRA', origenId: comprobanteId, anulaAId: null }, include: { renglones: true } });
      const porCodigo: Record<string, { debe: string; haber: string }> = {};
      for (const r of a.renglones) {
        const c = await prisma.cuentaContable.findUniqueOrThrow({ where: { id: r.cuentaContableId } });
        porCodigo[c.codigo] = { debe: r.debe.toString(), haber: r.haber.toString() };
      }
      return porCodigo;
    };
    return { ...s, ...d, oc, recibir, fc, asientoDe };
  }

  it('factura A desde recepción: cuenta corriente, asiento y cantidades facturadas', async () => {
    const { http, recibir, fc, asientoDe, oc } = await preparar();
    const ir = await recibir(4);
    const r = await http.post('/api/compras/comprobantes', fc({
      totalDeclarado: 4840,
      renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'x', cantidad: 4, precioUnitario: 1000, alicuotaIva: 21 }],
    }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: '4840', netoGravado: '4000', iva: '840', estado: 'CONFIRMADO' });
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    expect(mov.saldo.toString()).toBe('4840');
    expect(await asientoDe(r.body.id)).toEqual({
      '5.2.01': { debe: '4000', haber: '0' }, '1.1.03.001': { debe: '840', haber: '0' }, '2.1.01.001': { debe: '0', haber: '4840' },
    });
    expect((await prisma.informeRecepcionRenglon.findUniqueOrThrow({ where: { id: ir.renglones[0].id } })).cantidadFacturada.toString()).toBe('4');
    expect((await prisma.ordenCompraRenglon.findUniqueOrThrow({ where: { id: oc.renglones[0].id } })).cantidadFacturada.toString()).toBe('4');
  });

  it('factura directa con percepción IIBB y no gravado', async () => {
    const { http, fc, asientoDe, cuenta } = await preparar();
    const r = await http.post('/api/compras/comprobantes', fc({
      totalDeclarado: 1270, percepcionesIibb: [{ jurisdiccion: '901', importe: 50 }], noGravado: 10,
      renglones: [{ origen: 'DIRECTO', descripcion: 'Luz', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21, cuentaContableId: await cuenta('5.2.02') }],
    }));
    expect(r.status).toBe(201);
    expect(await asientoDe(r.body.id)).toEqual({
      '5.2.02': { debe: '1000', haber: '0' }, '1.1.03.001': { debe: '210', haber: '0' }, '1.1.03.003': { debe: '50', haber: '0' },
      '5.2.01': { debe: '10', haber: '0' }, '2.1.01.001': { debe: '0', haber: '1270' },
    });
  });

  it('diferencia de precio: 422 en modo avisar, 201 aceptando; 400 en modo bloquear', async () => {
    const { http, recibir, fc, empresaId } = await preparar();
    const ir = await recibir(1);
    const body = fc({ totalDeclarado: 1246.3, renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 1030, alicuotaIva: 21 }] });
    const r = await http.post('/api/compras/comprobantes', body);
    expect(r.status).toBe(422);
    expect(r.body.diferencias[0]).toMatchObject({ tipo: 'PRECIO', diferenciaPct: '3.00' });
    await prisma.empresa.update({ where: { id: empresaId }, data: { modoTresVias: 'BLOQUEAR' } });
    expect((await http.post('/api/compras/comprobantes', body)).status).toBe(400);
    await prisma.empresa.update({ where: { id: empresaId }, data: { modoTresVias: 'AVISAR' } });
    const ok = await http.post('/api/compras/comprobantes', { ...body, aceptoDiferencias: true });
    expect(ok.status).toBe(201);
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { entidadId: ok.body.id, accion: 'CREAR' } });
    expect((aud.datos as { diferencias: unknown[] }).diferencias).toHaveLength(1);
  });

  it('facturar otra vez un renglón ya facturado → 422 por cantidad', async () => {
    const { http, recibir, fc } = await preparar();
    const ir = await recibir(2);
    const renglones = [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'x', cantidad: 2, precioUnitario: 1000, alicuotaIva: 21 }];
    expect((await http.post('/api/compras/comprobantes', fc({ totalDeclarado: 2420, renglones }))).status).toBe(201);
    const r = await http.post('/api/compras/comprobantes', fc({ totalDeclarado: 2420, renglones }));
    expect(r.status).toBe(422);
    expect(r.body.diferencias[0]).toMatchObject({ tipo: 'CANTIDAD', esperado: '0' });
  });

  it('factura desde OC (servicio sin recepción)', async () => {
    const { http, fc, oc } = await preparar();
    const r = await http.post('/api/compras/comprobantes', fc({
      totalDeclarado: 1210, renglones: [{ origen: 'ORDEN_COMPRA', ordenCompraRenglonId: oc.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21 }],
    }));
    expect(r.status).toBe(201);
    expect((await prisma.ordenCompraRenglon.findUniqueOrThrow({ where: { id: oc.renglones[0].id } })).cantidadFacturada.toString()).toBe('1');
  });

  const directo = (precio = 1000) => [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: precio, alicuotaIva: 21 }];

  it('mismo número dos veces → 409', async () => {
    const { http, fc } = await preparar();
    const body = fc({ totalDeclarado: 1210, renglones: directo() });
    expect((await http.post('/api/compras/comprobantes', body)).status).toBe(201);
    const r = await http.post('/api/compras/comprobantes', body);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Este comprobante ya fue cargado');
  });

  it('letra C de un proveedor RI → 400', async () => {
    const { http, fc } = await preparar();
    const r = await http.post('/api/compras/comprobantes', fc({ letra: 'C', totalDeclarado: 1000, renglones: directo() }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La letra C no corresponde para este proveedor');
  });

  it('total declarado: diferencia 0,06 → 400; 0,04 → 201', async () => {
    const { http, fc } = await preparar();
    const mal = await http.post('/api/compras/comprobantes', fc({ totalDeclarado: 1210.06, renglones: directo() }));
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('El total calculado ($1.210,00) no coincide con el total del comprobante ($1.210,06)');
    expect((await http.post('/api/compras/comprobantes', fc({ totalDeclarado: 1210.04, renglones: directo() }))).status).toBe(201);
  });

  it('factura en USD con cotización que redondea: asiento balanceado y cuenta corriente en ambas monedas', async () => {
    const { http, fc } = await preparar();
    const r = await http.post('/api/compras/comprobantes', fc({ monedaCodigo: 'USD', cotizacion: 1450.333, totalDeclarado: 121.4, renglones: directo(100.33) }));
    expect(r.status).toBe(201);
    expect(r.body.totalPesos).toBe('176070.43');
    const a = await prisma.asiento.findFirstOrThrow({ where: { origenId: r.body.id }, include: { renglones: true } });
    const debe = a.renglones.reduce((s, x) => s + Math.round(Number(x.debe) * 100), 0);
    const haber = a.renglones.reduce((s, x) => s + Math.round(Number(x.haber) * 100), 0);
    expect(debe).toBe(haber);
    expect(haber).toBe(17607043);
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    expect([mov.saldo.toString(), mov.saldoPesos.toString(), mov.monedaCodigo]).toEqual(['121.4', '176070.43', 'USD']);
  });

  it('USD sin cotización para la fecha → 400', async () => {
    const { http, fc } = await preparar();
    const r = await http.post('/api/compras/comprobantes', fc({ monedaCodigo: 'USD', fechaEmision: '2026-10-15', totalDeclarado: 1210, renglones: directo() }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('No hay cotización de USD para el 15/10/2026');
  });

  it('renglón de recepción de otro proveedor → 400', async () => {
    const { http, recibir, fc, empresaId } = await preparar();
    const ir = await recibir(1);
    const otro = await datosCompras(prisma, empresaId);
    const r = await http.post('/api/compras/comprobantes', fc({
      terceroId: otro.proveedorId, totalDeclarado: 1210,
      renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21 }],
    }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Todos los renglones deben ser del proveedor indicado');
  });

  it('nota de crédito directa resta e invierte el asiento; con renglón de recepción → 400', async () => {
    const { http, fc, asientoDe, recibir } = await preparar();
    const r = await http.post('/api/compras/comprobantes', fc({ tipo: 'NOTA_CREDITO', totalDeclarado: 1210, renglones: directo() }));
    expect(r.status).toBe(201);
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: r.body.id } });
    expect(mov.importe.toString()).toBe('-1210');
    expect(await asientoDe(r.body.id)).toEqual({
      '5.2.01': { debe: '0', haber: '1000' }, '1.1.03.001': { debe: '0', haber: '210' }, '2.1.01.001': { debe: '1210', haber: '0' },
    });
    const ir = await recibir(1);
    const mal = await http.post('/api/compras/comprobantes', fc({
      tipo: 'NOTA_CREDITO', totalDeclarado: 1210,
      renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21 }],
    }));
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('Las notas de crédito y débito solo admiten renglones directos');
  });

  it('factura C de monotributista no discrimina IVA', async () => {
    const { http, fc, empresaId, asientoDe } = await preparar();
    const mono = await prisma.tercero.create({ data: { empresaId, codigo: 50, razonSocial: 'Mono', cuit: '20234567897', condicionIva: 'MONOTRIBUTO', esProveedor: true } });
    const r = await http.post('/api/compras/comprobantes', fc({ terceroId: mono.id, letra: 'C', totalDeclarado: 1000, renglones: directo() }));
    expect(r.status).toBe(201);
    expect(r.body.iva).toBe('0');
    expect(await asientoDe(r.body.id)).toEqual({ '5.2.01': { debe: '1000', haber: '0' }, '2.1.01.001': { debe: '0', haber: '1000' } });
  });

  it('sin renglones → 400; vencimiento por defecto según días de pago', async () => {
    const { http, fc } = await preparar();
    expect((await http.post('/api/compras/comprobantes', fc({ totalDeclarado: 0, renglones: [] }))).status).toBe(400);
    const r = await http.post('/api/compras/comprobantes', fc({ totalDeclarado: 1210, renglones: directo() }));
    expect(r.body.fechaVencimiento.slice(0, 10)).toBe('2026-12-07');
  });

  it('detalle con asiento y aislamiento entre empresas', async () => {
    const a = await preparar();
    const r = (await a.http.post('/api/compras/comprobantes', a.fc({ totalDeclarado: 1210, renglones: directo() }))).body;
    const det = (await a.http.get(`/api/compras/comprobantes/${r.id}`)).body;
    expect(det.asiento.renglones.length).toBe(3);
    expect(det.ivas).toHaveLength(1);
    expect((await a.http.get('/api/compras/comprobantes')).body.total).toBe(1);
    const b = await preparar();
    expect((await b.http.get(`/api/compras/comprobantes/${r.id}`)).status).toBe(404);
  });
});
