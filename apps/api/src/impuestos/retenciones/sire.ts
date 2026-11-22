import { percepcionesDelPeriodo } from '../percepciones/percepciones-periodo';
import { normalizarCuit } from '@gestion/shared';
import { BadRequestException } from '@nestjs/common';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { archivo, linea } from '../formato/escritor';
import { SIRE_F2004, SIRE_F2005, SIRE_F2005_ANULACION } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa } from '../presentaciones/generado';
import { acumulador, anulacionesDelPeriodo, retencionesDelPeriodo } from './comun';

/** Tabla TIPO_COMPROBANTE del SIRE (§6.3): factura 1, nota de débito 4. */
const TIPO_SIRE: Record<string, number> = { FACTURA: 1, NOTA_DEBITO: 4 };

/** Retenciones de IVA o SUSS del mes con su régimen (que tiene que tener código SIRE) y la factura retenida. */
async function retenciones(tx: TxEmpresa, ctx: ContextoGeneracion, impuesto: 'IVA' | 'SUSS') {
  const rets = await retencionesDelPeriodo(tx, ctx, { impuesto });
  const ids = [...new Set(rets.map((r) => r.regimen).filter((x): x is string => !!x))];
  const regs = impuesto === 'IVA' ? await tx.regimenIva.findMany({ where: { id: { in: ids } } }) : await tx.regimenSuss.findMany({ where: { id: { in: ids } } });
  const porId = new Map<string, { codigoSire: string | null; descripcion: string; condicionSire?: number | null }>(regs.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = porId.get(id);
    if (!r?.codigoSire) throw new BadRequestException(`Cargue el código SIRE del régimen ${r?.descripcion ?? id}`);
  }
  return rets.map((r) => {
    const d = r.detalle as Record<string, string>;
    return { r, reg: porId.get(r.regimen ?? '')!, d, numero: `${String(d.puntoVenta).padStart(5, '0')}-${String(d.numero).padStart(8, '0')}`, tipo: TIPO_SIRE[d.tipo] ?? 1, traza: String(r.certificadoNumero).padStart(8, '0') };
  });
}

const nombre = (form: string, ctx: ContextoGeneracion) => `SIRE-${form}_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}.txt`;
const generado = (form: string, ctx: ContextoGeneracion, lineas: string[], total: InstanceType<typeof D>, advertencias: string[]): Generado => {
  const contenido = archivo(lineas);
  return { nombreArchivo: nombre(form, ctx), contenido, huellaDe: contenido, registros: lineas.length, total, advertencias };
};

/** SIRE F.2005: retenciones de IVA del mes (spec E35 §7). */
export async function sireIva(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const a = acumulador();
  const filas = await retenciones(tx, ctx, 'IVA');
  const lineas = filas.map(({ r, reg, d, numero, tipo, traza }, i) => {
    const exclusion = Number(d.exclusion ?? 0);
    return a.tomar(linea(SIRE_F2005, {
      trazabilidad: traza, regimen: reg.codigoSire, fechaRetencion: r.ordenPago.fechaPago,
      condicion: reg.condicionSire != null ? String(reg.condicionSire).padStart(2, '0') : '', motivoNoRetencion: '',
      importeRetencion: r.importe.toString(), baseCalculo: r.base.toString(), regimenExclusion: exclusion ? 1 : 0,
      porcentajeExclusion: exclusion ? exclusion.toFixed(2).padStart(6, '0') : '', fechaPublicacion: exclusion && d.exclusionPublicacion ? d.exclusionPublicacion : null,
      tipoComprobante: tipo, fechaComprobante: d.fecha, numeroComprobante: numero, coe: '', coeOriginal: '', cae: '', importeComprobante: d.total,
      motivoNotaCredito: '', retenidoClave: normalizarCuit(r.ordenPago.tercero.cuit), certificadoOriginal: '', certificadoOriginalFecha: null, certificadoOriginalImporte: '', motivoAnulacion: '',
    }, i + 1));
  });
  // E39: las percepciones de IVA practicadas se cargan en el SIRE con el informe (el lote de percepciones queda a verificar)
  const percs = await percepcionesDelPeriodo(tx, ctx.desde, ctx.hasta, { tipo: 'IVA' });
  if (percs.length) a.advertencias.push(`Hay percepciones de IVA en ${mmaaaa(ctx.periodo)}: cárguelas en el SIRE con el informe de percepciones practicadas`);
  return generado('F2005', ctx, lineas, filas.reduce((s, f) => s.plus(f.r.importe), new D(0)), a.advertencias);
}

