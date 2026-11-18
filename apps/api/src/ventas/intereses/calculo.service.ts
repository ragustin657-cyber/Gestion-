import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { ConfigInteresesService } from './config.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const DIA = 86400000;
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

export interface RenglonInteres {
  comprobanteId: string; terceroId: string; cliente: string; comprobante: string; monedaCodigo: string; vencimiento: string; fechaComprobante: Date;
  numeroComprobante: number; puntoVentaId: string; saldo: Dec; dias: number; interes: Dec; alicuota: string;
}

export const nombreComprobante = (c: { tipo: string; letra: string; puntoVenta: number; numero: number | null }) =>
  `${c.tipo === 'NOTA_DEBITO' ? 'ND' : 'FC'} ${c.letra} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero ?? 0).padStart(8, '0')}`;

/**
 * Renglones de interés vigentes de un conjunto de comprobantes (spec E27 §6): su nota de débito existe y no está
 * cancelada por completo por notas de crédito asociadas. Devuelve los renglones vigentes.
 */
export async function renglonesVigentes(tx: TxEmpresa, where: Prisma.LiquidacionInteresesRenglonWhereInput) {
  const rs = await tx.liquidacionInteresesRenglon.findMany({ where, include: { liquidacion: { select: { anio: true, mes: true } } } });
  const notaIds = [...new Set(rs.map((r) => r.notaDebitoId).filter((x): x is string => !!x))];
  const notas = new Map((notaIds.length ? await tx.comprobanteVenta.findMany({ where: { id: { in: notaIds } }, select: { id: true, total: true } }) : []).map((n) => [n.id, n]));
  const ncs = notaIds.length ? await tx.comprobanteVenta.findMany({ where: { comprobanteAsociadoId: { in: notaIds }, tipo: 'NOTA_CREDITO', estado: 'AUTORIZADO' }, select: { comprobanteAsociadoId: true, total: true } }) : [];
  const acreditado = (id: string) => ncs.filter((n) => n.comprobanteAsociadoId === id).reduce((s, n) => s.plus(n.total), new D(0));
  return rs.filter((r) => {
    const nota = r.notaDebitoId ? notas.get(r.notaDebitoId) : null;
    return !!nota && acreditado(nota.id).lt(nota.total);
  });
}

/** Intereses por mora de un mes terminado, por factura (spec E27 §4). */
@Injectable()
export class InteresesCalculoService {
  constructor(private readonly tenant: TenantPrisma, private readonly config: ConfigInteresesService) {}

