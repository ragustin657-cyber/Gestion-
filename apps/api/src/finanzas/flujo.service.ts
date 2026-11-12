import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { ConsultasTesoreriaService } from '../tesoreria/operaciones/consultas.service';
import { hoy, saldoBanco, saldoCaja } from '../tesoreria/operaciones/tesoreria-comun';
import { AlcanceSucursalService } from '../tesoreria/sucursales/alcance.service';
import { Agrupar, periodos } from './periodos';
import { saldosAFecha } from './saldos';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const DIA = 86400000;
export const CONCEPTOS_INGRESO = ['cheques', 'transferencias', 'cobranzas', 'vencidoACobrar'] as const;
export const CONCEPTOS_EGRESO = ['chequesPropios', 'ordenesPago', 'proveedores', 'vencidoAPagar'] as const;
type Concepto = (typeof CONCEPTOS_INGRESO)[number] | (typeof CONCEPTOS_EGRESO)[number];
const ORDEN: Concepto[] = [...CONCEPTOS_INGRESO, ...CONCEPTOS_EGRESO];
const VENCIDOS: Concepto[] = ['vencidoACobrar', 'vencidoAPagar'];
const LIMITES: Record<Agrupar, [number, string]> = {
  dia: [90, 'El flujo diario admite hasta 90 días'], semana: [52, 'El flujo semanal admite hasta 52 semanas'], mes: [24, 'El flujo mensual admite hasta 24 meses'],
};
const iso = (f: Date) => f.toISOString().slice(0, 10);
const fechaQ = (s: string | undefined, campo: string) => {
  if (!s) return undefined;
  const f = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(f.getTime())) throw new BadRequestException(`Fecha inválida: ${campo}`);
  return f;
};

export interface ItemFlujo { concepto: Concepto; fecha: Date; descripcion: string; tercero: string; importe: Dec }
export interface ParamsFlujo { hasta?: string; agrupar?: string; incluirVencidos?: string }

@Injectable()
export class FlujoService {
  constructor(private readonly tenant: TenantPrisma, private readonly consultas: ConsultasTesoreriaService, private readonly alcance: AlcanceSucursalService) {}

