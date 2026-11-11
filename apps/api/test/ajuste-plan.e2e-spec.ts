import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('ajuste por inflación: plan de cuentas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('el plan modelo trae la clasificación monetaria, las cuentas nuevas y los conceptos', async () => {
    const s = await sesionConPlan(app, prisma);
    const c = async (codigo: string) => prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo } });
    expect((await c('1.1.01.002')).monetaria).toBe(true);
    expect((await c('1.2.01.002')).monetaria).toBe(false);
    expect((await c('3.1.01')).cuentaAjusteId).toBe((await c('3.1.02')).id);
    expect((await c('3.1.02')).monetaria).toBe(false);
    expect((await c('4.2.03')).nombre).toBe('Resultado por exposición a la inflación (RECPAM)');
    expect((await c('4.1.01')).monetaria).toBe(false);
    const cuentas = (await s.http.get('/api/compras/config')).body.cuentas;
    expect(cuentas).toContainEqual({ concepto: 'RECPAM', cuentaContableId: (await c('4.2.03')).id });
    expect(cuentas).toContainEqual({ concepto: 'RESULTADOS_NO_ASIGNADOS', cuentaContableId: (await c('3.2.01')).id });
  });

  it('una cuenta nueva hereda la clasificación de la madre', async () => {
    const s = await sesionConPlan(app, prisma);
    const a = await s.http.post('/api/plan-cuentas', { codigo: '1.2.01.004', nombre: 'Instalaciones', padreId: await s.cuenta('1.2.01'), imputable: true });
    expect(a.status).toBe(201);
    expect(a.body.monetaria).toBe(false);
    const b = await s.http.post('/api/plan-cuentas', { codigo: '1.1.01.006', nombre: 'Caja chica', padreId: await s.cuenta('1.1.01'), imputable: true });
    expect(b.body.monetaria).toBe(true);
    const c = await s.http.post('/api/plan-cuentas', { codigo: '1.1.01.007', nombre: 'Caja 2', padreId: await s.cuenta('1.1.01'), imputable: true, monetaria: false });
    expect(c.body.monetaria).toBe(false);
  });

  it('valida la cuenta de ajuste', async () => {
    const s = await sesionConPlan(app, prisma);
    const patch = async (codigo: string, d: Record<string, unknown>) => s.http.patch(`/api/plan-cuentas/${await s.cuenta(codigo)}`, d);
    const ajuste = async (codigo: string, de: string) => patch(codigo, { cuentaAjusteId: await s.cuenta(de) });
    const msj = async (p: Promise<{ status: number; body: { message: string } }>) => { const r = await p; return r.status === 400 ? r.body.message : `HTTP ${r.status}`; };
    expect(await msj(ajuste('1.1.01.002', '3.1.02'))).toBe('Solo las cuentas no monetarias tienen cuenta de ajuste');
    expect(await msj(ajuste('1.2.01.002', '1.1.01.002'))).toBe('La cuenta de ajuste debe ser imputable y no monetaria');
    expect(await msj(ajuste('1.2.01.002', '1.2.01'))).toBe('La cuenta de ajuste debe ser imputable y no monetaria');
    expect(await msj(ajuste('1.2.01.002', '1.2.01.002'))).toBe('La cuenta de ajuste no puede ser la misma cuenta');
    expect(await msj(ajuste('1.2.01.002', '3.1.02'))).toBe('La cuenta de ajuste ya ajusta a la cuenta 3.1.01');
    expect(await msj(ajuste('3.1.02', '1.2.01.003'))).toBe('Una cuenta de ajuste no puede tener a su vez cuenta de ajuste');
    expect((await ajuste('1.2.01.002', '1.2.01.003')).status).toBe(200);
    expect(await msj(ajuste('1.2.01.003', '5.2.01'))).toBe('Una cuenta de ajuste no puede tener a su vez cuenta de ajuste');
    expect(await msj(ajuste('1.2.01.001', '1.2.01.002'))).toBe('Una cuenta de ajuste no puede tener a su vez cuenta de ajuste');
    expect(await msj(patch('1.2.01.002', { monetaria: true }))).toBe('Solo las cuentas no monetarias tienen cuenta de ajuste');
    const arbol = (await s.http.get('/api/plan-cuentas')).body;
    const buscar = (ns: { codigo: string; hijos: unknown[] }[], codigo: string): any => {
      for (const n of ns) { if (n.codigo === codigo) return n; const h = buscar(n.hijos as never, codigo); if (h) return h; }
    };
    expect(buscar(arbol, '1.2.01.002').cuentaAjusteId).toBe(await s.cuenta('1.2.01.003'));
    expect(buscar(arbol, '1.2.01.002').monetaria).toBe(false);
    expect((await patch('1.2.01.002', { cuentaAjusteId: null })).status).toBe(200);
    expect((await patch('1.2.01.002', { monetaria: true })).body.monetaria).toBe(true);
  });
});
