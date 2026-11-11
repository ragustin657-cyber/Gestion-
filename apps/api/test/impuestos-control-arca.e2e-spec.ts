import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';

describe('control contra Mis Comprobantes de ARCA', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('recibidos: coincidencias, diferencias, solo en ARCA y solo en el sistema', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const ids = [];
    for (const neto of [1000, 2000, 3000]) ids.push((await facturaPendiente(s.http, prisma, { proveedorId, neto })).comprobanteId);
    const [c1, c2, c3] = await Promise.all(ids.map((id) => prisma.comprobanteCompra.findUniqueOrThrow({ where: { id } })));
    const fila = (n: number, neto: string, iva: string, total: string) => `02/11/2026;1 - Factura A;1;${n};${n};1;80;30700123452;Proveedor;1;$;${neto};0;0;${iva};${total}`;
    const csv = ['Fecha;Tipo;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;IVA;Imp. Total',
      fila(c1.numero, '1.000,00', '210,00', '1.210,00'), fila(c2.numero, '2.000,00', '420,00', '2.500,00'), fila(1599, '100,00', '0', '100,00')].join('\n');
    const enviar = (formato?: string) =>
      request(app.getHttpServer()).post(`/api/impuestos/control-arca${formato ? `?formato=${formato}` : ''}`).set('Authorization', `Bearer ${s.token}`)
        .field('sentido', 'RECIBIDOS').field('desde', '2026-11-01').field('hasta', '2026-11-30').attach('archivo', Buffer.from(csv, 'utf8'), 'mis-comprobantes.csv');
    const r = await enviar();
    expect(r.status).toBe(201);
    expect(r.body.coinciden).toBe(1);
    expect(r.body.diferencias).toEqual([expect.objectContaining({ numero: c2.numero, arca: expect.objectContaining({ total: '2500.00' }), sistema: expect.objectContaining({ total: '2420.00' }) })]);
    expect(r.body.soloArca.map((x: { numero: number }) => x.numero)).toEqual([1599]);
    expect(r.body.soloSistema.map((x: { numero: number }) => x.numero)).toEqual([c3.numero]);
    const x = await enviar('xlsx');
    expect(x.headers['content-type']).toContain('spreadsheet');
  });
});