/** SIRE F.2004: retenciones de SUSS del mes (spec E35 §7). */
export async function sireSuss(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const a = acumulador();
  const filas = await retenciones(tx, ctx, 'SUSS');
  const lineas = filas.map(({ r, reg, d, numero, tipo, traza }, i) => a.tomar(linea(SIRE_F2004, {
    trazabilidad: traza, cuitAgente: normalizarCuit(ctx.empresa.cuit), regimen: reg.codigoSire, cuitRetenido: normalizarCuit(r.ordenPago.tercero.cuit),
    fechaRetencion: r.ordenPago.fechaPago, tipoComprobante: tipo, fechaComprobante: d.fecha, numeroComprobante: numero, importeComprobante: d.total,
    importeRetencion: r.importe.toString(), certificadoOriginal: '', certificadoOriginalFecha: null, certificadoOriginalImporte: '', otrosDatos: '',
  }, i + 1)));
  // E43: las retenciones de SUSS ya presentadas y anuladas en el mes van como nota de crédito del certificado original
  const anuladas = await anulacionesDelPeriodo(tx, ctx, { impuesto: 'SUSS' });
  const regs = new Map((await tx.regimenSuss.findMany({ where: { id: { in: anuladas.map((r) => r.regimen).filter((x): x is string => !!x) } } })).map((r) => [r.id, r]));
  for (const r of anuladas) {
    const d = r.detalle as Record<string, string>;
    const reg = regs.get(r.regimen ?? '');
    if (!reg?.codigoSire) throw new BadRequestException(`Cargue el código SIRE del régimen ${reg?.descripcion ?? r.regimen}`);
    lineas.push(a.tomar(linea(SIRE_F2004, {
      trazabilidad: String(r.certificadoNumero).padStart(8, '0'), cuitAgente: normalizarCuit(ctx.empresa.cuit), regimen: reg.codigoSire, cuitRetenido: normalizarCuit(r.ordenPago.tercero.cuit),
      fechaRetencion: r.anuladaEn, tipoComprobante: 3, fechaComprobante: r.anuladaEn, numeroComprobante: numeroNotaCredito(r.ordenPago.numero), importeComprobante: d.total,
      importeRetencion: r.importe.toString(), certificadoOriginal: r.certificadoSire, certificadoOriginalFecha: r.ordenPago.fechaPago,
      certificadoOriginalImporte: importeSire(r.importe), otrosDatos: 'Anulación de la orden de pago',
    }, lineas.length + 1)));
  }
  return generado('F2004', ctx, lineas, filas.reduce((s, f) => s.plus(f.r.importe), new D(0)).minus(anuladas.reduce((s, r) => s.plus(r.importe), new D(0))), a.advertencias);
}

/** Número de la nota de crédito del SIRE (formato 99999-99999999): la orden de pago anulada (E43). */
export const numeroNotaCredito = (numeroOp: number | null) => `00001-${String(numeroOp ?? 0).padStart(8, '0')}`;
/** Importe con el formato decimal del SIRE (14, punto, ceros a la izquierda) para campos de texto. */
export const importeSire = (x: InstanceType<typeof D> | string) => new D(x).toFixed(2).padStart(14, '0');

/** SIRE F.2005, anulación por lote (E43): retenciones de IVA ya presentadas y anuladas en el mes, en un archivo aparte. */
export async function sireIvaAnulaciones(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const a = acumulador();
  const anuladas = await anulacionesDelPeriodo(tx, ctx, { impuesto: 'IVA' });
  const lineas = anuladas.map((r, i) => a.tomar(linea(SIRE_F2005_ANULACION, {
    trazabilidad: String(r.certificadoNumero).padStart(8, '0'), certificadoOriginal: r.certificadoSire, motivo: ctx.config.sireMotivoAnulacion,
  }, i + 1)));
  if (!lineas.length) a.advertencias.push(`No hay anulaciones de retenciones de IVA para informar en ${mmaaaa(ctx.periodo)}`);
  return generado('F2005-ANULACIONES', ctx, lineas, anuladas.reduce((s, r) => s.plus(r.importe), new D(0)), a.advertencias);
}
