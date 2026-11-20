import { INestApplication } from '@nestjs/common';
import { PadronService } from '../src/pagos/padron/padron.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('percepciones en ventas: configuración (E39)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('jurisdicción IIBB con campos de percepción', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.put('/api/pagos/config/jurisdicciones', [{
      jurisdiccion: '902', alicuotaDefecto: 0, minimoRetencion: 0, usaPadron: true, sinPadron: 'NO_RETENER',
      percibe: true, alicuotaPercepcionDefecto: 3, minimoPercepcion: 50, sinPadronPercepcion: 'ALICUOTA_DEFECTO',
    }]);
    expect(r.status).toBe(200);
    const j = ((await http.get('/api/pagos/config/jurisdicciones')).body as Record<string, unknown>[]).find((x) => x.jurisdiccion === '902');
    expect(j).toMatchObject({ percibe: true, alicuotaPercepcionDefecto: '3', minimoPercepcion: '50', sinPadronPercepcion: 'ALICUOTA_DEFECTO' });
  });

  it('régimen de percepción de IVA: uno solo activo; agente de percepción en la empresa', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    const datos = { codigo: '493', descripcion: 'RG 2408 general', alicuotaGeneral: 3, alicuotaReducida: 1.5, minimoNeto: 0, activo: true };
    expect((await http.post('/api/pagos/config/regimenes-percepcion-iva', datos)).status).toBe(201);
    const otro = await http.post('/api/pagos/config/regimenes-percepcion-iva', { ...datos, codigo: '494', descripcion: 'Otro' });
    expect([otro.status, otro.body.message]).toEqual([400, 'Active solo un régimen de percepción de IVA']);
    const inactivo = await http.post('/api/pagos/config/regimenes-percepcion-iva', { ...datos, codigo: '494', descripcion: 'Otro', activo: false });
    expect(inactivo.status).toBe(201);
    const act = await http.patch(`/api/pagos/config/regimenes-percepcion-iva/${inactivo.body.id}`, { activo: true });
    expect([act.status, act.body.message]).toEqual([400, 'Active solo un régimen de percepción de IVA']);
    expect((await http.get('/api/pagos/config/regimenes-percepcion-iva')).body).toHaveLength(2);
    expect((await http.patch('/api/empresas/actual', { agentePercepcionIva: true })).status).toBe(200);
    expect((await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId } })).agentePercepcionIva).toBe(true);
  });

  it('ficha IIBB del tercero sin alícuota de percepción queda vacía', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    const t = await prisma.tercero.create({ data: { empresaId, codigo: 1, razonSocial: 'Cliente SA', cuit: '30500010912', condicionIva: 'RESPONSABLE_INSCRIPTO', esCliente: true } });
    expect((await http.put(`/api/terceros/${t.id}/iibb`, [{ jurisdiccion: '902', alicuotaRetencion: 1 }])).status).toBe(200);
    const f = await prisma.terceroIibb.findFirstOrThrow({ where: { terceroId: t.id } });
    expect(f.alicuotaPercepcion).toBeNull();
  });

  it('alícuota de percepción del padrón vigente', async () => {
    await prisma.padronIibb.create({ data: { jurisdiccion: '902', cuit: '30500010912', vigenciaDesde: new Date('2026-11-01'), vigenciaHasta: new Date('2026-11-30'), alicuotaPercepcion: 2.5 } });
    const padron = app.get(PadronService);
    expect(await padron.alicuotaPercepcion('902', '30500010912', new Date('2026-11-10'))).toBe('2.5');
    expect(await padron.alicuotaPercepcion('902', '30500010912', new Date('2026-12-10'))).toBeNull();
  });
});
