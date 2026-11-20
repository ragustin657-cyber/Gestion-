import { BadRequestException } from '@nestjs/common';
import { normalizarCuit } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { archivo, linea } from '../formato/escritor';
import { AGIP_RETENCION } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa } from '../presentaciones/generado';
import { acumulador, retencionesDelPeriodo } from './comun';
import { percepcionesDelPeriodo } from '../percepciones/percepciones-periodo';

const SITUACION_IIBB = { LOCAL: 1, CONVENIO: 2, NO_INSCRIPTO: 4, SIMPLIFICADO: 5 } as const;
const SITUACION_IVA: Record<string, number> = { RESPONSABLE_INSCRIPTO: 1, EXENTO: 3, MONOTRIBUTO: 4 };

/** AGIP e-ARCIBA: retenciones de IIBB 901 del mes. Exige situación (y número) de IIBB de cada proveedor. */
export async function agip(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const rets = await retencionesDelPeriodo(tx, ctx, { impuesto: 'IIBB', jurisdiccion: '901' });
  // E39: percepciones 901 de facturas y ND (las NC van en otro diseño de e-ARCIBA: aviso)
  const percs = await percepcionesDelPeriodo(tx, ctx.desde, ctx.hasta, { tipo: 'IIBB', jurisdiccion: '901' });
  const facturas = percs.filter((f) => f.c.tipo !== 'NOTA_CREDITO');
  const terceros = [...new Map([...rets.map((r) => r.ordenPago.tercero), ...facturas.map((f) => f.c.tercero)].map((t) => [t.id, t])).values()];
  const incompletos = terceros.filter((t) => !t.situacionIibb || (t.situacionIibb !== 'NO_INSCRIPTO' && !t.numeroIibb));
  if (incompletos.length) throw new BadRequestException(`Complete la situación de Ingresos Brutos de: ${incompletos.map((t) => t.razonSocial).join(', ')}`);
  const sinIva = terceros.filter((t) => !SITUACION_IVA[t.condicionIva]);
  if (sinIva.length) throw new BadRequestException(`La condición de IVA no se puede informar a AGIP para: ${sinIva.map((t) => t.razonSocial).join(', ')}`);
  const a = acumulador();
  const lineas: string[] = rets.map((r, i) => {
    const op = r.ordenPago, t = op.tercero;
    return a.tomar(linea(AGIP_RETENCION, {
      tipoOperacion: 1, codigoNorma: ctx.config.agipCodigoNorma, fechaRetencion: op.fechaPago, tipoComprobante: 3, letra: '',
      numeroComprobante: op.numero, fechaComprobante: op.fecha, montoComprobante: r.base.toString(), certificadoPropio: String(r.certificadoNumero),
      tipoDocumento: 3, numeroDocumento: normalizarCuit(t.cuit), situacionIibb: SITUACION_IIBB[t.situacionIibb!],
      numeroIibb: t.situacionIibb === 'NO_INSCRIPTO' ? 0 : t.numeroIibb, situacionIva: SITUACION_IVA[t.condicionIva], razonSocial: t.razonSocial,
      importeOtrosConceptos: '0', importeIva: '0', montoSujeto: r.base.toString(), alicuota: r.alicuota, retencion: r.importe.toString(), montoTotal: r.importe.toString(),
    }, i + 1));
  });
  for (const f of facturas) {
    const c = f.c, t = c.tercero;
    lineas.push(a.tomar(linea(AGIP_RETENCION, {
      tipoOperacion: 2, codigoNorma: ctx.config.agipCodigoNorma, fechaRetencion: c.fecha, tipoComprobante: c.tipo === 'NOTA_DEBITO' ? 2 : 1, letra: c.letra,
      numeroComprobante: `${String(c.puntoVenta).padStart(4, '0')}${String(c.numero ?? 0).padStart(8, '0')}`, fechaComprobante: c.fecha,
      montoComprobante: c.totalPesos.toString(), certificadoPropio: '', tipoDocumento: 3, numeroDocumento: normalizarCuit(t.cuit), situacionIibb: SITUACION_IIBB[t.situacionIibb!],
      numeroIibb: t.situacionIibb === 'NO_INSCRIPTO' ? 0 : t.numeroIibb, situacionIva: SITUACION_IVA[t.condicionIva], razonSocial: t.razonSocial,
      importeOtrosConceptos: '0', importeIva: c.iva.mul(c.cotizacion).toDecimalPlaces(2).toString(), montoSujeto: f.basePesos.toString(), alicuota: f.p.alicuota.toString(),
      retencion: f.importePesos.toString(), montoTotal: f.importePesos.toString(),
    }, lineas.length + 1)));
  }
  if (percs.some((f) => f.c.tipo === 'NOTA_CREDITO')) a.advertencias.push('Hay notas de crédito con percepciones de CABA: cárguelas en e-ARCIBA');
  if (!lineas.length) a.advertencias.push(`No hay retenciones de IIBB CABA en ${mmaaaa(ctx.periodo)}`);
  const contenido = archivo(lineas);
  return {
    nombreArchivo: `AGIP_RET_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}.txt`, contenido, huellaDe: contenido,
    registros: lineas.length, total: rets.reduce((s, r) => s.plus(r.importe), new D(0)).plus(facturas.reduce((s, f) => s.plus(f.importePesos), new D(0))), advertencias: a.advertencias,
  };
}
