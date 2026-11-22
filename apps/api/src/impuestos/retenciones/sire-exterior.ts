import { normalizarCuit } from '@gestion/shared';
import { BadRequestException } from '@nestjs/common';
import type { Tercero } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { linea } from '../formato/escritor';
import { SIRE_F2003 } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa } from '../presentaciones/generado';
import { acumulador, anulacionesDelPeriodo, retencionesDelPeriodo } from './comun';
import { generado, importeSire, numeroNotaCredito } from './sire';

/** Tabla TIPO_COMPROBANTE del SIRE: orden de pago 6 (la retención al exterior es una por orden), nota de crédito 3. */
const ORDEN_PAGO = 6;
const NOTA_CREDITO = 3;

const faltanDatos = (t: Tercero) =>
  !t.nif || t.paisSire == null || !t.domicilioExterior || !t.tipoPersona || (t.tipoPersona === 'F' && (t.nacimientoPais == null || !t.nacimientoFecha));

/** Datos del beneficiario del exterior (campos 20 a 29 del diseño 3.1). */
const beneficiario = (t: Tercero, d: Record<string, string>) => ({
  noRetencion: 0, noRetencionMotivo: '', aplicaCdi: d.aplicaCdi === 'true' ? 1 : 0, codigoAlicuota: d.codigoAlicuota, acrecentamiento: d.acrecentamiento === 'true' ? 1 : 0,
  nif: t.nif, denominacion: t.razonSocial, domicilio: t.domicilioExterior, pais: t.paisSire, tipoPersona: t.tipoPersona,
  nacimientoPais: t.tipoPersona === 'F' && t.nacimientoPais != null ? String(t.nacimientoPais).padStart(3, '0') : '',
  nacimientoFecha: t.tipoPersona === 'F' ? t.nacimientoFecha : null,
});

/**
 * SIRE F.2003 (spec E43 §4): retenciones de Ganancias a beneficiarios del exterior pagadas en el mes, una por orden de pago
 * (tipo 6), y las de meses anteriores anuladas en el mes como nota de crédito del certificado original.
 */
export async function sireGananciasExterior(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const a = acumulador();
  const filtro = { impuesto: 'GANANCIAS_EXTERIOR', importe: { gt: 0 } };
  const rets = await retencionesDelPeriodo(tx, ctx, filtro);
  const anuladas = await anulacionesDelPeriodo(tx, ctx, filtro);
  const incompletos = [...new Set([...rets, ...anuladas].map((r) => r.ordenPago.tercero).filter(faltanDatos).map((t) => t.razonSocial))];
  if (incompletos.length) throw new BadRequestException(`Complete los datos del exterior de: ${incompletos.join(', ')}`);
  const cuit = normalizarCuit(ctx.empresa.cuit);
  const comun = (r: (typeof rets)[number]) => {
    const d = r.detalle as Record<string, string>;
    return { d, campos: { trazabilidad: String(r.certificadoNumero).padStart(8, '0'), cuitAgente: cuit, regimen: d.codigoSire, cuitOrdenante: cuit, importeComprobante: r.base.toString(), ...beneficiario(r.ordenPago.tercero, d) } };
  };
  const lineas = rets.map((r, i) => {
    const { campos } = comun(r);
    return a.tomar(linea(SIRE_F2003, {
      ...campos, fechaRetencion: r.ordenPago.fechaPago, tipoComprobante: ORDEN_PAGO, fechaComprobante: r.ordenPago.fecha, numeroComprobante: String(r.ordenPago.numero ?? 0).padStart(8, '0'),
      certificadoOriginal: '', certificadoOriginalFecha: null, certificadoOriginalImporte: '', motivoNotaCredito: '',
    }, i + 1));
  });
  for (const r of anuladas) {
    const { campos } = comun(r);
    lineas.push(a.tomar(linea(SIRE_F2003, {
      ...campos, fechaRetencion: r.anuladaEn, tipoComprobante: NOTA_CREDITO, fechaComprobante: r.anuladaEn, numeroComprobante: numeroNotaCredito(r.ordenPago.numero),
      certificadoOriginal: r.certificadoSire, certificadoOriginalFecha: r.ordenPago.fechaPago, certificadoOriginalImporte: importeSire(r.importe), motivoNotaCredito: 'Anulación de la orden de pago',
    }, lineas.length + 1)));
  }
  if (!lineas.length) a.advertencias.push(`No hay retenciones de Ganancias a beneficiarios del exterior en ${mmaaaa(ctx.periodo)}`);
  const total = rets.reduce((s, r) => s.plus(r.importe), new D(0)).minus(anuladas.reduce((s, r) => s.plus(r.importe), new D(0)));
  return generado('F2003', ctx, lineas, total, a.advertencias);
}
