import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('cierre del ejercicio', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function escenario(conResultados = true) {
    const s = await sesionConPlan(app, prisma);
    const c = async (codigo: string) => s.cuenta(codigo);
    const asiento = async (fecha: string, descripcion: string, renglones: object[]) => {
      const r = await s.http.post('/api/contabilidad/asientos', { fecha, descripcion, renglones });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    };
    const adm = await prisma.centroCosto.create({ data: { empresaId: s.empresaId, codigo: 'ADM', nombre: 'Adm' } });
    const com = await prisma.centroCosto.create({ data: { empresaId: s.empresaId, codigo: 'COM', nombre: 'Com' } });
    await asiento('2026-03-01', 'Aporte', [{ cuentaContableId: await c('1.1.01.002'), debe: 1000000 }, { cuentaContableId: await c('3.1.01'), haber: 1000000 }]);
    if (conResultados) {
      await asiento('2026-06-10', 'Venta', [{ cuentaContableId: await c('1.1.02.001'), debe: 300000 }, { cuentaContableId: await c('4.1.01'), haber: 300000 }]);
      await asiento('2026-09-15', 'Gasto', [
        { cuentaContableId: await c('5.2.01'), centroCostoId: adm.id, debe: 60000 }, { cuentaContableId: await c('5.2.01'), centroCostoId: com.id, debe: 40000 },
        { cuentaContableId: await c('1.1.01.002'), haber: 100000 },
      ]);
    }
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const prepararCierre = async () => {
      for (const p of ej.periodos.slice(0, 11)) {
        const r = await s.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {});
        if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      }
      await s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    };
    const renglones = async (asientoId: string) => {
      const a = await prisma.asiento.findUniqueOrThrow({ where: { id: asientoId }, include: { renglones: true } });
      const r: Record<string, [string, string]> = {};
      for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toString(), x.haber.toString()];
      return { asiento: a, r };
    };
    return { s, ej, prepararCierre, renglones };
  }

  it('requisitos y vista previa', async () => {
    const { s, ej, prepararCierre } = await escenario();
    const previa = (await s.http.get(`/api/contabilidad/ejercicios/${ej.id}/cierre/previa`)).body;
    expect(previa.faltantes).toEqual(['Cierre los períodos hasta 11/2026', 'Abra el ejercicio siguiente']);
    expect(previa.resultado).toBe('200000');
    const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Cierre los períodos hasta 11/2026');
    await prepararCierre();
    expect((await s.http.get(`/api/contabilidad/ejercicios/${ej.id}/cierre/previa`)).body.faltantes).toEqual([]);
  });

  it('refundición, cierre y apertura', async () => {
    const { s, ej, prepararCierre, renglones } = await escenario();
    await prepararCierre();
    const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
    expect(r.body.message).toBeUndefined();
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('CERRADO');
    const refundicion = await renglones(r.body.asientoRefundicionId);
    expect(refundicion.asiento.tipo).toBe('REFUNDICION');
    expect(refundicion.r).toEqual({ '4.1.01': ['300000', '0'], '5.2.01': ['0', '100000'], '3.2.02': ['0', '200000'] });
    expect(refundicion.asiento.renglones).toHaveLength(3);
    const cierre = await renglones(r.body.asientoCierreId);
    expect(cierre.r).toEqual({ '1.1.01.002': ['0', '900000'], '1.1.02.001': ['0', '300000'], '3.1.01': ['1000000', '0'], '3.2.02': ['200000', '0'] });
    const apertura = await renglones(r.body.asientoAperturaId);
    expect(apertura.asiento.fecha.toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(apertura.asiento.tipo).toBe('APERTURA');
    expect(apertura.r).toEqual({ '1.1.01.002': ['900000', '0'], '1.1.02.001': ['300000', '0'], '3.1.01': ['0', '1000000'], '3.2.02': ['0', '200000'] });
    // Todo patrimonial en cero en 2026 incluyendo el cierre
    const ss = (await s.http.get(`/api/contabilidad/sumas-saldos?ejercicioId=${ej.id}&incluirCierre=true`)).body;
    expect(ss.filas.filter((f: { imputable: boolean }) => f.imputable).every((f: { saldoDeudor: string; saldoAcreedor: string }) => f.saldoDeudor === '0' && f.saldoAcreedor === '0')).toBe(true);
    // Diciembre cerrado y numeración: refundición y cierre al final
    const dic = await prisma.periodoContable.findFirstOrThrow({ where: { ejercicioId: ej.id, mes: 12 } });
    expect(dic.estado).toBe('CERRADO');
    expect([refundicion.asiento.numeroDefinitivo, cierre.asiento.numeroDefinitivo]).toEqual([4, 5]);
    // Fecha en el ejercicio cerrado
    const tarde = await s.http.post('/api/contabilidad/asientos', { fecha: '2026-12-20', descripcion: 'x', renglones: [{ cuentaContableId: await s.cuenta('5.2.01'), debe: 1 }, { cuentaContableId: await s.cuenta('1.1.01.001'), haber: 1 }] });
    expect(tarde.body.message).toBe('El ejercicio 1 está cerrado');
  });

  it('reabrir el ejercicio', async () => {
    const { s, ej, prepararCierre } = await escenario();
    await prepararCierre();
    const c = (await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {})).body;
    const sig = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 2 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    await s.http.post(`/api/contabilidad/periodos/${sig.periodos[0].id}/cerrar`, {});
    const bloqueado = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/reabrir`, { motivo: 'x' });
    expect(bloqueado.status).toBe(400);
    expect(await prisma.asiento.findUniqueOrThrow({ where: { id: c.asientoAperturaId } }).then((a) => a.numeroDefinitivo)).toBe(1);
    await s.http.post(`/api/contabilidad/periodos/${sig.periodos[0].id}/reabrir`, { motivo: 'x' });
    const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/reabrir`, { motivo: 'Ajuste de auditoría' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'ABIERTO', asientoRefundicionId: null, asientoCierreId: null, asientoAperturaId: null });
    expect(await prisma.asiento.count({ where: { id: { in: [c.asientoRefundicionId, c.asientoCierreId, c.asientoAperturaId] } } })).toBe(0);
    expect((await prisma.periodoContable.findFirstOrThrow({ where: { ejercicioId: ej.id, mes: 12 } })).estado).toBe('ABIERTO');
  });

  it('sin resultados no hay refundición pero cierra igual', async () => {
    const { s, ej, prepararCierre } = await escenario(false);
    await prepararCierre();
    const r = await s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
    expect(r.status).toBe(200);
    expect(r.body.asientoRefundicionId).toBeNull();
    expect(r.body.asientoCierreId).toBeTruthy();
    expect(r.body.asientoAperturaId).toBeTruthy();
  });
});