  async calcular(tx: TxEmpresa, anio: number, mes: number): Promise<{ tasa: Dec; renglones: RenglonInteres[] }> {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Indique el mes (año y mes)');
    const cfg = await this.config.requerida(tx);
    const h = hoy();
    if (anio * 12 + mes >= h.getUTCFullYear() * 12 + h.getUTCMonth() + 1) throw new BadRequestException('Solo se liquidan meses terminados');
    const fin = new Date(Date.UTC(anio, mes, 0));
    const finAnterior = new Date(Date.UTC(anio, mes - 1, 0));
    // Notas de débito de intereses: no generan intereses
    const deIntereses = new Set((await tx.liquidacionInteresesRenglon.findMany({ where: { notaDebitoId: { not: null } }, select: { notaDebitoId: true } })).map((r) => r.notaDebitoId!));
    // Acotado en la consulta (spec E29): solo movimientos de venta con saldo o con algo aplicado por un crédito posterior al cierre
    const posteriores = (await tx.$queryRawUnsafe<{ id: string }[]>(`
      SELECT DISTINCT a."debitoMovId" AS id FROM "AplicacionCobro" a
      JOIN "MovimientoCuentaCorriente" cr ON cr.id = a."creditoMovId"
      WHERE a."empresaId" = $1::uuid AND NOT a.anulada AND cr.fecha > $2::date`, this.tenant.empresaId, fin.toISOString().slice(0, 10))).map((r) => r.id);
    const conPosterior = new Set(posteriores);
    const movsVenta = await tx.movimientoCuentaCorriente.findMany({
      where: { origenTipo: 'VENTA', anulado: false, OR: [{ saldo: { gt: 0 } }, ...(posteriores.length ? [{ id: { in: posteriores } }] : [])] },
    });
    if (!movsVenta.length) return { tasa: cfg.tasaMensual, renglones: [] };
    const comps = await tx.comprobanteVenta.findMany({
      where: { id: { in: movsVenta.map((m) => m.origenId) }, estado: 'AUTORIZADO', tipo: { in: ['FACTURA', 'NOTA_DEBITO'] }, fechaVencimiento: { lt: fin }, tercero: { sinIntereses: false, activo: true } },
      include: { ivas: true, tercero: { select: { razonSocial: true } } },
    });
    const candidatos = comps.filter((c) => !deIntereses.has(c.id));
    if (!candidatos.length) return { tasa: cfg.tasaMensual, renglones: [] };
    const ids = new Set(candidatos.map((c) => c.id));
    const movs = new Map(movsVenta.filter((m) => ids.has(m.origenId)).map((m) => [m.origenId, m]));
    // Lo aplicado después del cierre (según la fecha del pago o la nota de crédito) vuelve a sumar al saldo
    const apl = await tx.aplicacionCobro.findMany({ where: { anulada: false, debitoMovId: { in: [...movs.values()].map((m) => m.id).filter((id) => conPosterior.has(id)) } } });
    const creditos = new Map((apl.length ? await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: [...new Set(apl.map((a) => a.creditoMovId))] } }, select: { id: true, fecha: true } }) : []).map((m) => [m.id, m.fecha]));
    const ya = new Set((await renglonesVigentes(tx, { comprobanteId: { in: candidatos.map((c) => c.id) } })).filter((r) => r.liquidacion.anio === anio && r.liquidacion.mes === mes).map((r) => r.comprobanteId));
    const renglones: RenglonInteres[] = [];
    for (const c of candidatos) {
      const m = movs.get(c.id);
      if (!m || ya.has(c.id)) continue;
      const despues = apl.filter((a) => a.debitoMovId === m.id && (creditos.get(a.creditoMovId) ?? fin) > fin).reduce((s, a) => s.plus(a.importe), new D(0));
      const saldo = m.saldo.plus(despues);
      if (!saldo.gt(0)) continue;
      const desde = c.fechaVencimiento > finAnterior ? c.fechaVencimiento : finAnterior;
      const dias = Math.round((fin.getTime() - desde.getTime()) / DIA);
      if (dias <= 0) continue;
      const interes = r2(saldo.times(cfg.tasaMensual).div(100).times(dias).div(30));
      if (!interes.gt(0)) continue;
      // La alícuota con mayor base gravada; sin IVA (exenta o no gravada), el interés es exento
      const mayor = c.ivas.filter((i) => i.base.gt(0) && i.alicuota.gt(0)).sort((a, b) => b.base.comparedTo(a.base))[0];
      renglones.push({
        comprobanteId: c.id, terceroId: c.terceroId, cliente: c.tercero.razonSocial, comprobante: nombreComprobante(c), monedaCodigo: c.monedaCodigo,
        vencimiento: c.fechaVencimiento.toISOString().slice(0, 10), fechaComprobante: c.fecha, numeroComprobante: c.numeroInterno, puntoVentaId: c.puntoVentaId,
        saldo, dias, interes, alicuota: mayor ? String(Number(mayor.alicuota)) : 'EXENTO',
      });
    }
    return { tasa: cfg.tasaMensual, renglones };
  }

  /** Consulta (GET): agrupada por cliente y moneda. */
  async consulta(anio: number, mes: number) {
    const { tasa, renglones } = await this.calcular(this.tenant.db, anio, mes);
    const grupos = new Map<string, RenglonInteres[]>();
    for (const r of renglones) grupos.set(`${r.terceroId}|${r.monedaCodigo}`, [...(grupos.get(`${r.terceroId}|${r.monedaCodigo}`) ?? []), r]);
    const f = (x: Dec) => x.toFixed(2);
    return {
      anio, mes, tasa: f(tasa),
      grupos: [...grupos.values()].map((rs) => ({
        terceroId: rs[0].terceroId, cliente: rs[0].cliente, monedaCodigo: rs[0].monedaCodigo, total: f(rs.reduce((s, r) => s.plus(r.interes), new D(0))),
        renglones: rs.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento)).map((r) => ({ comprobanteId: r.comprobanteId, comprobante: r.comprobante, vencimiento: r.vencimiento, saldo: f(r.saldo), dias: r.dias, interes: f(r.interes), alicuota: r.alicuota })),
      })).sort((a, b) => a.cliente.localeCompare(b.cliente) || a.monedaCodigo.localeCompare(b.monedaCodigo)),
    };
  }
}
