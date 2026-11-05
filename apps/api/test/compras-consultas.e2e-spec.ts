import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, sesionConPlan } from './helpers';

let numero = 9000;

describe('consultas de compras', () => {
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
    const cargar = async (extra: Record<string, unknown>, renglones: { precio: number; alicuota: number }[]) => {
      const tot = renglones.reduce((t, r) => t + r.precio * (1 + r.alicuota / 100), 0);
      const r = await s.http.post('/api/compras/comprobantes', {
        terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero,
        fechaEmision: '2026-11-07', fechaContable: '2026-11-07', monedaCodigo: 'ARS', totalDeclarado: Math.round(tot * 100) / 100,
        renglones: renglones.map((x) => ({ origen: 'DIRECTO', descripcion: 'x', cantidad: 1, precioUnitario: x.precio, alicuotaIva: x.alicuota })),
        ...extra,
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body;
    };
    return { ...s, ...d, cargar };
  }

  it('cuenta corriente con factura y nota de crédito', async () => {
    const { http, cargar, proveedorId } = await preparar();
    await cargar({}, [{ precio: 4000, alicuota: 21 }]);
    await cargar({ tipo: 'NOTA_CREDITO', fechaEmision: '2026-11-08' }, [{ precio: 1000, alicuota: 21 }]);
    const r = await http.get(`/api/compras/cuenta-corriente/${proveedorId}`);
    expect(r.status).toBe(200);
    expect(r.body.movimientos.map((m: { acumuladoPesos: string }) => m.acumuladoPesos)).toEqual(['4840.00', '3630.00']);
    expect(r.body.saldos).toEqual({ ARS: '3630.00', USD: '0.00', pesos: '3630.00' });
  });

  it('antigüedad de deuda: vencida hace 45 días cae en 31-60', async () => {
    const { http, cargar } = await preparar();
    await cargar({ fechaVencimiento: '2026-11-16' }, [{ precio: 1000, alicuota: 21 }]);
    await cargar({ fechaVencimiento: '2027-01-30' }, [{ precio: 100, alicuota: 21 }]);
    const r = await http.get('/api/compras/antiguedad-deuda?fecha=2026-12-31');
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ d31a60: '1210.00', porVencer: '121.00', total: '1331.00', d0a30: '0.00' });
  });

  it('libro IVA: totales por alícuota, la NC resta, excluye anulados', async () => {
    const { http, cargar } = await preparar();
    await cargar({}, [{ precio: 1000, alicuota: 21 }, { precio: 500, alicuota: 10.5 }]);
    await cargar({ tipo: 'NOTA_CREDITO' }, [{ precio: 1000, alicuota: 21 }]);
    const anulada = await cargar({}, [{ precio: 999, alicuota: 21 }]);
    await http.post(`/api/compras/comprobantes/${anulada.id}/anular`, { motivo: 'x' });
    const r = await http.get('/api/compras/libro-iva?desde=2026-11-01&hasta=2026-11-30');
    expect(r.body.filas).toHaveLength(2);
    expect(r.body.filas[1]).toMatchObject({ total: '-1210.00', ivaPorAlicuota: { '21': '-210.00' } });
    expect(r.body.totales).toMatchObject({ netoPorAlicuota: { '21': '0.00', '10.5': '500.00' }, ivaPorAlicuota: { '21': '0.00', '10.5': '52.50' }, total: '552.50' });
  });

  it('libro IVA exporta a Excel con fila de totales', async () => {
    const { token, cargar } = await preparar();
    await cargar({}, [{ precio: 1000, alicuota: 21 }]);
    const r = await request(app.getHttpServer())
      .get('/api/compras/libro-iva?desde=2026-11-01&hasta=2026-11-30&formato=xlsx')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.headers['content-disposition']).toContain('libro-iva-compras-2026-11-01-2026-11-30.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const hoja = wb.worksheets[0];
    const ultima = hoja.getRow(hoja.rowCount);
    expect(ultima.getCell(1).value).toBe('Totales');
  });

  it('buscador encuentra OC por número y factura por PV-número', async () => {
    const { http, cargar, empresaId, proveedorId, articuloId } = await preparar();
    const oc = await ocAprobada(http, prisma, empresaId, { proveedorId, articuloId });
    const fc = await cargar({}, [{ precio: 1000, alicuota: 21 }]);
    const r1 = (await http.get(`/api/compras/buscador?q=${oc.numero}`)).body;
    expect(r1.some((x: { tipo: string; id: string }) => x.tipo === 'OC' && x.id === oc.id)).toBe(true);
    const r2 = (await http.get(`/api/compras/buscador?q=00001-${String(fc.numero).padStart(8, '0')}`)).body;
    expect(r2).toEqual([expect.objectContaining({ tipo: 'FC', id: fc.id })]);
  });

  it('fecha inválida → 400; otra empresa no ve datos', async () => {
    const a = await preparar();
    await a.cargar({}, [{ precio: 1000, alicuota: 21 }]);
    const mal = await a.http.get('/api/compras/antiguedad-deuda?fecha=abc');
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('Fecha inválida');
    const b = await preparar();
    expect((await b.http.get('/api/compras/libro-iva?desde=2026-11-01&hasta=2026-11-30')).body.filas).toEqual([]);
    expect((await b.http.get(`/api/compras/cuenta-corriente/${a.proveedorId}`)).status).toBe(404);
  });
});
