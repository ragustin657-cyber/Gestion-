import { Injectable } from '@nestjs/common';
import { ETIQUETAS_CONDICION_IVA, formatearCuit } from '@gestion/shared';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { numeroVenta } from '../../ventas/comprobantes/comprobantes.service';

export const ALICUOTAS_LIBRO = ['21', '10.5', '27', '5', '2.5', '0'] as const;
const NOMBRE = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito' } as const;
const f2 = (d: Dec) => d.toFixed(2);
const clave = (a: Dec | string) => new D(a).toString();

export interface FilaLibroVentas {
  fecha: Date; comprobante: string; cliente: string; documento: string; condicionIva: string;
  netoPorAlicuota: Record<string, string>; ivaPorAlicuota: Record<string, string>;
  /** Comprobantes C: el total sin discriminar IVA. */
  noDiscriminado: string; noGravado: string; exento: string; total: string;
}
export interface TotalesLibro { netoPorAlicuota: Record<string, string>; ivaPorAlicuota: Record<string, string>; noDiscriminado: string; noGravado: string; exento: string; iva: string; total: string }

/**
 * Las ventas que cuentan son las del ambiente de ARCA vigente de la empresa: las de otro ambiente (simulado,
 * homologación) no tienen validez fiscal. Devuelve las advertencias de las omitidas.
 */
export async function ventasDelAmbiente(tx: TxEmpresa, desde: Date, hasta: Date) {
  const ambiente = (await tx.configArca.findFirst())?.ambiente ?? 'SIMULADO';
  const otros = await tx.comprobanteVenta.groupBy({ by: ['ambiente'], where: { estado: 'AUTORIZADO', fecha: { gte: desde, lte: hasta }, ambiente: { not: ambiente } }, _count: { _all: true } });
  return { ambiente, omitidos: otros.map((o) => `Se omitieron ${o._count._all} comprobantes de venta emitidos en ambiente ${o.ambiente}`) };
}

@Injectable()
export class LibroVentasService {
  constructor(private readonly tenant: TenantPrisma, private readonly cuentas: ConfigComprasService) {}

  /** Libro IVA Ventas en pesos (cotización del comprobante). Las NC restan. */
  async libro(desde: string, hasta: string): Promise<{ filas: FilaLibroVentas[]; totales: TotalesLibro; advertencias: string[] }> {
    const db = this.tenant.db;
    const d = fechaQuery(desde, true)!, h = fechaQuery(hasta, true)!;
    const { ambiente, omitidos } = await ventasDelAmbiente(db, d, h);
    const comps = await db.comprobanteVenta.findMany({
      where: { estado: 'AUTORIZADO', ambiente, fecha: { gte: d, lte: h } }, include: { ivas: true, tercero: true },
      orderBy: [{ fecha: 'asc' }, { tipo: 'asc' }, { puntoVenta: 'asc' }, { numero: 'asc' }],
    });
    const sum = { neto: {} as Record<string, Dec>, iva: {} as Record<string, Dec>, noDiscriminado: new D(0), noGravado: new D(0), exento: new D(0), total: new D(0) };
    const filas = comps.map((c) => {
      const s = c.tipo === 'NOTA_CREDITO' ? -1 : 1;
      const p = (x: Dec) => x.mul(c.cotizacion).toDecimalPlaces(2).mul(s);
      const neto: Record<string, string> = {}, iva: Record<string, string> = {};
      for (const i of c.ivas) {
        const k = clave(i.alicuota), b = p(i.base), v = p(i.importe);
        neto[k] = f2(b);
        iva[k] = f2(v);
        sum.neto[k] = (sum.neto[k] ?? new D(0)).plus(b);
        sum.iva[k] = (sum.iva[k] ?? new D(0)).plus(v);
      }
      const total = c.totalPesos.mul(s);
      const noDiscriminado = c.letra === 'C' ? total : new D(0);
      const noGravado = c.letra === 'C' ? new D(0) : p(c.noGravado);
      const exento = c.letra === 'C' ? new D(0) : p(c.exento);
      sum.noDiscriminado = sum.noDiscriminado.plus(noDiscriminado);
      sum.noGravado = sum.noGravado.plus(noGravado);
      sum.exento = sum.exento.plus(exento);
      sum.total = sum.total.plus(total);
      const t = c.tercero;
      return {
        fecha: c.fecha, comprobante: `${NOMBRE[c.tipo]} ${c.letra} ${numeroVenta(c.puntoVenta, c.numero)}`, cliente: t.razonSocial,
        documento: t.tipoDocumento === 'CUIT' ? formatearCuit(t.cuit) : t.tipoDocumento === 'DNI' ? `DNI ${t.cuit}` : 'Sin identificar',
        condicionIva: ETIQUETAS_CONDICION_IVA[t.condicionIva], netoPorAlicuota: neto, ivaPorAlicuota: iva,
        noDiscriminado: f2(noDiscriminado), noGravado: f2(noGravado), exento: f2(exento), total: f2(total),
      };
    });
    const ivaTotal = Object.values(sum.iva).reduce((a: Dec, x) => a.plus(x), new D(0));
    const mapa = (m: Record<string, Dec>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, f2(v)]));
    const advertencias = [...omitidos, ...(await this.cuadre(db, 'IVA_DEBITO_FISCAL', d, h, ivaTotal))];
    return {
      filas, advertencias,
      totales: { netoPorAlicuota: mapa(sum.neto), ivaPorAlicuota: mapa(sum.iva), noDiscriminado: f2(sum.noDiscriminado), noGravado: f2(sum.noGravado), exento: f2(sum.exento), iva: f2(ivaTotal), total: f2(sum.total) },
    };
  }

  /** Movimiento del período en la cuenta del concepto, con su signo natural (débito fiscal: haber − debe; crédito: debe − haber). */
  async cuadreIva(tx: TxEmpresa, concepto: 'IVA_DEBITO_FISCAL' | 'IVA_CREDITO_FISCAL', desde: Date, hasta: Date): Promise<Dec> {
    const cuenta = await this.cuentas.cuenta(tx, concepto);
    // Sin cierre, refundición ni apertura: mueven saldos de un ejercicio a otro, no son IVA del período
    const r = await tx.asientoRenglon.aggregate({
      where: { cuentaContableId: cuenta, asiento: { fecha: { gte: desde, lte: hasta }, tipo: { notIn: ['CIERRE', 'APERTURA', 'REFUNDICION'] } } }, _sum: { debe: true, haber: true },
    });
    const debe = new D(r._sum.debe ?? 0), haber = new D(r._sum.haber ?? 0);
    return concepto === 'IVA_DEBITO_FISCAL' ? haber.minus(debe) : debe.minus(haber);
  }

  /** Advertencia si el IVA del libro no coincide con el Mayor de la cuenta del concepto. */
  async cuadre(tx: TxEmpresa, concepto: 'IVA_DEBITO_FISCAL' | 'IVA_CREDITO_FISCAL', desde: Date, hasta: Date, ivaLibro: Dec): Promise<string[]> {
    const mayor = await this.cuadreIva(tx, concepto, desde, hasta);
    if (mayor.eq(ivaLibro)) return [];
    const cuenta = await tx.cuentaContable.findUniqueOrThrow({ where: { id: await this.cuentas.cuenta(tx, concepto) } });
    return [`El IVA del libro (${f2(ivaLibro)}) difiere del Mayor de la cuenta ${cuenta.codigo} (${f2(mayor)})`];
  }
}
