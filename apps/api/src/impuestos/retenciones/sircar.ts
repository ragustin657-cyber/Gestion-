import { normalizarCuit } from '@gestion/shared';
import { BadRequestException } from '@nestjs/common';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { archivo } from '../formato/escritor';
import { percepcionesDelPeriodo, totalPercepciones } from '../percepciones/percepciones-periodo';
import { ContextoGeneracion, Generado, mmaaaa } from '../presentaciones/generado';
import { retencionesDelPeriodo } from './comun';

/**
 * SIRCAR (E48, diseño a verificar contra el instructivo): un renglón por movimiento, campos separados por coma, decimales con punto:
 * renglón(5), tipo de comprobante, número(12), CUIT(11), fecha DD/MM/AAAA, base, alícuota, importe, régimen(3), jurisdicción(3).
 */
const TIPO_VENTA = { FACTURA: 'FA', NOTA_DEBITO: 'ND', NOTA_CREDITO: 'NC' } as const;
const fecha = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const n2 = (x: InstanceType<typeof D> | string | number) => new D(x).toFixed(2);
const renglon = (i: number, campos: (string | number)[]) => [String(i).padStart(5, '0'), ...campos].join(',');
const nombre = (tipo: string, ctx: ContextoGeneracion) => `SIRCAR-${tipo}_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}.txt`;

async function adheridas(tx: TxEmpresa, ctx: ContextoGeneracion) {
  const lista = ctx.config.jurisdiccionesSircar ?? [];
  if (!lista.length) throw new BadRequestException('Configure las jurisdicciones adheridas a SIRCAR');
  const regs = await tx.jurisdiccionIibb.findMany({ where: { jurisdiccion: { in: lista } } });
  return { lista, regimen: new Map(regs.map((r) => [r.jurisdiccion, r])) };
}

/** SIRCAR retenciones: las de IIBB de las jurisdicciones adheridas en órdenes de pago pagadas del mes (anuladas después: en su mes, E43). */
export async function sircarRetenciones(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const { lista, regimen } = await adheridas(tx, ctx);
  const rets = await retencionesDelPeriodo(tx, ctx, { impuesto: 'IIBB', jurisdiccion: { in: lista } });
  const lineas = rets.map((r, i) => renglon(i + 1, [
    'OP', String(r.ordenPago.numero ?? 0).padStart(12, '0'), normalizarCuit(r.ordenPago.tercero.cuit), fecha(r.ordenPago.fechaPago!),
    n2(r.base), n2(r.alicuota), n2(r.importe), regimen.get(r.jurisdiccion!)?.regimenSircarRetencion || '000', r.jurisdiccion!,
  ]));
  const contenido = archivo(lineas);
  return {
    nombreArchivo: nombre('RETENCIONES', ctx), contenido, huellaDe: contenido, registros: lineas.length, total: rets.reduce((s, r) => s.plus(r.importe), new D(0)),
    advertencias: lineas.length ? [] : [`No hay retenciones de SIRCAR en ${mmaaaa(ctx.periodo)}`],
  };
}

/** SIRCAR percepciones: las de IIBB de las jurisdicciones adheridas en comprobantes de venta del mes; la NC en negativo. */
export async function sircarPercepciones(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const { lista, regimen } = await adheridas(tx, ctx);
  const filas = (await percepcionesDelPeriodo(tx, ctx.desde, ctx.hasta, { tipo: 'IIBB' })).filter((f) => lista.includes(f.p.jurisdiccion ?? ''));
  const lineas = filas.map((f, i) => renglon(i + 1, [
    TIPO_VENTA[f.c.tipo as keyof typeof TIPO_VENTA], `${String(f.c.puntoVenta).padStart(4, '0')}${String(f.c.numero ?? 0).padStart(8, '0')}`, normalizarCuit(f.c.tercero.cuit), fecha(f.c.fecha),
    n2(f.basePesos.mul(f.signo)), n2(f.p.alicuota), n2(f.importePesos.mul(f.signo)), regimen.get(f.p.jurisdiccion ?? '')?.regimenSircarPercepcion || '000', f.p.jurisdiccion ?? '',
  ]));
  const contenido = archivo(lineas);
  return {
    nombreArchivo: nombre('PERCEPCIONES', ctx), contenido, huellaDe: contenido, registros: lineas.length, total: totalPercepciones(filas),
    advertencias: lineas.length ? [] : [`No hay percepciones de SIRCAR en ${mmaaaa(ctx.periodo)}`],
  };
}
