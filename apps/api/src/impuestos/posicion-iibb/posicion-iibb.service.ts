import { BadRequestException, Injectable } from '@nestjs/common';
import { JURISDICCIONES_CM, nombreJurisdiccion } from '@gestion/shared';
import { Prisma, PosicionIibb } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { ConfigImpuestosService } from '../config/config-impuestos.service';
import { calcularPosicionIibb, DetalleJurisdiccion, renglonesAsientoIibb, ResultadoPosicionIibb } from './calculo';
import { ingresosGravados } from './ingresos';
import { jurisdiccionDeProvincia } from './provincias';

const D = Prisma.Decimal;
const f2 = (x: Prisma.Decimal.Value) => new D(x).toFixed(2);
const mm = (m: number) => String(m).padStart(2, '0');
const indice = (anio: number, mes: number) => anio * 12 + mes;
const anterior = (anio: number, mes: number) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });
export const ORIGEN_POSICION_IIBB = 'POSICION_IIBB';

export type VistaPosicionIibb = ResultadoPosicionIibb & { anio: number; mes: number; estado: 'BORRADOR' | 'CERRADA'; avisos: string[]; asientoId: string | null };
export interface DatosJurisdiccionCm { jurisdiccion: string; coeficiente: number; alicuota: number; actividad: string; saldoInicial?: number }

