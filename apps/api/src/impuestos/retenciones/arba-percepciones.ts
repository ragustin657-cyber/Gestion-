import { formatearCuit, normalizarCuit } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { archivo, linea } from '../formato/escritor';
import { ARBA_PERCEPCION } from '../formato/formatos';
import { percepcionesDelPeriodo, totalPercepciones } from '../percepciones/percepciones-periodo';
import { ContextoGeneracion, Generado, mmaaaa, zip } from '../presentaciones/generado';
import { acumulador } from './comun';

const TIPO = { FACTURA: 'F', NOTA_DEBITO: 'D', NOTA_CREDITO: 'C' } as const;

/** ARBA: lote ZIP con las percepciones de IIBB 902 practicadas en el mes o la quincena (spec E39 §9). La NC va en negativo. */
export async function arbaPercepciones(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const filas = await percepcionesDelPeriodo(tx, ctx.desde, ctx.hasta, { tipo: 'IIBB', jurisdiccion: '902' });
  const a = acumulador();
  const lineas = filas.map((f, i) => a.tomar(linea(ARBA_PERCEPCION, {
    cuit: formatearCuit(f.c.tercero.cuit), fecha: f.c.fecha, tipoComprobante: TIPO[f.c.tipo], letra: f.c.letra, puntoVenta: f.c.puntoVenta, numero: f.c.numero,
    base: f.basePesos.mul(f.signo).toString(), importe: f.importePesos.mul(f.signo).toString(), tipoOperacion: 'A',
  }, i + 1)));
  if (!lineas.length) a.advertencias.push(`No hay percepciones de IIBB Buenos Aires en ${mmaaaa(ctx.periodo)}`, 'Sin percepciones: declare el período sin movimiento en el sitio de ARBA (no hace falta subir el lote)');
  let base = ctx.nombreGuardado?.replace(/\.zip$/, '');
  if (!base) {
    if (lineas.length && !ctx.siguienteLote) throw new Error('Falta el correlativo de lotes de ARBA');
    const lote = String(lineas.length ? await ctx.siguienteLote!() : 0).padStart(5, '0');
    base = `AR-${normalizarCuit(ctx.empresa.cuit)}-${ctx.periodo}${ctx.quincena}-${ctx.config.arbaActividadPercepcion}-LOTE${lote}`;
  }
  const txt = archivo(lineas);
  return { nombreArchivo: `${base}.zip`, contenido: await zip({ [`${base}.txt`]: txt }), huellaDe: txt, registros: lineas.length, total: totalPercepciones(filas), advertencias: a.advertencias };
}
