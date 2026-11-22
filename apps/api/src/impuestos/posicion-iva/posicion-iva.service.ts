import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PosicionIva } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { ConsultasComprasService } from '../../compras/consultas/consultas.service';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { ConfigImpuestosService } from '../config/config-impuestos.service';
import { LibroVentasService } from '../libros-iva/libro-ventas.service';
import { calcularPosicionIva, EntradaPosicionIva, renglonesAsiento, ResultadoPosicionIva } from './calculo';
import { ajusteAnual, separarCredito, ultimoMesEjercicio } from './prorrateo';
import { coeficienteDelMes, conProrrateo } from './prorrateo-datos';

const D = Prisma.Decimal;
const f2 = (x: Prisma.Decimal.Value) => new D(x).toFixed(2);
const mm = (m: number) => String(m).padStart(2, '0');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const indice = (anio: number, mes: number) => anio * 12 + mes;
export const ORIGEN_POSICION_IVA = 'POSICION_IVA';

/** Prorrateo del crédito fiscal (E40): nulos sin prorrateo; computable y no computable incluyen el ajuste anual. */
export interface ProrrateoVista { coeficiente: string | null; creditoComun: string | null; creditoComputable: string | null; creditoNoComputable: string | null; ajusteProrrateo: string | null }
const SIN_PRORRATEO: ProrrateoVista = { coeficiente: null, creditoComun: null, creditoComputable: null, creditoNoComputable: null, ajusteProrrateo: null };
export type VistaPosicionIva = EntradaPosicionIva & ResultadoPosicionIva & ProrrateoVista & { anio: number; mes: number; estado: 'BORRADOR' | 'CERRADA'; avisos: string[]; asientoId: string | null };

