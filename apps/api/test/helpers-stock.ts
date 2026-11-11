import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { sesionConPlan } from './helpers';

type Sesion = Awaited<ReturnType<typeof sesionConPlan>>;

/** Utilidades de stock sobre una sesión con plan de cuentas (por defecto, una empresa nueva). */
export async function prepararStock(app: INestApplication, prisma: PrismaService, sesion?: Sesion) {
  const s = sesion ?? (await sesionConPlan(app, prisma));
  const deposito = await prisma.deposito.create({ data: { empresaId: s.empresaId, codigo: 'CEN', nombre: 'Central' } });
  const deposito2 = await prisma.deposito.create({ data: { empresaId: s.empresaId, codigo: 'SUC', nombre: 'Sucursal' } });
  let n = 0;
  const articulo = async (controlaStock = true, codigo = `ART-${++n}`) => {
    const r = await s.http.post('/api/articulos', { codigo, descripcion: `Artículo ${codigo}`, alicuotaIva: 21, controlaStock });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body as { id: string; codigo: string };
  };
  const documento = (d: Record<string, unknown>) => s.http.post('/api/stock/documentos', { fecha: '2026-11-02', depositoId: deposito.id, ...d });
  const inicial = async (articuloId: string, cantidad: number, costoUnitario: number, o: Record<string, unknown> = {}) =>
    documento({ tipo: 'INICIAL', conAsiento: true, cuentaContableId: await s.cuenta('3.2.01'), renglones: [{ articuloId, cantidad, costoUnitario }], ...o });
  const salida = async (articuloId: string, cantidad: number, o: Record<string, unknown> = {}) =>
    documento({ tipo: 'SALIDA', cuentaContableId: await s.cuenta('5.2.01'), renglones: [{ articuloId, cantidad }], ...o });
  const modo = (stockNegativo: 'BLOQUEAR' | 'AVISAR') => s.http.put('/api/stock/config', { stockNegativo });
  const estado = async (articuloId: string) => {
    const a = await prisma.articulo.findUniqueOrThrow({ where: { id: articuloId } });
    return { cantidad: a.stockCantidad.toString(), valor: a.stockValor.toString(), promedio: a.costoPromedio.toString() };
  };
  const saldo = async (articuloId: string, depositoId = deposito.id) =>
    (await prisma.saldoStock.findFirst({ where: { articuloId, depositoId } }))?.cantidad.toString() ?? '0';
  /** Renglones de un asiento como [código, 'D 10.00' | 'H 10.00'], ordenados por código. */
  const renglonesAsiento = async (asientoId: string) => {
    const rs = await prisma.asientoRenglon.findMany({ where: { asientoId } });
    const cuentas = new Map((await prisma.cuentaContable.findMany({ where: { empresaId: s.empresaId } })).map((c) => [c.id, c.codigo]));
    return rs.map((r) => [cuentas.get(r.cuentaContableId)!, Number(r.debe) ? `D ${Number(r.debe).toFixed(2)}` : `H ${Number(r.haber).toFixed(2)}`])
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }) || a[1].localeCompare(b[1]));
  };
  return { s, deposito, deposito2, articulo, documento, inicial, salida, modo, estado, saldo, renglonesAsiento };
}
