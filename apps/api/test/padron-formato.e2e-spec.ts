import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { descripcionRetencionOP } from '../src/pagos/consultas/consultas-pagos.service';
import { PadronService } from '../src/pagos/padron/padron.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('padrones de otras jurisdicciones (E48)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const subir = (token: string, contenido: string, jurisdiccion: string, periodo?: string) => {
    const r = request(app.getHttpServer()).post('/api/padrones').set('Authorization', `Bearer ${token}`).field('jurisdiccion', jurisdiccion);
    return (periodo ? r.field('periodo', periodo) : r).attach('archivo', Buffer.from(contenido, 'latin1'), 'padron.txt');
  };
  async function esperar(http: { get: (u: string) => Promise<{ body: { estado: string } }> }, id: string) {
    for (let i = 0; i < 50; i++) {
      const r = await http.get(`/api/padrones/${id}`);
      if (r.body.estado !== 'PROCESANDO') return r.body;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('la carga no terminó');
  }
  const FORMATO = { separador: ';', encabezado: true, cuit: '1', alicuotaRetencion: '2', alicuotaPercepcion: '3', vigenciaDesde: '4', vigenciaHasta: '5', formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',' };

  it('sin formato: error; con formato: carga y consulta la alícuota', async () => {
    const { token, http } = await sesion(app, prisma, { superadmin: true });
    const sin = await subir(token, 'x', '904');
    expect([sin.status, sin.body.message]).toEqual([400, 'Configure el formato del padrón de Córdoba']);
    expect((await http.put('/api/padrones/formatos/904', FORMATO)).status).toBe(200);
    expect((await http.get('/api/padrones/formatos/904')).body).toMatchObject({ separador: ';', cuit: '1' });
    const r = await subir(token, 'CUIT;RET;PER;DESDE;HASTA\n20123456786;1,5;2,25;01/11/2026;30/11/2026\n\n30700123452;0,75;1;01/11/2026;30/11/2026\n', '904');
    expect(r.status).toBe(202);
    expect(await esperar(http, r.body.id)).toMatchObject({ estado: 'COMPLETA', filas: 2 });
    const padron = app.get(PadronService);
    expect(await padron.alicuotaRetencion('904', '20123456786', new Date('2026-11-15T00:00:00Z'))).toBe('1.5');
    expect(await padron.alicuotaPercepcion('904', '30700123452', new Date('2026-11-15T00:00:00Z'))).toBe('1');
  });

  it('ancho fijo sin vigencia: la del período informado; línea mala: error con su número', async () => {
    const { token, http } = await sesion(app, prisma, { superadmin: true });
    await http.put('/api/padrones/formatos/909', { ...FORMATO, separador: 'FIJO', encabezado: false, cuit: '1-11', alicuotaRetencion: null, alicuotaPercepcion: '12-17', vigenciaDesde: null, vigenciaHasta: null, separadorDecimal: '.' });
    const r = await subir(token, '20123456786  3.50\n', '909', '202611');
    expect(await esperar(http, r.body.id)).toMatchObject({ estado: 'COMPLETA', filas: 1 });
    expect(await app.get(PadronService).alicuotaPercepcion('909', '20123456786', new Date('2026-11-30T00:00:00Z'))).toBe('3.5');
    const mala = await subir(token, '20123  3.50\n', '909', '202611');
    expect(await esperar(http, mala.body.id)).toMatchObject({ estado: 'ERROR', error: 'Línea 1 inválida: CUIT' });
  });

  it('formato: solo el administrador general; 901 y 902 no lo usan', async () => {
    const { http } = await sesion(app, prisma, { superadmin: true });
    const r = await http.put('/api/padrones/formatos/902', FORMATO);
    expect(r.status).toBe(400);
    const { http: comun } = await sesion(app, prisma);
    expect((await comun.put('/api/padrones/formatos/904', FORMATO)).status).toBe(403);
  });

  it('la constancia nombra cualquier jurisdicción', () => {
    expect(descripcionRetencionOP({ impuesto: 'IIBB', regimen: null, jurisdiccion: '904', detalle: {} })).toBe('IIBB Córdoba');
  });
});
