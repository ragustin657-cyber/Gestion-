import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { mesesDelEjercicio, mesTexto, mmaaaa, PresupuestosService } from './presupuestos.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
export type AgruparPresupuesto = 'cuenta' | 'rubro' | 'centro';
type Linea = { cuentaId: string; centroId: string | null; ingreso: boolean; presupuesto: Map<string, Dec>; real: Map<string, Dec>; presupuestada: boolean };
const suma = (m: Map<string, Dec>, meses?: string[]) => [...m].filter(([k]) => !meses || meses.includes(k)).reduce((s, [, v]) => s.plus(v), new D(0));
const pct = (desvio: Dec, base: Dec) => (base.isZero() ? null : desvio.div(base.abs()).times(100).toFixed(2));

@Injectable()
export class ComparacionService {
  constructor(private readonly tenant: TenantPrisma, private readonly presupuestos: PresupuestosService) {}

  /** Presupuesto y real por (cuenta, centro) y mes, en signo natural (spec §4). */
  private async lineas(tx: TxEmpresa, presupuestoId: string, ejercicioId: string, desde: string, hasta: string) {
    const [a1, m1] = desde.split('-').map(Number), [a2, m2] = hasta.split('-').map(Number);
    const inicio = new Date(Date.UTC(a1, m1 - 1, 1)), fin = new Date(Date.UTC(a2, m2, 0));
    const cuentas = new Map((await tx.cuentaContable.findMany({ where: { tipo: { in: ['RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO'] } } })).map((c) => [c.id, c]));
    const lineas = new Map<string, Linea>();
    const linea = (cuentaId: string, centroId: string | null) => {
      const k = `${cuentaId}|${centroId ?? ''}`;
      let l = lineas.get(k);
      if (!l) { l = { cuentaId, centroId, ingreso: cuentas.get(cuentaId)?.tipo === 'RESULTADO_POSITIVO', presupuesto: new Map(), real: new Map(), presupuestada: false }; lineas.set(k, l); }
      return l;
    };
    for (const i of await tx.presupuestoImporte.findMany({ where: { presupuestoId } })) {
      const l = linea(i.cuentaContableId, i.centroCostoId);
      l.presupuestada = true;
      const m = mesTexto(i.anio, i.mes);
      if (m >= desde && m <= hasta) l.presupuesto.set(m, new D(i.importe));
    }
    const filas = await tx.$queryRaw<{ cuentaId: string; centroId: string | null; anio: number; mes: number; debe: Prisma.Decimal; haber: Prisma.Decimal }[]>`
      SELECT r."cuentaContableId" AS "cuentaId", r."centroCostoId" AS "centroId", EXTRACT(YEAR FROM a."fecha")::int AS anio, EXTRACT(MONTH FROM a."fecha")::int AS mes, SUM(r."debe") AS debe, SUM(r."haber") AS haber
      FROM "AsientoRenglon" r JOIN "Asiento" a ON a."id" = r."asientoId" JOIN "CuentaContable" c ON c."id" = r."cuentaContableId"
      WHERE a."empresaId" = ${this.tenant.empresaId}::uuid AND a."ejercicioId" = ${ejercicioId}::uuid
        AND a."fecha" >= ${inicio.toISOString().slice(0, 10)}::date AND a."fecha" <= ${fin.toISOString().slice(0, 10)}::date
        AND a."tipo" NOT IN ('REFUNDICION', 'CIERRE', 'APERTURA') AND a."origenTipo" <> 'AJUSTE_INFLACION'
        AND c."tipo" IN ('RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO')
      GROUP BY 1, 2, 3, 4`;
    for (const f of filas) {
      const l = linea(f.cuentaId, f.centroId);
      const v = l.ingreso ? new D(f.haber).minus(f.debe) : new D(f.debe).minus(f.haber);
      const m = mesTexto(f.anio, f.mes);
      l.real.set(m, (l.real.get(m) ?? new D(0)).plus(v));
    }
    return { lineas: [...lineas.values()], cuentas };
  }

