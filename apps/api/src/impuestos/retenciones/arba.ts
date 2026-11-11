import { normalizarCuit } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { archivo, linea } from '../formato/escritor';
import { ARBA_ALTA } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa, zip } from '../presentaciones/generado';
import { acumulador, retencionesDelPeriodo } from './comun';

export const AVISO_ARBA = 'ARBA emite el comprobante de retención al procesar el lote (RN 22/25): entregue al proveedor el de ARBA.';

/** ARBA A-122R: lote ZIP con el alta de las retenciones de IIBB 902 del mes o la quincena. */
export async function arba(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const rets = await retencionesDelPeriodo(tx, ctx, { impuesto: 'IIBB', jurisdiccion: '902' });
  const a = acumulador();
  const lineas = rets.map((r, i) => a.tomar(linea(ARBA_ALTA, {
    numeroTransaccion: r.certificadoNumero, cuit: normalizarCuit(r.ordenPago.tercero.cuit), sucursal: ctx.config.arbaSucursal,
    fecha: r.ordenPago.fechaPago, alicuota: r.alicuota, base: r.base.toString(),
  }, i + 1)));
  if (!lineas.length) a.advertencias.push(`No hay retenciones de IIBB Buenos Aires en ${mmaaaa(ctx.periodo)}`);
  a.advertencias.push(AVISO_ARBA);
  let base = ctx.nombreGuardado?.replace(/\.zip$/, '');
  if (!base) {
    if (!ctx.siguienteLote) throw new Error('Falta el correlativo de lotes de ARBA');
    const lote = String(await ctx.siguienteLote()).padStart(5, '0');
    base = `ER-${normalizarCuit(ctx.empresa.cuit)}-${ctx.periodo}${ctx.quincena}-${ctx.config.arbaActividad}-LOTE${lote}`;
  }
  const txt = archivo(lineas);
  return {
    nombreArchivo: `${base}.zip`, contenido: await zip({ [`${base}.txt`]: txt }), huellaDe: txt,
    registros: lineas.length, total: rets.reduce((s, r) => s.plus(r.importe), new D(0)), advertencias: a.advertencias,
  };
}
