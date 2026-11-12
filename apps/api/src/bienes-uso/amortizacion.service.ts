import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Ejercicio, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { AsientosService, RenglonAsiento } from '../contabilidad/asientos/asientos.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { acumuladaEsperada, Mes, mesDe } from './calculo';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const mmaaaa = (m: Mes) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const finDeMes = (m: Mes) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)); };
const inicioDeMes = (m: Mes) => new Date(`${m}-01T00:00:00Z`);

/** Contabilizada vigente por bien (amortizaciones de procesos vigentes). */
async function contabilizadas(tx: TxEmpresa, bienIds: string[]): Promise<Map<string, Dec>> {
  if (!bienIds.length) return new Map();
  const g = await tx.amortizacionBien.groupBy({ by: ['bienId'], where: { bienId: { in: bienIds }, proceso: { estado: 'VIGENTE' } }, _sum: { importe: true } });
  return new Map(g.map((x) => [x.bienId, new D(x._sum.importe ?? 0)]));
}

/** Amortización pendiente de cada bien hasta el mes (esperada − contabilizada − inicial), spec §4. */
export async function calcularAmortizacion(tx: TxEmpresa, mes: Mes, bienId?: string) {
  const bienes = await tx.bienUso.findMany({ where: { fechaAlta: { lte: finDeMes(mes) }, ...(bienId ? { id: bienId } : {}) }, include: { rubro: true }, orderBy: { numero: 'asc' } });
  const hechas = await contabilizadas(tx, bienes.map((b) => b.id));
  return bienes.map((b) => ({ bien: b, importe: acumuladaEsperada(b, mes).minus(b.amortizacionInicial).minus(hechas.get(b.id) ?? 0) })).filter((x) => !x.importe.isZero());
}

/** Requisito de cierre: amortización del mes de cierre generada y al día (solo con bienes en el ejercicio). */
export async function faltanteCierreAmortizacion(tx: TxEmpresa, e: Ejercicio): Promise<string | null> {
  const hay = await tx.bienUso.count({ where: { fechaAlta: { lte: e.hasta }, OR: [{ fechaBaja: null }, { fechaBaja: { gte: e.desde } }] } });
  if (!hay) return null;
  const mes = mesDe(e.hasta);
  const vigente = await tx.procesoAmortizacion.count({ where: { mes, estado: 'VIGENTE' } });
  if (!vigente || (await calcularAmortizacion(tx, mes)).length) return `Genere la amortización de bienes de uso de ${mmaaaa(mes)}`;
  return null;
}

@Injectable()
export class AmortizacionService {
  constructor(private readonly tenant: TenantPrisma, private readonly asientos: AsientosService, private readonly cls: ClsService) {}

  private validarMes(mes: string | undefined): Mes {
    if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new BadRequestException('Mes inválido: use AAAA-MM');
    return mes;
  }