  async razonSocial() {
    return (await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } })).razonSocial;
  }

  private async cotizacionUsd(tx: TxEmpresa, inicio: Date): Promise<Dec> {
    const c = await tx.cotizacion.findFirst({ where: { monedaCodigo: 'USD', fecha: { lte: inicio } }, orderBy: { fecha: 'desc' } });
    if (!c) throw new BadRequestException('Falta la cotización del dólar');
    return new D(c.valor);
  }

  /** Saldo inicial y partidas proyectadas (spec E15 §4). */
  async partidas(): Promise<{ saldoInicial: Dec; items: ItemFlujo[] }> {
    const db = this.tenant.db;
    const inicio = hoy();
    const sucursal = this.alcance.sucursalUsuario();
    let usd: Dec | null = null;
    const pesos = async (moneda: string, importe: Dec) => (moneda === 'ARS' || importe.isZero() ? importe : importe.times((usd ??= await this.cotizacionUsd(db, inicio))).toDecimalPlaces(2));
    const desdeHoy = (f: Date) => (f < inicio ? inicio : f);

    let saldoInicial = new D(0);
    if (!sucursal)
      for (const c of await db.cuentaBancaria.findMany({ where: { activa: true } })) saldoInicial = saldoInicial.plus(await pesos(c.monedaCodigo, new D(await saldoBanco(db, c.id, inicio))));
    for (const c of await db.caja.findMany({ where: { activa: true, ...(sucursal ? { sucursalId: sucursal } : {}) } })) saldoInicial = saldoInicial.plus(await pesos(c.monedaCodigo, new D(await saldoCaja(db, c.id, inicio))));

    const items: ItemFlujo[] = [];
    const cheques = await db.chequeTercero.findMany({ where: { AND: [{ estado: { in: ['EN_CARTERA', 'EN_TRANSITO'] } }, await this.consultas.visibilidadCheques(db)] }, orderBy: { fechaPago: 'asc' } });
    for (const c of cheques) items.push({ concepto: 'cheques', fecha: desdeHoy(c.fechaPago), descripcion: `Cheque ${c.banco} N° ${c.numero}`, tercero: c.libradorNombre, importe: await pesos(c.monedaCodigo, new D(c.importe)) });
    if (sucursal) return { saldoInicial, items };

    for (const t of await db.transferenciaRecibida.findMany({ where: { estado: 'PENDIENTE' } }))
      items.push({ concepto: 'transferencias', fecha: inicio, descripcion: 'Transferencia a acreditar', tercero: '', importe: await pesos(t.monedaCodigo, new D(t.importe)) });
    for (const c of await db.chequePropio.findMany({ where: { estado: 'EMITIDO' }, orderBy: { fechaPago: 'asc' } }))
      if (c.fechaPago > c.fechaEmision) items.push({ concepto: 'chequesPropios', fecha: desdeHoy(c.fechaPago), descripcion: `Cheque propio N° ${c.numero}`, tercero: '', importe: await pesos(c.monedaCodigo, new D(c.importe)) });
    const ops = await db.ordenPago.findMany({ where: { estado: 'APROBADA' }, include: { tercero: { select: { razonSocial: true } } } });
    for (const op of ops) items.push({ concepto: 'ordenesPago', fecha: inicio, descripcion: `OP N° ${op.numero ?? ''}`.trim(), tercero: op.tercero.razonSocial, importe: new D(op.netoPagar) });

    // Cuentas corrientes: saldo pendiente (incluidos los comprobantes con fecha futura) por vencimiento.
    // Lo imputado en OP aprobadas ya está en "OP aprobadas": se descuenta en pesos históricos (importe × saldo en pesos / saldo)
    const todo = new Date(Date.UTC(9999, 11, 31));
    const [clientes, proveedores] = await Promise.all([saldosAFecha(db, 'clientes', todo), saldosAFecha(db, 'proveedores', todo)]);
    const imputado = await db.ordenPagoImputacion.groupBy({ by: ['movimientoId'], where: { ordenPago: { estado: 'APROBADA' } }, _sum: { importe: true } });
    const actuales = new Map((await db.movimientoCuentaCorriente.findMany({ where: { id: { in: imputado.map((g) => g.movimientoId) } }, select: { id: true, saldo: true, saldoPesos: true } })).map((m) => [m.id, m]));
    const enOp = new Map(imputado.map((g) => {
      const m = actuales.get(g.movimientoId);
      const importe = new D(g._sum.importe ?? 0);
      return [g.movimientoId, !m || new D(m.saldo).isZero() ? new D(0) : importe.eq(m.saldo) ? new D(m.saldoPesos) : importe.times(m.saldoPesos).div(m.saldo).toDecimalPlaces(2)];
    }));
    const movs = [...clientes, ...proveedores];
    const terceros = new Map((await db.tercero.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.terceroId))] } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
    const descripciones = await this.descripciones(db, movs);
    for (const [lista, normal, vencido] of [[clientes, 'cobranzas', 'vencidoACobrar'], [proveedores, 'proveedores', 'vencidoAPagar']] as const)
      for (const m of lista) {
        const pendiente = m.saldoPesos.minus(enOp.get(m.movimientoId) ?? 0);
        if (pendiente.lte(0)) continue;
        const venc = m.fechaVencimiento < inicio;
        items.push({ concepto: venc ? vencido : normal, fecha: venc ? inicio : m.fechaVencimiento, descripcion: descripciones.get(m.movimientoId) ?? m.origenTipo, tercero: terceros.get(m.terceroId) ?? '', importe: pendiente });
      }
    return { saldoInicial, items };
  }

  private async descripciones(db: TxEmpresa, movs: { movimientoId: string; origenTipo: string; origenId: string }[]) {
    const ventas = new Map((await db.comprobanteVenta.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'VENTA').map((m) => m.origenId) } }, select: { id: true, tipo: true, letra: true, puntoVenta: true, numero: true } }))
      .map((c) => [c.id, `${c.tipo === 'FACTURA' ? 'FC' : c.tipo === 'NOTA_DEBITO' ? 'ND' : 'NC'} ${c.letra} ${String(c.puntoVenta).padStart(5, '0')}-${String(c.numero ?? 0).padStart(8, '0')}`]));
    const compras = new Map((await db.comprobanteCompra.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'COMPRA').map((m) => m.origenId) } }, select: { id: true, tipo: true, letra: true, puntoVenta: true, numero: true } }))
      .map((c) => [c.id, `${c.tipo === 'FACTURA' ? 'FC' : c.tipo === 'NOTA_DEBITO' ? 'ND' : c.tipo === 'NOTA_CREDITO' ? 'NC' : 'TK'} ${c.letra} ${String(c.puntoVenta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`]));
    return new Map(movs.map((m) => [m.movimientoId, ventas.get(m.origenId) ?? compras.get(m.origenId) ?? m.origenTipo]));
  }

  private parametros(q: ParamsFlujo) {
    const inicio = hoy();
    const agrupar = (['dia', 'semana', 'mes'].includes(q.agrupar ?? '') ? q.agrupar : 'semana') as Agrupar;
    const hasta = fechaQ(q.hasta, 'hasta') ?? new Date(inicio.getTime() + 56 * DIA);
    if (hasta < inicio) throw new BadRequestException('La fecha hasta no puede ser anterior a hoy');
    const ps = periodos(inicio, hasta, agrupar);
    if (ps.length > LIMITES[agrupar][0]) throw new BadRequestException(LIMITES[agrupar][1]);
    return { inicio, hasta, agrupar, ps, incluirVencidos: q.incluirVencidos !== 'false' };
  }

  async flujo(q: ParamsFlujo) {
    const { inicio, hasta, agrupar, ps, incluirVencidos } = this.parametros(q);
    const { saldoInicial, items } = await this.partidas();
    let saldo = saldoInicial;
    let primerNegativo: string | null = null;
    const filas = ps.map((p) => {
      const suma = new Map<Concepto, Dec>(ORDEN.map((c) => [c, new D(0)]));
      for (const i of items) if (i.fecha >= p.desde && i.fecha <= p.hasta) suma.set(i.concepto, suma.get(i.concepto)!.plus(i.importe));
      const total = (cs: readonly Concepto[]) => cs.filter((c) => incluirVencidos || !VENCIDOS.includes(c)).reduce((s, c) => s.plus(suma.get(c)!), new D(0));
      const totalIngresos = total(CONCEPTOS_INGRESO), totalEgresos = total(CONCEPTOS_EGRESO);
      saldo = saldo.plus(totalIngresos).minus(totalEgresos);
      if (saldo.lt(0) && !primerNegativo) primerNegativo = p.etiqueta;
      const txt = (cs: readonly Concepto[]) => Object.fromEntries(cs.map((c) => [c, suma.get(c)!.toFixed(2)]));
      return { desde: iso(p.desde), hasta: iso(p.hasta), etiqueta: p.etiqueta, ingresos: txt(CONCEPTOS_INGRESO), egresos: txt(CONCEPTOS_EGRESO), totalIngresos: totalIngresos.toFixed(2), totalEgresos: totalEgresos.toFixed(2), saldo: saldo.toFixed(2) };
    });
    return { desde: iso(inicio), hasta: iso(hasta), agrupar, incluirVencidos, saldoInicial: saldoInicial.toFixed(2), filas, primerNegativo };
  }

  async detalle(q: { desde?: string; hasta?: string; incluirVencidos?: string }) {
    const desde = fechaQ(q.desde, 'desde'), hasta = fechaQ(q.hasta, 'hasta');
    if (!desde || !hasta) throw new BadRequestException('Indique desde y hasta');
    const { items } = await this.partidas();
    return items
      .filter((i) => i.fecha >= desde && i.fecha <= hasta && (q.incluirVencidos !== 'false' || !VENCIDOS.includes(i.concepto)))
      .sort((a, b) => ORDEN.indexOf(a.concepto) - ORDEN.indexOf(b.concepto) || a.fecha.getTime() - b.fecha.getTime())
      .map((i) => ({ ...i, fecha: iso(i.fecha), importe: i.importe.toFixed(2) }));
  }
}