/** Posición mensual de IVA (spec E37): borrador calculado de los libros; al cerrar se congela, se arrastran los saldos y se asienta. */
@Injectable()
export class PosicionIvaService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly cls: ClsService,
    private readonly ventas: LibroVentasService,
    private readonly compras: ConsultasComprasService,
    private readonly config: ConfigImpuestosService,
    private readonly cuentas: ConfigComprasService,
    private readonly asientos: AsientosService,
  ) {}

  private rango(anio: number, mes: number) {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Período inválido');
    const desde = new Date(Date.UTC(anio, mes - 1, 1)), hasta = new Date(Date.UTC(anio, mes, 0));
    return { desde, hasta };
  }

  /** Débito, crédito, retenciones y percepciones del mes, de los libros de IVA (§3), y los avisos de cuadre con el Mayor. */
  private async fuentes(tx: TxEmpresa, anio: number, mes: number) {
    const { desde, hasta } = this.rango(anio, mes);
    const lv = await this.ventas.libro(iso(desde), iso(hasta));
    const lc = await this.compras.libroIva(iso(desde), iso(hasta));
    const limpio = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).filter(([, v]) => !new D(v).isZero()).map(([k, v]) => [k, f2(v)]));
    const debito = limpio(lv.totales.ivaPorAlicuota), credito = limpio(lc.totales.ivaPorAlicuota);
    const ret = await tx.reciboRetencion.aggregate({ where: { tipo: 'IVA', fecha: { gte: desde, lte: hasta }, recibo: { estado: 'CONFIRMADO' } }, _sum: { importe: true } });
    // E38: las retenciones y percepciones de IVA de las liquidaciones de tarjetas
    const tarjetas = await tx.liquidacionTarjetaImpuesto.groupBy({ by: ['clase'], where: { tipo: 'IVA', liquidacion: { estado: 'CONFIRMADO', fecha: { gte: desde, lte: hasta } } }, _sum: { importe: true } });
    const deTarjetas = (clase: string) => new D(tarjetas.find((t) => t.clase === clase)?._sum.importe ?? 0);
    const total = (r: Record<string, string>) => Object.values(r).reduce((t, x) => t.plus(x), new D(0));
    const avisos = [
      ...(await this.ventas.cuadre(tx, 'IVA_DEBITO_FISCAL', desde, hasta, total(debito))),
      ...(await this.ventas.cuadre(tx, 'IVA_CREDITO_FISCAL', desde, hasta, total(credito))),
    ];
    // E40: crédito por destino de la compra
    const porDestino = { GRAVADO: new D(0), EXENTO: new D(0), COMUN: new D(0) };
    for (const fila of lc.filas) porDestino[fila.destino] = porDestino[fila.destino].plus(total(fila.ivaPorAlicuota));
    return { porDestino, debito, credito, retenciones: f2(new D(ret._sum.importe ?? 0).plus(deTarjetas('RETENCION'))), percepciones: f2(new D(lc.totales.percepcionIva).plus(deTarjetas('PERCEPCION'))), avisos };
  }

  /** Saldos a favor del mes anterior: los del cerrado, los iniciales en el mes de inicio, o los del borrador anterior (con aviso). */
  private async saldosAnteriores(tx: TxEmpresa, anio: number, mes: number, avisos: string[], profundidad = 0): Promise<{ tecnico: string; libre: string }> {
    const c = await this.config.obtener(tx);
    if (c.ivaInicioAnio && c.ivaInicioMes && indice(anio, mes) <= indice(c.ivaInicioAnio, c.ivaInicioMes))
      return { tecnico: f2(c.ivaSaldoTecnicoInicial), libre: f2(c.ivaSaldoLibreInicial) };
    const ant = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
    const cerrada = await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, ...ant } } });
    if (cerrada) return { tecnico: f2(cerrada.saldoTecnicoAFavor), libre: f2(cerrada.libreDisponibilidad) };
    if (profundidad === 0) avisos.push('El mes anterior no está cerrado: los saldos anteriores pueden cambiar');
    // Sin inicio configurado o encadenando borradores: se calcula el anterior (hasta 24 meses atrás)
    if (!c.ivaInicioAnio || profundidad >= 24) return { tecnico: '0.00', libre: '0.00' };
    const b = await this.borrador(tx, ant.anio, ant.mes, profundidad + 1);
    return { tecnico: b.saldoTecnicoAFavor, libre: b.libreDisponibilidad };
  }

  private async borrador(tx: TxEmpresa, anio: number, mes: number, profundidad = 0): Promise<VistaPosicionIva> {
    const f = await this.fuentes(tx, anio, mes);
    const avisos = [...f.avisos];
    const s = await this.saldosAnteriores(tx, anio, mes, avisos, profundidad);
    const pr = await this.prorrateo(tx, anio, mes, f.porDestino, avisos);
    const entrada: EntradaPosicionIva = { debito: f.debito, credito: f.credito, retenciones: f.retenciones, percepciones: f.percepciones, saldoTecnicoAnterior: s.tecnico, libreAnterior: s.libre, creditoComputable: pr.creditoComputable };
    return { anio, mes, estado: 'BORRADOR', ...entrada, ...calcularPosicionIva(entrada), ...pr, avisos, asientoId: null };
  }

  /** Prorrateo del crédito del mes (spec E40 §5): coeficiente acumulado, separación por destino y ajuste anual en el último mes del ejercicio. */
  private async prorrateo(tx: TxEmpresa, anio: number, mes: number, porDestino: { GRAVADO: Prisma.Decimal; EXENTO: Prisma.Decimal; COMUN: Prisma.Decimal }, avisos: string[]): Promise<ProrrateoVista> {
    const c = await this.config.obtener(tx);
    if (!conProrrateo(c, anio, mes)) return SIN_PRORRATEO;
    const coef = await coeficienteDelMes(tx, c, anio, mes);
    if (coef.sinVentas) avisos.push('Sin ventas en el ejercicio: el crédito de uso común se computa entero');
    if (coef.acotado !== null) avisos.push(`Las ventas del ejercicio son negativas: el coeficiente se acota a ${coef.acotado}`);
    let ajuste = new D(0);
    if (ultimoMesEjercicio(mes, c.prorrateoInicioMes)) {
      const comunPorMes = [];
      for (const m of coef.meses.filter((x) => x.anio !== anio || x.mes !== mes)) {
        const cerrada = await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, ...m } } });
        if (cerrada?.creditoComun != null && cerrada.coeficiente != null) {
          comunPorMes.push({ comun: f2(cerrada.creditoComun), computado: f2(cerrada.creditoComun.mul(cerrada.coeficiente).toDecimalPlaces(2, D.ROUND_HALF_UP)) });
        } else {
          const fm = await this.fuentes(tx, m.anio, m.mes);
          const cm = await coeficienteDelMes(tx, c, m.anio, m.mes);
          comunPorMes.push({ comun: f2(fm.porDestino.COMUN), computado: f2(fm.porDestino.COMUN.mul(cm.coeficiente).toDecimalPlaces(2, D.ROUND_HALF_UP)) });
        }
      }
      ajuste = new D(ajusteAnual({ comunPorMes, coeficienteAnual: coef.coeficiente }));
    }
    const sep = separarCredito({ gravado: f2(porDestino.GRAVADO), exento: f2(porDestino.EXENTO), comun: f2(porDestino.COMUN), coeficiente: coef.coeficiente, ajuste: ajuste.toFixed(2) });
    return { coeficiente: coef.coeficiente, creditoComun: f2(porDestino.COMUN), creditoComputable: sep.computable, creditoNoComputable: sep.noComputable, ajusteProrrateo: f2(ajuste) };
  }

  private vista(p: PosicionIva): VistaPosicionIva {
    return {
      anio: p.anio, mes: p.mes, estado: 'CERRADA', debito: p.debito as Record<string, string>, credito: p.credito as Record<string, string>,
      retenciones: f2(p.retenciones), percepciones: f2(p.percepciones), saldoTecnicoAnterior: f2(p.saldoTecnicoAnterior), libreAnterior: f2(p.libreAnterior),
      totalDebito: f2(p.totalDebito), totalCredito: f2(p.totalCredito), saldoTecnicoAFavor: f2(p.saldoTecnicoAFavor), impuestoDeterminado: f2(p.impuestoDeterminado),
      impuestoAPagar: f2(p.impuestoAPagar), libreDisponibilidad: f2(p.libreDisponibilidad), avisos: [], asientoId: p.asientoId,
      coeficiente: p.coeficiente?.toFixed(4) ?? null, creditoComun: p.creditoComun ? f2(p.creditoComun) : null, creditoComputable: p.creditoComputable ? f2(p.creditoComputable) : null,
      creditoNoComputable: p.creditoNoComputable ? f2(p.creditoNoComputable) : null, ajusteProrrateo: p.ajusteProrrateo ? f2(p.ajusteProrrateo) : null,
    };
  }

  /** La posición del mes: la cerrada o el borrador calculado. */
  async ver(anio: number, mes: number, tx: TxEmpresa = this.tenant.db): Promise<VistaPosicionIva> {
    this.rango(anio, mes);
    const p = await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, anio, mes } } });
    return p ? this.vista(p) : this.borrador(tx, anio, mes);
  }

  /** Los 12 meses del año con su estado y, si están cerrados, el resultado. */
  async meses(anio: number) {
    const cerradas = await this.tenant.db.posicionIva.findMany({ where: { anio } });
    return Array.from({ length: 12 }, (_, i) => {
      const p = cerradas.find((x) => x.mes === i + 1);
      return { mes: i + 1, estado: p ? 'CERRADA' : null, impuestoAPagar: p ? f2(p.impuestoAPagar) : null, saldoTecnicoAFavor: p ? f2(p.saldoTecnicoAFavor) : null, libreDisponibilidad: p ? f2(p.libreDisponibilidad) : null };
    });
  }

  private async bloquear(tx: TxEmpresa) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `posicion-iva:${this.tenant.empresaId}`);
  }

  cerrar(anio: number, mes: number) {
    this.rango(anio, mes);
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const c = await this.config.obtener(tx);
      if (!c.ivaInicioAnio || !c.ivaInicioMes) throw new BadRequestException('Configure el primer mes y los saldos iniciales de IVA');
      if (indice(anio, mes) < indice(c.ivaInicioAnio, c.ivaInicioMes)) throw new BadRequestException('El mes es anterior al inicio de la liquidación de IVA en el sistema');
      if (await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, anio, mes } } })) throw new BadRequestException(`La posición de IVA de ${mm(mes)}/${anio} ya está cerrada`);
      if (indice(anio, mes) > indice(c.ivaInicioAnio, c.ivaInicioMes)) {
        const ant = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
        if (!(await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, ...ant } } }))) throw new BadRequestException(`Cierre primero la posición de IVA de ${mm(ant.mes)}/${ant.anio}`);
      }
      const { desde, hasta } = this.rango(anio, mes);
      if (hoy() <= hasta) throw new BadRequestException('Solo se cierra un mes terminado');
      // Revisión E37: una venta en emisión o pendiente de CAE podría autorizarse con fecha en el mes después del cierre
      const pendientes = await tx.comprobanteVenta.count({ where: { fecha: { gte: desde, lte: hasta }, estado: { not: 'AUTORIZADO' }, OR: [{ emisionEnCurso: { not: null } }, { numeroReservado: { not: null } }, { estado: 'PENDIENTE_CAE' }] } });
      if (pendientes) throw new BadRequestException(`Hay comprobantes de venta de ${mm(mes)}/${anio} pendientes de autorización en ARCA: resuélvalos antes de cerrar`);
      const b = await this.borrador(tx, anio, mes);
      const renglones = [];
      for (const r of renglonesAsiento(b)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, r.concepto), debe: r.debe, haber: r.haber, detalle: `IVA ${mm(mes)}/${anio}` });
      const id = crypto.randomUUID();
      const asiento = renglones.length
        ? await this.asientos.generar(tx, { fecha: hasta, descripcion: `Liquidación de IVA ${mm(mes)}/${anio}`, origenTipo: ORIGEN_POSICION_IVA, origenId: id, renglones })
        : null;
      await tx.posicionIva.create({
        data: {
          id, empresaId: this.tenant.empresaId, anio, mes, debito: b.debito, credito: b.credito, totalDebito: b.totalDebito, totalCredito: b.totalCredito,
          saldoTecnicoAnterior: b.saldoTecnicoAnterior, libreAnterior: b.libreAnterior, retenciones: b.retenciones, percepciones: b.percepciones,
          saldoTecnicoAFavor: b.saldoTecnicoAFavor, impuestoDeterminado: b.impuestoDeterminado, impuestoAPagar: b.impuestoAPagar, libreDisponibilidad: b.libreDisponibilidad,
          coeficiente: b.coeficiente, creditoComun: b.creditoComun, creditoComputable: b.creditoComputable, creditoNoComputable: b.creditoNoComputable, ajusteProrrateo: b.ajusteProrrateo,
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
      const p = await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, anio, mes } } });
      if (!p) throw new BadRequestException(`La posición de IVA de ${mm(mes)}/${anio} no está cerrada`);
      const sig = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
      if (await tx.posicionIva.findUnique({ where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, ...sig } } })) throw new BadRequestException(`Reabra primero la posición de IVA de ${mm(sig.mes)}/${sig.anio}`);
      if (p.asientoId) await this.asientos.contraasiento(tx, p.asientoId, this.rango(anio, mes).hasta, `Anulación de la liquidación de IVA ${mm(mes)}/${anio}`);
      await tx.posicionIva.delete({ where: { id: p.id } });
      return this.ver(anio, mes, tx);
    });
  }
}