  /** Lo que falta contabilizar hasta el mes, por bien y por rubro. */
  async previa(mesQ: string | undefined, tx: TxEmpresa = this.tenant.db) {
    const mes = this.validarMes(mesQ);
    const items = await calcularAmortizacion(tx, mes);
    const porRubro = new Map<string, { rubroId: string; nombre: string; importe: Dec }>();
    for (const i of items) {
      const r = porRubro.get(i.bien.rubroId) ?? { rubroId: i.bien.rubroId, nombre: i.bien.rubro.nombre, importe: new D(0) };
      r.importe = r.importe.plus(i.importe);
      porRubro.set(i.bien.rubroId, r);
    }
    return {
      mes,
      filas: items.map((i) => ({ bienId: i.bien.id, numero: i.bien.numero, descripcion: i.bien.descripcion, rubro: i.bien.rubro.nombre, importe: i.importe.toFixed(2) })),
      porRubro: [...porRubro.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((r) => ({ ...r, importe: r.importe.toFixed(2) })),
      total: items.reduce((s, i) => s.plus(i.importe), new D(0)).toFixed(2),
    };
  }

  /** Lo pendiente de un bien hasta el mes (usado por bajas y ventas). */
  async pendienteHasta(tx: TxEmpresa, bienId: string, mes: Mes): Promise<Dec> {
    const [x] = await calcularAmortizacion(tx, mes, bienId);
    return x?.importe ?? new D(0);
  }

  generar(mesQ: string | undefined) {
    const mes = this.validarMes(mesQ);
    return this.tenant.transaccion(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`amortizacion:${this.tenant.empresaId}`}))`;
      const ultimo = await tx.procesoAmortizacion.findFirst({ where: { estado: 'VIGENTE' }, orderBy: [{ mes: 'desc' }, { creadoEn: 'desc' }] });
      if (ultimo && ultimo.mes > mes) throw new BadRequestException(`Ya hay una amortización generada para un mes posterior: ${mmaaaa(ultimo.mes)}`);
      const items = await calcularAmortizacion(tx, mes);
      if (!items.length) throw new BadRequestException(`No hay amortizaciones para contabilizar en ${mmaaaa(mes)}`);
      const grupos = new Map<string, { gasto: string; amort: string; origen: Mes; importe: Dec }>();
      for (const i of items) {
        const origen = mesDe(i.bien.fechaAlta);
        const k = `${i.bien.rubroId}|${origen}`;
        const g = grupos.get(k) ?? { gasto: i.bien.rubro.cuentaGastoId, amort: i.bien.rubro.cuentaAmortizacionId, origen, importe: new D(0) };
        g.importe = g.importe.plus(i.importe);
        grupos.set(k, g);
      }
      const renglones: RenglonAsiento[] = [...grupos.values()].flatMap((g) => [
        { cuentaContableId: g.gasto, debe: g.importe.toFixed(2), fechaOrigen: inicioDeMes(g.origen) },
        { cuentaContableId: g.amort, haber: g.importe.toFixed(2), fechaOrigen: inicioDeMes(g.origen) },
      ]);
      const id = randomUUID();
      const asiento = await this.asientos.generar(tx, { fecha: finDeMes(mes), descripcion: `Amortización de bienes de uso ${mmaaaa(mes)}`, origenTipo: 'AMORTIZACION', origenId: id, renglones });
      await tx.procesoAmortizacion.create({ data: { id, empresaId: this.tenant.empresaId, mes, asientoId: asiento.id, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId } });
      await tx.amortizacionBien.createMany({ data: items.map((i) => ({ empresaId: this.tenant.empresaId, bienId: i.bien.id, procesoId: id, mes, importe: i.importe })) });
      const total = items.reduce((s, i) => s.plus(i.importe), new D(0));
      return { id, mes, asientoId: asiento.id, numeroAsiento: asiento.numero, total: total.toFixed(2), estado: 'VIGENTE' };
    });
  }

  anular(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`amortizacion:${this.tenant.empresaId}`}))`;
      const p = await tx.procesoAmortizacion.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Amortización inexistente');
      if (p.estado !== 'VIGENTE') throw new BadRequestException('La amortización ya está anulada');
      const ultimo = await tx.procesoAmortizacion.findFirst({ where: { estado: 'VIGENTE' }, orderBy: [{ mes: 'desc' }, { creadoEn: 'desc' }] });
      if (ultimo!.id !== id) throw new BadRequestException('Solo se puede anular la última amortización generada');
      // Un bien dado de baja después de esta amortización la necesita
      const bajas = await tx.bienUso.count({ where: { estado: 'BAJA', amortizaciones: { some: { procesoId: id } } } });
      if (bajas) throw new BadRequestException('Hay bienes dados de baja después de esta amortización: anule primero la baja');
      const asiento = await tx.asiento.findUniqueOrThrow({ where: { id: p.asientoId } });
      await this.asientos.contraasiento(tx, p.asientoId, asiento.fecha, `Anulación: amortización de bienes de uso ${mmaaaa(p.mes)}`);
      await tx.procesoAmortizacion.update({ where: { id }, data: { estado: 'ANULADO' } });
      return { ok: true };
    });
  }

  async listar() {
    const db = this.tenant.db;
    const ps = await db.procesoAmortizacion.findMany({ orderBy: { creadoEn: 'desc' }, include: { items: { select: { importe: true } } } });
    const asientos = new Map((await db.asiento.findMany({ where: { id: { in: ps.map((p) => p.asientoId) } }, select: { id: true, numero: true } })).map((a) => [a.id, a.numero]));
    return ps.map(({ items, ...p }) => ({ ...p, numeroAsiento: asientos.get(p.asientoId), total: items.reduce((s, i) => s.plus(i.importe), new D(0)).toFixed(2) }));
  }
}
