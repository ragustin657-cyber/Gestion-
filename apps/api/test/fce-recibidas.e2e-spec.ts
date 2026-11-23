import { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import request from 'supertest';
import { ArcaSimuladoFce } from '../src/arca/arca-simulado-fce';
import { FceArca } from '../src/arca/cliente-fce';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararPagos } from './helpers-pagos';

const PROV = '30700123452';
type Fila = { id: string; estado: string; numero: number; diasRestantes: number | null; compraCargada: boolean; comprobanteCompraId: string | null; cliente: string | null };

describe('factura de crédito MiPyME: recibidas (E50)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => { ArcaSimuladoFce.limpiar(); await app.close(); });

  let numero = 100;
  const escenario = async () => {
    const s = await prepararPagos(app, prisma);
    const cuit = (await prisma.empresa.findUniqueOrThrow({ where: { id: s.empresaId } })).cuit.replace(/\D/g, '');
    const recibir = (o: Partial<FceArca> = {}) => {
      const f: FceArca = { cuitEmisor: PROV, cuitReceptor: cuit, cbteTipo: 201, ptoVta: 1, numero: 123, fecha: '2026-11-02', importe: '1210.00', moneda: 'PES', fechaVencimientoPago: '2026-12-02', estado: 'PENDIENTE', fechaRecepcion: '2026-11-02', fechaLimite: '2026-12-02', motivosRechazo: [], ...o };
      ArcaSimuladoFce.recibir(s.empresaId, f);
      return f;
    };
    const compra = async (o: Record<string, unknown> = {}) => {
      const r = await s.http.post('/api/compras/comprobantes', {
        terceroId: s.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS',
        totalDeclarado: 1210, renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21 }], ...o,
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const lista = async () => { await s.http.post('/api/compras/fce/actualizar'); return (await s.http.get('/api/compras/fce')).body.filas as Fila[]; };
    return { ...s, recibir, compra, lista };
  };

  it('la marca FCE entra en la unicidad; el registro empareja con la compra FCE', async () => {
    const x = await escenario();
    const comun = await x.compra({ numero: 123 });
    const fce = await x.compra({ numero: 123, fce: true });
    expect(comun.id).not.toBe(fce.id);
    const dup = await x.http.post('/api/compras/comprobantes', { terceroId: x.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: 123, fce: true, fechaEmision: '2026-11-02', fechaContable: '2026-11-02', monedaCodigo: 'ARS', totalDeclarado: 1210, renglones: [{ origen: 'DIRECTO', descripcion: 'Servicio', cantidad: 1, precioUnitario: 1000, alicuotaIva: 21 }] });
    expect(dup.status).toBe(409);
    x.recibir();
    const [f] = await x.lista();
    expect(f).toMatchObject({ estado: 'PENDIENTE', numero: 123, diasRestantes: 26, compraCargada: true, comprobanteCompraId: fce.id, cliente: 'Proveedor 1' });
  });

  it('emparejar con la compra común la marca como FCE', async () => {
    const x = await escenario();
    const c = await x.compra({ numero: 77 });
    x.recibir({ numero: 77 });
    expect((await x.lista())[0].comprobanteCompraId).toBe(c.id);
    expect((await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: c.id } })).fce).toBe(true);
  });

  it('aceptar y rechazar: estados, avisos, plazos y auditoría', async () => {
    const x = await escenario();
    x.recibir({ numero: 1 });
    x.recibir({ numero: 2 });
    x.recibir({ numero: 3, fechaLimite: '2026-11-01' });
    await x.compra({ numero: 2 });
    const filas = await x.lista();
    const de = (n: number) => filas.find((f) => f.numero === n)!;
    let r = await x.http.post(`/api/compras/fce/${de(1).id}/aceptar`);
    expect([r.status, r.body.aviso, r.body.estado]).toEqual([201, 'La compra no está cargada', 'ACEPTADA']);
    r = await x.http.post(`/api/compras/fce/${de(1).id}/aceptar`);
    expect([r.status, r.body.message]).toEqual([400, 'La factura de crédito no está pendiente']);
    r = await x.http.post(`/api/compras/fce/${de(2).id}/rechazar`, { motivos: [], texto: 'x' });
    expect(r.status).toBe(400);
    r = await x.http.post(`/api/compras/fce/${de(2).id}/rechazar`, { motivos: ['3'], texto: 'Llegó roto' });
    expect([r.status, r.body.aviso, r.body.estado]).toEqual([201, 'La compra está cargada: anúlela o registre la nota de crédito del proveedor', 'RECHAZADA']);
    r = await x.http.post(`/api/compras/fce/${de(3).id}/aceptar`);
    expect([r.status, r.body.message]).toEqual([400, 'El plazo para aceptar o rechazar venció el 01/11/2026']);
    const au = await prisma.auditoria.findMany({ where: { entidad: 'FceRegistro' }, orderBy: { fecha: 'asc' } });
    expect(au.map((a) => a.accion)).toEqual(['APROBAR', 'ANULAR']);
    const motivos = (await x.http.get('/api/compras/fce/motivos')).body;
    expect(motivos.map((m: { codigo: string }) => m.codigo)).toEqual(['1', '2', '3']);
    // En ARCA quedó rechazada con el motivo
    const enArca = (await x.lista()).find((f) => f.numero === 2)!;
    expect(enArca.estado).toBe('RECHAZADA');
  });

  it('permisos: ver con fc.ver, aceptar con fc.crear', async () => {
    const x = await escenario();
    x.recibir();
    const [f] = await x.lista();
    const u = await otroUsuario(app, prisma, x.empresaId, ['fc.ver']);
    expect((await u.http.get('/api/compras/fce')).status).toBe(200);
    expect((await u.http.post(`/api/compras/fce/${f.id}/aceptar`)).status).toBe(403);
  });

  it('Libro IVA Digital de compras: 201 la marcada, 001 la común', async () => {
    const x = await escenario();
    await x.compra({ numero: 10 });
    await x.compra({ numero: 11, fce: true });
    const g = await x.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' });
    expect(g.status).toBe(201);
    const zipBuf = await x.http.get(`/api/impuestos/presentaciones/${g.body.id}/archivo`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    const zip = await JSZip.loadAsync(zipBuf.body as Buffer);
    const cc = (await zip.file('COMPRAS_CBTE.txt')!.async('string')).split('\r\n').filter(Boolean);
    expect(cc.map((l) => l.slice(8, 11)).sort()).toEqual(['001', '201']);
  });

  it('control con Mis Comprobantes: la FCE empareja con la compra marcada y avisa si la compra es común', async () => {
    const x = await escenario();
    await x.compra({ numero: 20, fce: true });
    await x.compra({ numero: 21 });
    const csv = ['Fecha;Tipo;Punto de Venta;Número Desde;Nro. Doc. Emisor;Imp. Neto Gravado;IVA;Imp. Total',
      `02/11/2026;201 - Factura de Crédito Electrónica MiPyMEs (FCE) A;1;20;${PROV};1000,00;210,00;1210,00`,
      `02/11/2026;201 - Factura de Crédito Electrónica MiPyMEs (FCE) A;1;21;${PROV};1000,00;210,00;1210,00`].join('\n');
    const r = await request(app.getHttpServer()).post('/api/impuestos/control-arca').set('Authorization', `Bearer ${x.token}`).field('sentido', 'RECIBIDOS').field('desde', '2026-11-01').field('hasta', '2026-11-30').attach('archivo', Buffer.from(csv, 'latin1'), 'mis.csv');
    expect(r.status).toBe(201);
    expect([r.body.coinciden, r.body.soloArca.length, r.body.soloSistema.length]).toEqual([1, 0, 0]);
    expect(r.body.diferencias.map((d: { numero: number; campos: string[] }) => [d.numero, d.campos])).toEqual([[21, ['La compra es una factura de crédito MiPyME']]]);
  });
});
