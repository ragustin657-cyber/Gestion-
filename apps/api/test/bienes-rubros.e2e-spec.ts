import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

type Rubro = { id: string; nombre: string; vidaUtilMeses: number; cuentaOrigen: { codigo: string } };

describe('bienes de uso: rubros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('empresa nueva trae cuentas y rubros precargados', async () => {
    const s = await sesionConPlan(app, prisma);
    const r = (await s.http.get('/api/bienes-uso/rubros')).body as Rubro[];
    expect(r.map((x) => [x.nombre, x.vidaUtilMeses])).toEqual([['Equipos de computación', 36], ['Muebles y útiles', 120], ['Rodados', 60]]);
    expect(r.find((x) => x.nombre === 'Rodados')!.cuentaOrigen.codigo).toBe('1.2.01.002');
    const amort = await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo: '1.2.02.002' } });
    expect(amort.monetaria).toBe(false);
    for (const codigo of ['5.2.07', '5.2.08', '4.2.05']) expect(await prisma.cuentaContable.count({ where: { empresaId: s.empresaId, codigo, imputable: true } })).toBe(1);
  });

  it('valida rubros', async () => {
    const s = await sesionConPlan(app, prisma);
    const id = async (codigo: string) => (await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo } })).id;
    const base = { nombre: 'Instalaciones', cuentaAmortizacionId: await id('1.2.02.001'), cuentaGastoId: await id('5.2.07'), vidaUtilMeses: 120 };
    expect((await s.http.post('/api/bienes-uso/rubros', { ...base, cuentaOrigenId: await id('1.2.01') })).body.message).toBe('La cuenta 1.2.01 no es imputable');
    expect((await s.http.post('/api/bienes-uso/rubros', { ...base, cuentaOrigenId: await id('1.2.01.002') })).body.message).toBe('La cuenta 1.2.01.002 ya es de otro rubro');
    expect((await s.http.post('/api/bienes-uso/rubros', { ...base, cuentaOrigenId: await id('1.1.05.001'), vidaUtilMeses: 0 })).status).toBe(400);
    const ok = await s.http.post('/api/bienes-uso/rubros', { ...base, cuentaOrigenId: await id('1.1.05.001') });
    expect(ok.status).toBe(201);
    expect((await s.http.put(`/api/bienes-uso/rubros/${ok.body.id}`, { ...base, cuentaOrigenId: await id('1.1.05.001'), vidaUtilMeses: 240 })).body.vidaUtilMeses).toBe(240);
  });

  it('permisos', async () => {
    const s = await sesionConPlan(app, prisma);
    const u = await otroUsuario(app, prisma, s.empresaId, ['bienes.ver']);
    expect((await u.http.get('/api/bienes-uso/rubros')).status).toBe(200);
    expect((await u.http.post('/api/bienes-uso/rubros', { nombre: 'x' })).status).toBe(403);
  });
});