  private rango(ejercicio: { desde: Date; hasta: Date }, q: { desde?: string; hasta?: string }) {
    const meses = mesesDelEjercicio(ejercicio);
    const hoy = new Date().toISOString().slice(0, 7);
    const desde = q.desde || meses[0];
    const hasta = q.hasta || (meses.includes(hoy) ? hoy : meses[meses.length - 1]);
    for (const m of [desde, hasta]) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('Mes inválido: use AAAA-MM');
      if (!meses.includes(m)) throw new BadRequestException(`El mes ${mmaaaa(m)} no pertenece al ejercicio`);
    }
    if (desde > hasta) throw new BadRequestException('El mes desde no puede ser posterior al mes hasta');
    return { desde, hasta, meses: meses.filter((m) => m >= desde && m <= hasta) };
  }

  /** Resultado presupuestado y real del rango (para el tablero). */
  async resultado(tx: TxEmpresa, presupuestoId: string, desde: string, hasta: string) {
    const { ejercicio } = await this.presupuestos.presupuesto(tx, presupuestoId);
    const { lineas } = await this.lineas(tx, presupuestoId, ejercicio.id, desde, hasta);
    let presupuestado = new D(0), real = new D(0);
    for (const l of lineas) {
      const s = l.ingreso ? 1 : -1;
      presupuestado = presupuestado.plus(suma(l.presupuesto).times(s));
      real = real.plus(suma(l.real).times(s));
    }
    return { presupuestado, real };
  }

  async comparar(presupuestoId: string, q: { desde?: string; hasta?: string; agrupar?: string; centroCostoId?: string }) {
    const db = this.tenant.db;
    const { p, ejercicio } = await this.presupuestos.presupuesto(db, presupuestoId);
    const { desde, hasta, meses } = this.rango(ejercicio, q);
    const agrupar = (['cuenta', 'rubro', 'centro'].includes(q.agrupar ?? '') ? q.agrupar : 'cuenta') as AgruparPresupuesto;
    const { lineas: todas, cuentas } = await this.lineas(db, presupuestoId, ejercicio.id, desde, hasta);
    const lineas = todas.filter((l) => !q.centroCostoId || l.centroId === q.centroCostoId).filter((l) => l.presupuesto.size || l.real.size || l.presupuestada);
    const centros = new Map((await db.centroCosto.findMany()).map((c) => [c.id, c]));
    const porCodigo = new Map([...(await db.cuentaContable.findMany({ where: { codigo: { in: [...new Set([...cuentas.values()].map((c) => c.codigo.split('.').slice(0, 2).join('.')))] } } }))].map((c) => [c.codigo, c]));

    type Grupo = { clave: string; nombre: string; tipo: 'INGRESO' | 'EGRESO' | 'RESULTADO'; orden: string; presupuesto: Dec; real: Dec; todasSin: boolean };
    const grupos = new Map<string, Grupo>();
    for (const l of lineas) {
      const c = cuentas.get(l.cuentaId)!;
      let clave: string, nombre: string, tipo: Grupo['tipo'], orden: string;
      if (agrupar === 'centro') {
        const cc = l.centroId ? centros.get(l.centroId) : null;
        clave = l.centroId ?? 'sin-centro'; nombre = cc?.nombre ?? 'Sin centro'; tipo = 'RESULTADO'; orden = cc ? `1${cc.codigo}` : '0';
      } else if (agrupar === 'rubro') {
        clave = c.codigo.split('.').slice(0, 2).join('.'); nombre = `${clave} ${porCodigo.get(clave)?.nombre ?? ''}`.trim(); tipo = l.ingreso ? 'INGRESO' : 'EGRESO'; orden = clave;
      } else {
        clave = c.id; nombre = `${c.codigo} ${c.nombre}`; tipo = l.ingreso ? 'INGRESO' : 'EGRESO'; orden = c.codigo;
      }
      const s = tipo === 'RESULTADO' && !l.ingreso ? -1 : 1;
      const g = grupos.get(clave) ?? { clave, nombre, tipo, orden, presupuesto: new D(0), real: new D(0), todasSin: true };
      g.presupuesto = g.presupuesto.plus(suma(l.presupuesto).times(s));
      g.real = g.real.plus(suma(l.real).times(s));
      g.todasSin = g.todasSin && !l.presupuestada;
      grupos.set(clave, g);
    }
    const filas = [...grupos.values()].sort((a, b) => a.orden.localeCompare(b.orden, 'es', { numeric: true })).map((g) => {
      const desvio = g.real.minus(g.presupuesto);
      const favorable = g.tipo === 'EGRESO' ? g.real.lte(g.presupuesto) : g.real.gte(g.presupuesto);
      return { clave: g.clave, nombre: g.nombre, tipo: g.tipo, presupuesto: g.presupuesto.toFixed(2), real: g.real.toFixed(2), desvio: desvio.toFixed(2), desvioPct: pct(desvio, g.presupuesto), favorable, sinPresupuesto: g.todasSin };
    });
    const tot = (f: (l: Linea) => boolean, s = 1) => {
      const ls = lineas.filter(f);
      return { p: ls.reduce((x, l) => x.plus(suma(l.presupuesto).times(l.ingreso ? 1 : s)), new D(0)), r: ls.reduce((x, l) => x.plus(suma(l.real).times(l.ingreso ? 1 : s)), new D(0)) };
    };
    const txt = (t: { p: Dec; r: Dec }) => ({ presupuesto: t.p.toFixed(2), real: t.r.toFixed(2), desvio: t.r.minus(t.p).toFixed(2), desvioPct: pct(t.r.minus(t.p), t.p) });
    const serie = meses.map((m) => {
      let pr = new D(0), re = new D(0);
      for (const l of lineas) { const s = l.ingreso ? 1 : -1; pr = pr.plus((l.presupuesto.get(m) ?? new D(0)).times(s)); re = re.plus((l.real.get(m) ?? new D(0)).times(s)); }
      return { mes: m, presupuesto: pr.toFixed(2), real: re.toFixed(2) };
    });
    return {
      presupuesto: { id: p.id, nombre: p.nombre }, desde, hasta, agrupar, filas,
      totales: { ingresos: txt(tot((l) => l.ingreso)), egresos: txt(tot((l) => !l.ingreso)), resultado: txt(tot(() => true, -1)) },
      serie,
    };
  }
}