/** Liquidación mensual de IIBB por Convenio Multilateral (spec E38): borrador calculado; al cerrar se congela, se arrastran los saldos y se asienta. */
@Injectable()
export class PosicionIibbService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly cls: ClsService,
    private readonly config: ConfigImpuestosService,
    private readonly cuentas: ConfigComprasService,
    private readonly asientos: AsientosService,
  ) {}

  private rango(anio: number, mes: number) {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Período inválido');
    return { desde: new Date(Date.UTC(anio, mes - 1, 1)), hasta: new Date(Date.UTC(anio, mes, 0)) };
  }

  private delMes(tx: TxEmpresa, anio: number, mes: number) {
    return tx.posicionIibb.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, anio, mes } } });
  }

  // --- Jurisdicciones del año (§3) ---

  jurisdicciones(anio: number) {
    return this.tenant.db.jurisdiccionCm.findMany({ where: { anio }, orderBy: { jurisdiccion: 'asc' } });
  }

  guardarJurisdicciones(anio: number, lista: DatosJurisdiccionCm[]) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      if (await tx.posicionIibb.count({ where: { anio } })) throw new BadRequestException(`Hay meses de ${anio} liquidados: reábralos para cambiar las jurisdicciones`);
      const vistas = new Set<string>();
      for (const j of lista) {
        if (!JURISDICCIONES_CM[j.jurisdiccion]) throw new BadRequestException(`Jurisdicción inválida: ${j.jurisdiccion}`);
        if (vistas.has(j.jurisdiccion)) throw new BadRequestException(`La jurisdicción ${nombreJurisdiccion(j.jurisdiccion)} está repetida`);
        vistas.add(j.jurisdiccion);
      }
      // El saldo inicial solo cuenta en el año de inicio (spec E38 §3); sin inicio configurado se guarda como viene
      const c = await this.config.obtener(tx);
      const conSaldo = !c.iibbInicioAnio || c.iibbInicioAnio === anio;
      await tx.jurisdiccionCm.deleteMany({ where: { anio } });
      await tx.jurisdiccionCm.createMany({
        data: lista.map((j) => ({ empresaId: this.tenant.empresaId, anio, jurisdiccion: j.jurisdiccion, coeficiente: j.coeficiente, alicuota: j.alicuota, actividad: j.actividad, saldoInicial: conSaldo ? (j.saldoInicial ?? 0) : 0 })),
      });
      return tx.jurisdiccionCm.findMany({ where: { anio }, orderBy: { jurisdiccion: 'asc' } });
    });
  }

  // --- Cálculo ---

  /** Retenciones (recibos y tarjetas) y percepciones (compras y tarjetas) de IIBB del mes, por jurisdicción. */
  private async creditos(tx: TxEmpresa, desde: Date, hasta: Date) {
    const ret = new Map<string, Prisma.Decimal>(), perc = new Map<string, Prisma.Decimal>();
    const sumar = (m: Map<string, Prisma.Decimal>, j: string | null, v: Prisma.Decimal.Value) => j && m.set(j, (m.get(j) ?? new D(0)).plus(v));
    for (const r of await tx.reciboRetencion.groupBy({ by: ['jurisdiccion'], where: { tipo: 'IIBB', fecha: { gte: desde, lte: hasta }, recibo: { estado: 'CONFIRMADO' } }, _sum: { importe: true } }))
      sumar(ret, r.jurisdiccion, r._sum.importe ?? 0);
    for (const p of await tx.comprobanteCompraPercepcionIibb.groupBy({ by: ['jurisdiccion'], where: { comprobante: { estado: 'CONFIRMADO', fechaContable: { gte: desde, lte: hasta } } }, _sum: { importe: true } }))
      sumar(perc, p.jurisdiccion, p._sum.importe ?? 0);
    for (const t of await tx.liquidacionTarjetaImpuesto.groupBy({ by: ['clase', 'jurisdiccion'], where: { tipo: 'IIBB', liquidacion: { estado: 'CONFIRMADO', fecha: { gte: desde, lte: hasta } } }, _sum: { importe: true } }))
      sumar(t.clase === 'RETENCION' ? ret : perc, t.jurisdiccion, t._sum.importe ?? 0);
    return { ret, perc };
  }

  /** Saldos a favor por jurisdicción al comienzo del mes: los iniciales en el mes de inicio, los del cerrado anterior o los del borrador anterior. */
  private async saldosAnteriores(tx: TxEmpresa, anio: number, mes: number, avisos: string[], profundidad: number): Promise<Map<string, string>> {
    const c = await this.config.obtener(tx);
    if (c.iibbInicioAnio && c.iibbInicioMes && indice(anio, mes) <= indice(c.iibbInicioAnio, c.iibbInicioMes)) {
      const js = await tx.jurisdiccionCm.findMany({ where: { anio } });
      return new Map(js.map((j) => [j.jurisdiccion, indice(anio, mes) === indice(c.iibbInicioAnio!, c.iibbInicioMes!) ? f2(j.saldoInicial) : '0.00']));
    }
    const ant = anterior(anio, mes);
    const cerrada = await this.delMes(tx, ant.anio, ant.mes);
    if (cerrada) return new Map((cerrada.detalle as unknown as DetalleJurisdiccion[]).map((d) => [d.jurisdiccion, d.saldoAFavor]));
    if (profundidad === 0) avisos.push('El mes anterior no está cerrado: los saldos anteriores pueden cambiar');
    if (!c.iibbInicioAnio || profundidad >= 24) return new Map();
    const b = await this.borrador(tx, ant.anio, ant.mes, profundidad + 1);
    return new Map(b.detalle.map((d) => [d.jurisdiccion, d.saldoAFavor]));
  }

  private async borrador(tx: TxEmpresa, anio: number, mes: number, profundidad = 0): Promise<VistaPosicionIibb> {
    const { desde, hasta } = this.rango(anio, mes);
    const ing = await ingresosGravados(tx, desde, hasta);
    const avisos = [...ing.avisos];
    const js = await tx.jurisdiccionCm.findMany({ where: { anio }, orderBy: { jurisdiccion: 'asc' } });
    const enConvenio = new Set(js.map((j) => j.jurisdiccion));
    const { ret, perc } = await this.creditos(tx, desde, hasta);
    for (const j of [...new Set([...ret.keys(), ...perc.keys()])].sort())
      if (!enConvenio.has(j)) avisos.push(`Hay retenciones o percepciones de la jurisdicción ${nombreJurisdiccion(j)}, que no está en el Convenio de ${anio}`);
    const saldos = await this.saldosAnteriores(tx, anio, mes, avisos, profundidad);
    for (const [j, s] of [...saldos].sort())
      if (!enConvenio.has(j) && new D(s).gt(0))
        avisos.push(`Los saldos a favor de ${nombreJurisdiccion(j)} (${s}) no pasan a ${anio} porque la jurisdicción no está en el Convenio: quedan en la cuenta IIBB Saldo a favor`);
    const r = calcularPosicionIibb({
      ingresos: ing.total.toFixed(2),
      jurisdicciones: js.map((j) => ({
        jurisdiccion: j.jurisdiccion, coeficiente: j.coeficiente.toString(), alicuota: j.alicuota.toString(),
        retenciones: f2(ret.get(j.jurisdiccion) ?? 0), percepciones: f2(perc.get(j.jurisdiccion) ?? 0), saldoAnterior: saldos.get(j.jurisdiccion) ?? '0.00',
      })),
    });
    return { anio, mes, estado: 'BORRADOR', ...r, avisos, asientoId: null };
  }

  private vista(p: PosicionIibb): VistaPosicionIibb {
    const detalle = p.detalle as unknown as DetalleJurisdiccion[];
    const totales = calcularTotales(detalle);
    return { anio: p.anio, mes: p.mes, estado: 'CERRADA', ingresos: f2(p.ingresos), detalle, totales, avisos: [], asientoId: p.asientoId };
  }

  async ver(anio: number, mes: number, tx: TxEmpresa = this.tenant.db): Promise<VistaPosicionIibb> {
    this.rango(anio, mes);
    const p = await this.delMes(tx, anio, mes);
    return p ? this.vista(p) : this.borrador(tx, anio, mes);
  }

  async meses(anio: number) {
    const cerradas = await this.tenant.db.posicionIibb.findMany({ where: { anio } });
    return Array.from({ length: 12 }, (_, i) => {
      const p = cerradas.find((x) => x.mes === i + 1);
      const t = p ? calcularTotales(p.detalle as unknown as DetalleJurisdiccion[]) : null;
      return { mes: i + 1, estado: p ? 'CERRADA' : null, aPagar: t?.aPagar ?? null, saldoAFavor: t?.saldoAFavor ?? null };
    });
  }

  /** Ingresos gravados del año por la provincia del cliente (spec E38 §7): la parte de ingresos del CM05. */
  async ingresosPorProvincia(anio: number) {
    if (!Number.isInteger(anio)) throw new BadRequestException('Período inválido');
    const db = this.tenant.db;
    const ing = await ingresosGravados(db, new Date(Date.UTC(anio, 0, 1)), new Date(Date.UTC(anio, 11, 31)));
    const terceros = await db.tercero.findMany({ where: { id: { in: [...ing.porTercero.keys()] } }, select: { id: true, provincia: true } });
    const provincia = new Map(terceros.map((t) => [t.id, jurisdiccionDeProvincia(t.provincia)]));
    const porJ = new Map<string | null, Prisma.Decimal>();
    for (const [id, v] of ing.porTercero) {
      const j = provincia.get(id) ?? null;
      porJ.set(j, (porJ.get(j) ?? new D(0)).plus(v));
    }
    const filas = [...porJ].sort(([a, x], [b, y]) => (a === null ? 1 : b === null ? -1 : y.comparedTo(x)))
      .map(([j, v]) => ({ jurisdiccion: j, nombre: j ? nombreJurisdiccion(j) : 'Sin provincia', ingresos: f2(v), porcentaje: ing.total.isZero() ? '0.00' : v.div(ing.total).times(100).toFixed(2) }));
    return { anio, filas, total: f2(ing.total), avisos: ing.avisos };
  }

  private async bloquear(tx: TxEmpresa) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `posicion-iibb:${this.tenant.empresaId}`);
  }

  cerrar(anio: number, mes: number) {
    this.rango(anio, mes);
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const c = await this.config.obtener(tx);
      if (!c.iibbInicioAnio || !c.iibbInicioMes) throw new BadRequestException('Configure el primer mes de la liquidación de IIBB');
      if (indice(anio, mes) < indice(c.iibbInicioAnio, c.iibbInicioMes)) throw new BadRequestException('El mes es anterior al inicio de la liquidación de IIBB en el sistema');
      if (await this.delMes(tx, anio, mes)) throw new BadRequestException(`La liquidación de IIBB de ${mm(mes)}/${anio} ya está cerrada`);
      if (indice(anio, mes) > indice(c.iibbInicioAnio, c.iibbInicioMes)) {
        const ant = anterior(anio, mes);
        if (!(await this.delMes(tx, ant.anio, ant.mes))) throw new BadRequestException(`Cierre primero la liquidación de IIBB de ${mm(ant.mes)}/${ant.anio}`);
      }
      const { desde, hasta } = this.rango(anio, mes);
      if (hoy() <= hasta) throw new BadRequestException('Solo se cierra un mes terminado');
      const js = await tx.jurisdiccionCm.findMany({ where: { anio } });
      if (!js.length) throw new BadRequestException(`Cargue las jurisdicciones y coeficientes de Convenio Multilateral de ${anio}`);
      const suma = js.reduce((t, j) => t.plus(j.coeficiente), new D(0));
      if (suma.minus(1).abs().gt('0.0001')) throw new BadRequestException(`Los coeficientes de ${anio} suman ${suma.toFixed(4)}: deben sumar 1`);
      const pendientes = await tx.comprobanteVenta.count({ where: { fecha: { gte: desde, lte: hasta }, estado: { not: 'AUTORIZADO' }, OR: [{ emisionEnCurso: { not: null } }, { numeroReservado: { not: null } }, { estado: 'PENDIENTE_CAE' }] } });
      if (pendientes) throw new BadRequestException(`Hay comprobantes de venta de ${mm(mes)}/${anio} pendientes de autorización en ARCA: resuélvalos antes de cerrar`);
      const b = await this.borrador(tx, anio, mes);
      const renglones = [];
      for (const r of renglonesAsientoIibb(b)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, r.concepto), debe: r.debe, haber: r.haber, detalle: `IIBB ${mm(mes)}/${anio}` });
      const id = crypto.randomUUID();
      const asiento = renglones.length
        ? await this.asientos.generar(tx, { fecha: hasta, descripcion: `Liquidación de IIBB ${mm(mes)}/${anio}`, origenTipo: ORIGEN_POSICION_IIBB, origenId: id, renglones })
        : null;
      await tx.posicionIibb.create({
        data: {
          id, empresaId: this.tenant.empresaId, anio, mes, ingresos: b.ingresos, detalle: b.detalle as unknown as Prisma.InputJsonValue,
          asientoId: asiento?.id ?? null, cerradoEn: new Date(), cerradoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
        },
      });
      return { ...(await this.ver(anio, mes, tx)), avisos: b.avisos };
    });
  }

  reabrir(anio: number, mes: number) {
    this.rango(anio, mes);
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const p = await this.delMes(tx, anio, mes);
      if (!p) throw new BadRequestException(`La liquidación de IIBB de ${mm(mes)}/${anio} no está cerrada`);
      const sig = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
      if (await this.delMes(tx, sig.anio, sig.mes)) throw new BadRequestException(`Reabra primero la liquidación de IIBB de ${mm(sig.mes)}/${sig.anio}`);
      if (p.asientoId) await this.asientos.contraasiento(tx, p.asientoId, this.rango(anio, mes).hasta, `Anulación de la liquidación de IIBB ${mm(mes)}/${anio}`);
      await tx.posicionIibb.delete({ where: { id: p.id } });
      return this.ver(anio, mes, tx);
    });
  }
}

function calcularTotales(detalle: DetalleJurisdiccion[]) {
  const campos = ['base', 'impuesto', 'retenciones', 'percepciones', 'saldoAnterior', 'aPagar', 'saldoAFavor'] as const;
  return Object.fromEntries(campos.map((c) => [c, detalle.reduce((t, d) => t.plus(d[c]), new D(0)).toFixed(2)])) as ResultadoPosicionIibb['totales'];
}
