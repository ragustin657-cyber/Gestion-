import { normalizarCuit } from '@gestion/shared';
import { Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { archivo, linea } from '../formato/escritor';
import { SICORE } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa } from '../presentaciones/generado';
import { acumulador, retencionesDelPeriodo } from './comun';

/** SICORE: retenciones de Ganancias (impuesto 217) del mes, o de la primera quincena: a proveedores y a empleados (régimen 160, E32 §9). */
export async function sicore(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const rets = await retencionesDelPeriodo(tx, ctx, { impuesto: 'GANANCIAS' });
  const a = acumulador();
  const lineas = rets.map((r, i) => {
    const op = r.ordenPago;
    return a.tomar(linea(SICORE, {
      codigoComprobante: 6, fechaComprobante: op.fecha, numeroComprobante: op.numero, importeComprobante: op.totalCancelarPesos.toString(),
      codigoImpuesto: 217, codigoRegimen: r.regimen ?? 0, codigoOperacion: 1, baseCalculo: r.base.toString(), fechaRetencion: op.fechaPago,
      codigoCondicion: op.tercero.inscriptoGanancias ? 1 : 2, suspendidos: 0, importeRetencion: r.importe.toString(), porcentajeExclusion: '0',
      fechaBoletin: null, tipoDocumento: 80, numeroDocumento: normalizarCuit(op.tercero.cuit), certificadoOriginal: 0,
    }, i + 1));
  });
  // Retenciones de Ganancias de cuarta a empleados (E32 §9): una línea por recibo con su neto de retenciones del período
  const renglones = await tx.reciboSueldoRenglon.findMany({
    where: { conceptoId: { in: (await tx.concepto.findMany({ where: { tipo: { in: ['GANANCIAS', 'GANANCIAS_AJUSTE'] } }, select: { id: true } })).map((c) => c.id) }, recibo: { liquidacion: { estado: 'CERRADA', fechaPago: { gte: ctx.desde, lte: ctx.hasta } } } },
    include: { recibo: { include: { liquidacion: true } } },
  });
  const porRecibo = new Map<string, { recibo: (typeof renglones)[number]['recibo']; total: Prisma.Decimal }>();
  for (const x of renglones) porRecibo.set(x.reciboId, { recibo: x.recibo, total: (porRecibo.get(x.reciboId)?.total ?? new D(0)).plus(x.importe) });
  const empleados = [...porRecibo.values()].filter((x) => x.total.gt(0)).sort((p, q) => p.recibo.liquidacion.fechaPago.getTime() - q.recibo.liquidacion.fechaPago.getTime() || p.recibo.cuil.localeCompare(q.recibo.cuil));
  let totalEmpleados = new D(0);
  for (const { recibo: r, total } of empleados) {
    const bruto = new D(r.totalRemunerativo).plus(r.totalNoRemunerativo);
    lineas.push(a.tomar(linea(SICORE, {
      codigoComprobante: 7, fechaComprobante: r.liquidacion.fechaPago, numeroComprobante: r.liquidacion.numero, importeComprobante: bruto.toString(),
      codigoImpuesto: 217, codigoRegimen: 160, codigoOperacion: 1, baseCalculo: bruto.toString(), fechaRetencion: r.liquidacion.fechaPago,
      codigoCondicion: 1, suspendidos: 0, importeRetencion: total.toString(), porcentajeExclusion: '0', fechaBoletin: null, tipoDocumento: 86, numeroDocumento: r.cuil.replace(/\D/g, ''), certificadoOriginal: 0,
    }, lineas.length + 1)));
    totalEmpleados = totalEmpleados.plus(total);
  }
  if (!lineas.length) a.advertencias.push(`No hay retenciones de Ganancias en ${mmaaaa(ctx.periodo)}`);
  const contenido = archivo(lineas);
  return {
    nombreArchivo: `SICORE_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}${ctx.quincena === 1 ? '_Q1' : ''}.txt`, contenido, huellaDe: contenido,
    registros: lineas.length, total: rets.reduce((s, r) => s.plus(r.importe), new D(0)).plus(totalEmpleados), advertencias: a.advertencias,
  };
}
