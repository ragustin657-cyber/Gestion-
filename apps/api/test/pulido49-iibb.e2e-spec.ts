import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('pulido E49: padrones y SIRCREB', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const FORMATO = { separador: ';', encabezado: true, cuit: '1', alicuotaRetencion: '2', alicuotaPercepcion: '3', vigenciaDesde: '4', vigenciaHasta: '5', formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',' };

  it('formato del padrón: vigencias juntas, columnas según el separador', async () => {
    const { http } = await sesion(app, prisma, { superadmin: true });
    const casos: [object, string][] = [
      [{ ...FORMATO, vigenciaHasta: null }, 'Indique las dos vigencias o ninguna'],
      [{ ...FORMATO, cuit: '1-11' }, 'Columna o posición inválida'],
      [{ ...FORMATO, separador: 'FIJO', cuit: '5', alicuotaRetencion: '12-17', alicuotaPercepcion: null, vigenciaDesde: null, vigenciaHasta: null }, 'Columna o posición inválida'],
      [{ ...FORMATO, cuit: '0' }, 'Columna o posición inválida'],
      [{ ...FORMATO, separador: 'FIJO', cuit: '0-11', alicuotaRetencion: '12-17', alicuotaPercepcion: null, vigenciaDesde: null, vigenciaHasta: null }, 'Columna o posición inválida'],
    ];
    for (const [f, msg] of casos) {
      const r = await http.put('/api/padrones/formatos/904', f);
      expect([JSON.stringify(f), r.status, r.body.message]).toEqual([JSON.stringify(f), 400, msg]);
    }
    expect((await http.put('/api/padrones/formatos/904', { ...FORMATO, vigenciaDesde: null, vigenciaHasta: null })).status).toBe(200);
    expect((await http.put('/api/padrones/formatos/905', { ...FORMATO, separador: 'FIJO', cuit: '1-11', alicuotaRetencion: '12-17', alicuotaPercepcion: null, vigenciaDesde: null, vigenciaHasta: null })).status).toBe(200);
  });

  it('carga con período inválido: error antes de cargar', async () => {
    const { token, http } = await sesion(app, prisma, { superadmin: true });
    expect((await http.put('/api/padrones/formatos/904', FORMATO)).status).toBe(200);
    for (const periodo of ['202613', '2026-11', '20261']) {
      const r = await request(app.getHttpServer()).post('/api/padrones').set('Authorization', `Bearer ${token}`).field('jurisdiccion', '904').field('periodo', periodo)
        .attach('archivo', Buffer.from('CUIT;RET;PER;DESDE;HASTA\n', 'latin1'), 'padron.txt');
      expect([periodo, r.status, r.body.message]).toEqual([periodo, 400, 'Período inválido (AAAAMM)']);
    }
    expect(await prisma.padronCarga.count()).toBe(0);
  });

  it('importación SIRCREB con BOM y líneas vacías antes del encabezado', async () => {
    const v = await prepararVentas(app, prisma);
    const r = await v.http.post('/api/impuestos/recaudaciones-bancarias/importar', { texto: '﻿\n\nperiodo;jurisdiccion;importe\n202610;902;100\n' });
    expect([r.status, r.body.importadas]).toEqual([201, 1]);
    const b = await v.http.post('/api/impuestos/recaudaciones-bancarias/importar', { texto: '﻿202610;903;50\n' });
    expect([b.status, b.body.importadas]).toEqual([201, 1]);
  });
});
