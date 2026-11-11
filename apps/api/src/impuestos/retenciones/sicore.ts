import { normalizarCuit } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { archivo, linea } from '../formato/escritor';
import { SICORE } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa } from '../presentaciones/generado';
import { acumulador, retencionesDelPeriodo } from './comun';

/** SICORE: retenciones de Ganancias (impuesto 217) del mes, o de la primera quincena. */
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
  if (!lineas.length) a.advertencias.push(`No hay retenciones de Ganancias en ${mmaaaa(ctx.periodo)}`);
  const contenido = archivo(lineas);
  return {
    nombreArchivo: `SICORE_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}${ctx.quincena === 1 ? '_Q1' : ''}.txt`, contenido, huellaDe: contenido,
    registros: lineas.length, total: rets.reduce((s, r) => s.plus(r.importe), new D(0)), advertencias: a.advertencias,
  };
}
