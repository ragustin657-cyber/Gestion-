import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

interface Percepcion { tipo: string; jurisdiccion: string | null; tramo: string | null; base: string; alicuota: string; importe: string; origenAlicuota: string }
interface Venta { id: string; total: string; percepciones: string; percepcionesDetalle: Percepcion[]; estado: string }

describe('percepciones en ventas (E39)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const cliente = await prisma.tercero.findUniqueOrThrow({ where: { id: v.clienteRI.id } });
    const percibir = (jurisdiccion: string, o: Record<string, unknown> = {}) => v.http.put('/api/pagos/config/jurisdicciones', [{
      jurisdiccion, alicuotaDefecto: 0, minimoRetencion: 0, usaPadron: true, sinPadron: 'NO_RETENER',
      percibe: true, alicuotaPercepcionDefecto: 0, minimoPercepcion: 0, sinPadronPercepcion: 'NO_RETENER', ...o,
    }]);
    const padron = (jurisdiccion: string, cuit: string, alicuotaPercepcion: number) => prisma.padronIibb.create({
      data: { jurisdiccion, cuit, vigenciaDesde: new Date('2026-11-01'), vigenciaHasta: new Date('2026-11-30'), alicuotaPercepcion },
    });
    const emitir = async (o: Record<string, unknown> = {}) => (await v.factura(o)) as unknown as Venta;
    const ivaAgente = async () => {
      await v.http.patch('/api/empresas/actual', { agentePercepcionIva: true });
      await v.http.post('/api/pagos/config/regimenes-percepcion-iva', { codigo: '493', descripcion: 'RG 2408', alicuotaGeneral: 3, alicuotaReducida: 1.5, minimoNeto: 0 });
    };
    return { ...v, cliente, percibir, padron, emitir, ivaAgente };
  };
  const de = (c: Venta, tipo: string, j?: string) => c.percepcionesDetalle.filter((p) => p.tipo === tipo && (!j || p.jurisdiccion === j));

  it('cliente en el padrón de ARBA: percepción en la factura y en el total', async () => {
    const x = await escenario();
    await x.percibir('902');
    await x.padron('902', x.cliente.cuit, 3);
    const c = await x.emitir();
    expect(c.estado).toBe('AUTORIZADO');
    expect(de(c, 'IIBB', '902')).toEqual([expect.objectContaining({ base: '1000', alicuota: '3', importe: '30', origenAlicuota: 'PADRON' })]);
    expect([Number(c.percepciones), Number(c.total)]).toEqual([30, 1240]);
  });

  it('consumidor final y letra C no se perciben', async () => {
    const x = await escenario();
    await x.percibir('902', { sinPadronPercepcion: 'ALICUOTA_DEFECTO', alicuotaPercepcionDefecto: 3 });
    await prisma.tercero.update({ where: { id: x.clienteCF.id }, data: { provincia: 'Buenos Aires' } });
    const b = await x.emitir({ terceroId: x.clienteCF.id });
    expect(b.percepcionesDetalle).toEqual([]);
  });

  it('ficha del cliente: con alícuota de percepción percibe; sin ella no (no es 0 %)', async () => {
    const x = await escenario();
    await x.percibir('901');
    await x.http.put(`/api/terceros/${x.cliente.id}/iibb`, [{ jurisdiccion: '901', alicuotaRetencion: 1, alicuotaPercepcion: 2 }]);
    expect(de(await x.emitir(), 'IIBB', '901')).toEqual([expect.objectContaining({ importe: '20', origenAlicuota: 'FICHA' })]);
    await x.http.put(`/api/terceros/${x.cliente.id}/iibb`, [{ jurisdiccion: '901', alicuotaRetencion: 1 }]);
    expect((await x.emitir()).percepcionesDetalle).toEqual([]);
  });

  it('alícuota por defecto solo a clientes vinculados a la jurisdicción', async () => {
    const x = await escenario();
    await x.percibir('901', { sinPadronPercepcion: 'ALICUOTA_DEFECTO', alicuotaPercepcionDefecto: 1 });
    await prisma.tercero.update({ where: { id: x.cliente.id }, data: { provincia: 'Capital Federal' } });
    expect(de(await x.emitir(), 'IIBB', '901')).toEqual([expect.objectContaining({ importe: '10', origenAlicuota: 'DEFECTO' })]);
    await prisma.tercero.update({ where: { id: x.cliente.id }, data: { provincia: null } });
    expect((await x.emitir()).percepcionesDetalle).toEqual([]);
  });

  it('IVA: tramo general y reducido; monotributo y excluidos no', async () => {
    const x = await escenario();
    await x.ivaAgente();
    const c = await x.emitir({ renglones: [{ descripcion: 'A', cantidad: 1, precioUnitario: 1000, alicuota: 21 }, { descripcion: 'B', cantidad: 1, precioUnitario: 1000, alicuota: 10.5 }] });
    expect(de(c, 'IVA').map((p) => [p.tramo, p.alicuota, p.importe])).toEqual([['GENERAL', '3', '30'], ['REDUCIDA', '1.5', '15']]);
    await prisma.tercero.update({ where: { id: x.cliente.id }, data: { exclusionIvaPorcentaje: 100, exclusionIvaHasta: new Date('2026-12-31') } });
    expect(de(await x.emitir(), 'IVA')).toEqual([]);
    await prisma.tercero.update({ where: { id: x.cliente.id }, data: { exclusionIvaPorcentaje: null, exclusionIvaHasta: null, condicionIva: 'MONOTRIBUTO' } });
    expect(de(await x.emitir(), 'IVA')).toEqual([]);
  });

  it('factura en dólares: importe en dólares y mínimo en pesos', async () => {
    const x = await escenario();
    await x.percibir('902', { minimoPercepcion: 2000 });
    await x.padron('902', x.cliente.cuit, 3);
    const usd = { monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'S', cantidad: 1, precioUnitario: 100, alicuota: 21 }] };
    expect(de(await x.emitir(usd), 'IIBB')).toEqual([expect.objectContaining({ base: '100', importe: '3' })]);
    await x.percibir('902', { minimoPercepcion: 4000 });
    expect((await x.emitir(usd)).percepcionesDetalle).toEqual([]);
  });

  it('notas de crédito: revierten en proporción sin superar lo percibido', async () => {
    const x = await escenario();
    await x.percibir('902');
    await x.padron('902', x.cliente.cuit, 3);
    const fc = await x.emitir();
    const nc = (precio: number) => x.http.post('/api/ventas/comprobantes', x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, aplicarAAsociado: false, renglones: [{ descripcion: 'NC', cantidad: 1, precioUnitario: precio, alicuota: 21 }], emitir: true }));
    const n1 = await nc(500);
    expect(n1.status).toBe(201);
    expect(de(n1.body, 'IIBB')).toEqual([expect.objectContaining({ base: '500', alicuota: '3', importe: '15' })]);
    const n2 = await nc(500);
    expect(de(n2.body, 'IIBB')[0].importe).toBe('15');
    const n3 = await nc(10);
    expect(n3.status === 201 ? de(n3.body, 'IIBB') : []).toEqual([]);
  });

  it('borrador sin padrón emitido después de cargarlo: lleva la percepción', async () => {
    const x = await escenario();
    await x.percibir('902');
    const b = await x.http.post('/api/ventas/comprobantes', x.datos());
    expect(b.status).toBe(201);
    expect((b.body as Venta).percepcionesDetalle).toEqual([]);
    await x.padron('902', x.cliente.cuit, 3);
    const e = await x.http.post(`/api/ventas/comprobantes/${b.body.id}/emitir`);
    expect(e.status).toBe(201);
    expect([e.body.estado, Number(e.body.total)]).toEqual(['AUTORIZADO', 1240]);
    expect(de(e.body, 'IIBB')).toHaveLength(1);
  });

  const asiento = async (comprobanteId: string) => {
    const c = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: comprobanteId } });
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: c.asientoId! }, include: { renglones: true } });
    const r: Record<string, [string, string]> = {};
    for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toFixed(2), x.haber.toFixed(2)];
    return r;
  };

  it('asiento: percepciones a depositar al haber; la NC al revés; en dólares cuadra en pesos', async () => {
    const x = await escenario();
    await x.percibir('902');
    await x.padron('902', x.cliente.cuit, 3);
    await x.ivaAgente();
    const fc = await x.emitir();
    expect(await asiento(fc.id)).toEqual({ '1.1.02.001': ['1270.00', '0.00'], '4.1.01': ['0.00', '1000.00'], '2.1.02.001': ['0.00', '210.00'], '2.1.02.008': ['0.00', '30.00'], '2.1.02.009': ['0.00', '30.00'] });
    const nc = await x.http.post('/api/ventas/comprobantes', x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fc.id, aplicarAAsociado: false, emitir: true }));
    expect(await asiento(nc.body.id)).toEqual({ '1.1.02.001': ['0.00', '1270.00'], '4.1.01': ['1000.00', '0.00'], '2.1.02.001': ['210.00', '0.00'], '2.1.02.008': ['30.00', '0.00'], '2.1.02.009': ['30.00', '0.00'] });
    const usd = await x.emitir({ monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'S', cantidad: 1, precioUnitario: 100, alicuota: 21 }] });
    const r = await asiento(usd.id);
    expect(r['2.1.02.008']).toEqual(['0.00', '3000.00']);
    expect(r['1.1.02.001']).toEqual(['127000.00', '0.00']);
  });

  it('el PDF muestra la percepción, también en la factura B', async () => {
    const x = await escenario();
    await x.percibir('902');
    await x.padron('902', x.cliente.cuit, 3);
    const texto = async (id: string) => {
      const pdf = await request(app.getHttpServer()).get(`/api/ventas/comprobantes/${id}/pdf`).set('Authorization', `Bearer ${x.token}`).buffer(true).parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
      const s = (pdf.body as Buffer).toString('latin1');
      return [...s.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) => Buffer.from([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((y) => y[1]).join(''), 'hex').toString('latin1')).join('\n');
    };
    // pdfkit parte el texto en el espacio: se busca la jurisdicción y la alícuota juntas
    expect(await texto((await x.emitir()).id)).toMatch(/Percepción IIBB Buenos Aires[\s\S]{0,3}3,00/);
    await prisma.tercero.update({ where: { id: x.cliente.id }, data: { condicionIva: 'MONOTRIBUTO' } });
    const b = await x.emitir();
    expect(await texto(b.id)).toMatch(/Percepción IIBB Buenos Aires[\s\S]{0,3}3,00/);
  });

});
