import { BadRequestException, Injectable } from '@nestjs/common';
import type { CuentaContable, Ejercicio } from '@prisma/client';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { arbolSaldos, D, Dec, ejercicioDe, ejercicioDelRango, saldosPorCuenta } from '../consultas/saldos';

const hoy = () => new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
export interface FilaEstado { codigo: string; nombre: string; nivel: number; importe: string; importeAnterior?: string }
export interface Bloque { total: string; filas: FilaEstado[] }

/** Signo de presentación: activo y gastos con saldo deudor positivo; pasivo, PN e ingresos con saldo acreedor positivo. */
const deudora = (tipo: string) => tipo === 'ACTIVO' || tipo === 'RESULTADO_NEGATIVO';

@Injectable()
export class EstadosService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Saldo presentado por cuenta (todas las imputables con saldo) y filas por tipo hasta `nivel`. */
  private async saldos(tx: TxEmpresa, ej: Ejercicio, desde: Date | undefined, hasta: Date, excluir: ('CIERRE' | 'REFUNDICION')[]) {
    const s = await saldosPorCuenta(tx, { ejercicioId: ej.id, desde, hasta, excluirTipos: excluir });
    const cuentas = await tx.cuentaContable.findMany();
    return { s, cuentas };
  }

  private bloque(cuentas: CuentaContable[], s: Awaited<ReturnType<typeof saldosPorCuenta>>, tipo: string, nivel: number): Bloque {
    const del = cuentas.filter((c) => c.tipo === tipo);
    const signo = (debe: string, haber: string) => (deudora(tipo) ? new D(debe).minus(haber) : new D(haber).minus(debe));
    const filas = arbolSaldos(del, s, nivel).map((f) => ({ codigo: f.codigo, nombre: f.nombre, nivel: f.nivel, importe: signo(f.debe, f.haber).toString() }));
    const total = arbolSaldos(del, s).filter((f) => f.imputable).reduce((t, f) => t.plus(signo(f.debe, f.haber)), new D(0));
    return { total: total.toString(), filas };
  }

  /** Neto de resultados (positivo = ganancia) en los saldos. */
  private resultadoNeto(cuentas: CuentaContable[], s: Awaited<ReturnType<typeof saldosPorCuenta>>): Dec {
    let r = new D(0);
    for (const c of cuentas) if (c.tipo === 'RESULTADO_POSITIVO' || c.tipo === 'RESULTADO_NEGATIVO') {
      const x = s.get(c.id);
      if (x) r = r.plus(x.haber).minus(x.debe);
    }
    return r;
  }

  private async situacionA(tx: TxEmpresa, fecha: Date, nivel: number) {
    const ej = await ejercicioDe(tx, fecha);
    const { s, cuentas } = await this.saldos(tx, ej, undefined, fecha, ['CIERRE']);
    const activo = this.bloque(cuentas, s, 'ACTIVO', nivel);
    const pasivo = this.bloque(cuentas, s, 'PASIVO', nivel);
    const pn = this.bloque(cuentas, s, 'PATRIMONIO_NETO', nivel);
    const enCurso = this.resultadoNeto(cuentas, s);
    const totalPn = new D(pn.total).plus(enCurso);
    return {
      ej, fecha, activo, pasivo, patrimonioNeto: { ...pn, total: totalPn.toString() },
      resultadoEnCurso: enCurso.isZero() ? null : enCurso.toString(),
      control: new D(activo.total).minus(new D(pasivo.total).plus(totalPn)).toString(),
    };
  }

  async situacion(q: { fecha?: string; nivel?: string }) {
    const db = this.tenant.db;
    const nivel = q.nivel ? Number(q.nivel) : 3;
    if (!Number.isInteger(nivel) || nivel < 1) throw new BadRequestException('Nivel inválido');
    let fecha = fechaQuery(q.fecha);
    if (!fecha) fecha = (await db.ejercicio.findFirst({ where: { estado: 'CERRADO' }, orderBy: { numero: 'desc' } }))?.hasta ?? hoy();
    const actual = await this.situacionA(db, fecha, nivel);
    const anterior = await db.ejercicio.findFirst({ where: { numero: actual.ej.numero - 1 } });
    let comparativo = null;
    if (anterior) {
      const a = await this.situacionA(db, anterior.hasta, nivel);
      const previo = (b: Bloque, x: Bloque) => b.filas.forEach((f) => (f.importeAnterior = x.filas.find((y) => y.codigo === f.codigo)?.importe ?? '0'));
      previo(actual.activo, a.activo);
      previo(actual.pasivo, a.pasivo);
      previo(actual.patrimonioNeto, a.patrimonioNeto);
      comparativo = { fecha: anterior.hasta, activo: a.activo.total, pasivo: a.pasivo.total, patrimonioNeto: a.patrimonioNeto.total };
    }
    const { ej, ...resto } = actual;
    return { ...resto, ejercicio: { id: ej.id, numero: ej.numero }, comparativo };
  }

  private async resultadosEn(tx: TxEmpresa, ej: Ejercicio, desde: Date, hasta: Date, nivel: number) {
    const { s, cuentas } = await this.saldos(tx, ej, desde, hasta, ['CIERRE', 'REFUNDICION']);
    const positivos = this.bloque(cuentas, s, 'RESULTADO_POSITIVO', nivel);
    const negativos = this.bloque(cuentas, s, 'RESULTADO_NEGATIVO', nivel);
    return { positivos, negativos, resultado: new D(positivos.total).minus(negativos.total).toString() };
  }

  async resultados(q: { desde?: string; hasta?: string; nivel?: string }) {
    const db = this.tenant.db;
    const nivel = q.nivel ? Number(q.nivel) : 3;
    const ej = await ejercicioDelRango(db, fechaQuery(q.desde), fechaQuery(q.hasta), hoy());
    const desde = fechaQuery(q.desde) ?? ej.desde;
    const hasta = fechaQuery(q.hasta) ?? ej.hasta;
    const actual = await this.resultadosEn(db, ej, desde, hasta, nivel);
    const anterior = await db.ejercicio.findFirst({ where: { numero: ej.numero - 1 } });
    const unAnio = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
    const comparativo = anterior ? await this.resultadosEn(db, anterior, unAnio(desde), unAnio(hasta), nivel) : null;
    return { ejercicio: { id: ej.id, numero: ej.numero }, desde, hasta, ...actual, comparativo };
  }
}
