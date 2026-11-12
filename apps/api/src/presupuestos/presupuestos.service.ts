import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Ejercicio, Presupuesto, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { DatosLinea, DatosPresupuesto } from './dto';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const RESULTADOS = ['RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO'];
export const mesTexto = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, '0')}`;
export const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Meses 'AAAA-MM' del ejercicio, en orden. */
export function mesesDelEjercicio(e: Pick<Ejercicio, 'desde' | 'hasta'>): string[] {
  const r: string[] = [];
  let a = e.desde.getUTCFullYear(), m = e.desde.getUTCMonth() + 1;
  const fin = mesTexto(e.hasta.getUTCFullYear(), e.hasta.getUTCMonth() + 1);
  for (;;) {
    const t = mesTexto(a, m);
    r.push(t);
    if (t >= fin) break;
    if (m === 12) { a++; m = 1; } else m++;
  }
  return r;
}

@Injectable()
export class PresupuestosService {
  constructor(private readonly tenant: TenantPrisma, private readonly cls: ClsService) {}

  async razonSocial() {
    return (await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } })).razonSocial;
  }

  async presupuesto(tx: TxEmpresa, id: string, paraModificar = false) {
    const p = await tx.presupuesto.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Presupuesto inexistente');
    const ejercicio = await tx.ejercicio.findUniqueOrThrow({ where: { id: p.ejercicioId } });
    if (paraModificar && ejercicio.estado === 'CERRADO') throw new BadRequestException('El ejercicio está cerrado');
    return { p, ejercicio };
  }

  /** Valida cuenta de resultados imputable, centro activo y meses del ejercicio. */
  async validarLinea(tx: TxEmpresa, ejercicio: Ejercicio, d: { cuentaContableId: string; centroCostoId?: string | null; meses: string[] }) {
    const c = await tx.cuentaContable.findUnique({ where: { id: d.cuentaContableId } });
    if (!c) throw new BadRequestException('Cuenta contable inexistente');
    if (!c.imputable || !RESULTADOS.includes(c.tipo)) throw new BadRequestException(`La cuenta ${c.codigo} no es de resultados`);
    if (d.centroCostoId) {
      const cc = await tx.centroCosto.findUnique({ where: { id: d.centroCostoId } });
      if (!cc || !cc.activo) throw new BadRequestException('Centro de costo inexistente o inactivo');
    }
    const meses = mesesDelEjercicio(ejercicio);
    for (const m of d.meses) if (!meses.includes(m)) throw new BadRequestException(`El mes ${mmaaaa(m)} no pertenece al ejercicio`);
    return c;
  }

  private async totales(tx: TxEmpresa, ids: string[]) {
    const filas = await tx.presupuestoImporte.findMany({ where: { presupuestoId: { in: ids } }, select: { presupuestoId: true, cuentaContableId: true, importe: true } });
    const tipos = new Map((await tx.cuentaContable.findMany({ where: { id: { in: [...new Set(filas.map((f) => f.cuentaContableId))] } }, select: { id: true, tipo: true } })).map((c) => [c.id, c.tipo]));
    const r = new Map<string, { ingresos: Dec; egresos: Dec }>();
    for (const f of filas) {
      const t = r.get(f.presupuestoId) ?? { ingresos: new D(0), egresos: new D(0) };
      if (tipos.get(f.cuentaContableId) === 'RESULTADO_POSITIVO') t.ingresos = t.ingresos.plus(f.importe);
      else t.egresos = t.egresos.plus(f.importe);
      r.set(f.presupuestoId, t);
    }
    return r;
  }

  async listar(ejercicioId?: string) {
    const db = this.tenant.db;
    const ps = await db.presupuesto.findMany({ where: ejercicioId ? { ejercicioId } : {}, orderBy: [{ creadoEn: 'asc' }] });
    const ejercicios = new Map((await db.ejercicio.findMany({ where: { id: { in: ps.map((p) => p.ejercicioId) } } })).map((e) => [e.id, e]));
    const tot = await this.totales(db, ps.map((p) => p.id));
    return ps.map((p) => ({
      ...p, ejercicio: { id: p.ejercicioId, numero: ejercicios.get(p.ejercicioId)?.numero },
      totalIngresos: (tot.get(p.id)?.ingresos ?? new D(0)).toFixed(2), totalEgresos: (tot.get(p.id)?.egresos ?? new D(0)).toFixed(2),
    }));
  }

  crear(d: DatosPresupuesto) {
    return this.tenant.transaccion(async (tx) => {
      const ej = await tx.ejercicio.findUnique({ where: { id: d.ejercicioId } });
      if (!ej) throw new BadRequestException('Ejercicio inexistente');
      if (ej.estado === 'CERRADO') throw new BadRequestException('El ejercicio está cerrado');
      if (await tx.presupuesto.findFirst({ where: { ejercicioId: d.ejercicioId, nombre: d.nombre } })) throw new BadRequestException(`Ya existe el presupuesto ${d.nombre} en el ejercicio`);
      const p = await tx.presupuesto.create({ data: { empresaId: this.tenant.empresaId, ejercicioId: d.ejercicioId, nombre: d.nombre, observaciones: d.observaciones ?? null, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId } });
      if (d.copiarDeId) {
        const origen = await tx.presupuesto.findUnique({ where: { id: d.copiarDeId } });
        if (!origen || origen.ejercicioId !== d.ejercicioId) throw new BadRequestException('Solo se copian presupuestos del mismo ejercicio');
        const imps = await tx.presupuestoImporte.findMany({ where: { presupuestoId: origen.id } });
        if (imps.length) await tx.presupuestoImporte.createMany({ data: imps.map(({ id, presupuestoId, ...x }) => { void id; void presupuestoId; return { ...x, presupuestoId: p.id }; }) });
      }
      return p;
    });
  }

  modificar(id: string, d: { nombre: string; observaciones?: string | null }) {
    return this.tenant.transaccion(async (tx) => {
      const { p } = await this.presupuesto(tx, id, true);
      if (await tx.presupuesto.findFirst({ where: { ejercicioId: p.ejercicioId, nombre: d.nombre, id: { not: id } } })) throw new BadRequestException(`Ya existe el presupuesto ${d.nombre} en el ejercicio`);
      return tx.presupuesto.update({ where: { id }, data: { nombre: d.nombre, observaciones: d.observaciones ?? null } });
    });
  }

  marcarVigente(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const { p } = await this.presupuesto(tx, id);
      await tx.presupuesto.updateMany({ where: { ejercicioId: p.ejercicioId, vigente: true, id: { not: id } }, data: { vigente: false } });
      return tx.presupuesto.update({ where: { id }, data: { vigente: true } });
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const { p } = await this.presupuesto(tx, id, true);
      if (p.vigente) throw new BadRequestException('Marque otro presupuesto como vigente antes de eliminarlo');
      await tx.presupuesto.delete({ where: { id } });
      return { ok: true };
    });
  }

  /** Grilla: líneas (cuenta + centro) × meses del ejercicio, con totales. */
  async grilla(id: string, tx: TxEmpresa = this.tenant.db) {
    const { p, ejercicio } = await this.presupuesto(tx, id);
    const meses = mesesDelEjercicio(ejercicio);
    const imps = await tx.presupuestoImporte.findMany({ where: { presupuestoId: id } });
    const cuentas = new Map((await tx.cuentaContable.findMany({ where: { id: { in: [...new Set(imps.map((i) => i.cuentaContableId))] } } })).map((c) => [c.id, c]));
    const centros = new Map((await tx.centroCosto.findMany({ where: { id: { in: [...new Set(imps.map((i) => i.centroCostoId).filter((x): x is string => !!x))] } } })).map((c) => [c.id, c]));
    const lineas = new Map<string, { cuentaContableId: string; centroCostoId: string | null; importes: Map<string, Dec> }>();
    for (const i of imps) {
      const k = `${i.cuentaContableId}|${i.centroCostoId ?? ''}`;
      const l = lineas.get(k) ?? { cuentaContableId: i.cuentaContableId, centroCostoId: i.centroCostoId, importes: new Map() };
      l.importes.set(mesTexto(i.anio, i.mes), new D(i.importe));
      lineas.set(k, l);
    }
    const porMes = new Map(meses.map((m) => [m, new D(0)]));
    let ingresos = new D(0), egresos = new D(0);
    const filas = [...lineas.values()].map((l) => {
      const c = cuentas.get(l.cuentaContableId)!;
      const signo = c.tipo === 'RESULTADO_POSITIVO' ? 1 : -1;
      let total = new D(0);
      for (const m of meses) {
        const v = l.importes.get(m) ?? new D(0);
        total = total.plus(v);
        porMes.set(m, porMes.get(m)!.plus(v.times(signo)));
      }
      if (signo > 0) ingresos = ingresos.plus(total); else egresos = egresos.plus(total);
      const cc = l.centroCostoId ? centros.get(l.centroCostoId) : null;
      return {
        cuentaContableId: c.id, codigo: c.codigo, nombre: c.nombre, tipo: signo > 0 ? 'INGRESO' : 'EGRESO', centroCostoId: l.centroCostoId, centroCosto: cc?.nombre ?? null, centroCodigo: cc?.codigo ?? '',
        importes: Object.fromEntries(meses.map((m) => [m, (l.importes.get(m) ?? new D(0)).toFixed(2)])), total: total.toFixed(2),
      };
    }).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.centroCodigo.localeCompare(b.centroCodigo))
      .map(({ centroCodigo, ...f }) => { void centroCodigo; return f; });
    return {
      presupuesto: p as Presupuesto, meses, lineas: filas,
      totales: { porMes: Object.fromEntries([...porMes].map(([m, v]) => [m, v.toFixed(2)])), ingresos: ingresos.toFixed(2), egresos: egresos.toFixed(2), resultado: ingresos.minus(egresos).toFixed(2) },
    };
  }

  /** Reemplaza los importes de una línea (en la transacción dada). */
  async reemplazarLinea(tx: TxEmpresa, presupuestoId: string, cuentaContableId: string, centroCostoId: string | null, importes: Record<string, Dec | number>) {
    await tx.presupuestoImporte.deleteMany({ where: { presupuestoId, cuentaContableId, centroCostoId } });
    const data = Object.entries(importes).filter(([, v]) => !new D(v).isZero()).map(([m, v]) => ({
      empresaId: this.tenant.empresaId, presupuestoId, cuentaContableId, centroCostoId, anio: Number(m.slice(0, 4)), mes: Number(m.slice(5, 7)), importe: new D(v),
    }));
    if (data.length) await tx.presupuestoImporte.createMany({ data });
  }

  guardarLinea(id: string, d: DatosLinea) {
    return this.tenant.transaccion(async (tx) => {
      const { ejercicio } = await this.presupuesto(tx, id, true);
      await this.validarLinea(tx, ejercicio, { cuentaContableId: d.cuentaContableId, centroCostoId: d.centroCostoId, meses: Object.keys(d.importes) });
      await this.reemplazarLinea(tx, id, d.cuentaContableId, d.centroCostoId ?? null, d.importes);
      await tx.presupuesto.update({ where: { id }, data: { actualizadoEn: new Date() } });
      return this.grilla(id, tx);
    });
  }

  eliminarLinea(id: string, cuentaContableId: string, centroCostoId: string | null) {
    return this.tenant.transaccion(async (tx) => {
      await this.presupuesto(tx, id, true);
      await tx.presupuestoImporte.deleteMany({ where: { presupuestoId: id, cuentaContableId, centroCostoId } });
      return this.grilla(id, tx);
    });
  }
}
