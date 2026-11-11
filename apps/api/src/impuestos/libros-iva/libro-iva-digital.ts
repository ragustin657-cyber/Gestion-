import { cbteTipo, monedaArca, normalizarCuit, type LetraVenta } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { ALICUOTA_LIVA, codigoCompra, codigoOperacion, documentoArca } from '../codigos';
import { archivo, linea } from '../formato/escritor';
import { LIVA_COMPRAS_ALICUOTAS, LIVA_COMPRAS_CBTE, LIVA_VENTAS_ALICUOTAS, LIVA_VENTAS_CBTE } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa, zip } from '../presentaciones/generado';

const clave = (a: Dec) => new D(a).toString();
const alic = (a: Dec) => {
  const c = ALICUOTA_LIVA[clave(a)];
  if (!c) throw new Error(`Alícuota sin código ARCA: ${clave(a)}`);
  return c;
};

/** Libro IVA Digital del mes: ZIP con cabeceras y alícuotas de ventas y de compras (importes en moneda de origen). */
export async function libroIvaDigital(tx: TxEmpresa, ctx: ContextoGeneracion): Promise<Generado> {
  const advertencias: string[] = [];
  const agregar = (r: { texto: string; advertencias: string[] }) => {
    advertencias.push(...r.advertencias);
    return r.texto;
  };
  const vCbte: string[] = [], vAlic: string[] = [], cCbte: string[] = [], cAlic: string[] = [];
  let total = new D(0);

  const ventas = await tx.comprobanteVenta.findMany({
    where: { estado: 'AUTORIZADO', fecha: { gte: ctx.desde, lte: ctx.hasta } }, include: { ivas: true, tercero: true },
    orderBy: [{ fecha: 'asc' }, { tipo: 'asc' }, { puntoVenta: 'asc' }, { numero: 'asc' }],
  });
  for (const c of ventas) {
    const tipo = cbteTipo(c.tipo, c.letra as LetraVenta);
    const doc = documentoArca(c.tercero.tipoDocumento);
    const esC = c.letra === 'C';
    const alicuotas = esC ? [] : c.ivas.length ? c.ivas.map((i) => ({ alicuota: alic(i.alicuota), neto: i.base, impuesto: i.importe })) : [{ alicuota: '0003', neto: new D(0), impuesto: new D(0) }];
    const n = vCbte.length + 1;
    vCbte.push(agregar(linea(LIVA_VENTAS_CBTE, {
      fecha: c.fecha, tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numero, numeroHasta: c.numero,
      codigoDocumento: doc.codigo, numeroDocumento: doc.numero(c.tercero.cuit), denominacion: c.tercero.razonSocial,
      importeTotal: c.total.toString(), noGravado: esC ? '0' : c.noGravado.toString(), exento: esC ? '0' : c.exento.toString(),
      moneda: monedaArca(c.monedaCodigo as 'ARS' | 'USD'), tipoCambio: c.cotizacion.toString(), cantidadAlicuotas: alicuotas.length,
      codigoOperacion: esC ? ' ' : codigoOperacion(c.ivas.length > 0, c.exento.gt(0), c.noGravado.gt(0)),
      fechaVencimientoPago: c.fechaVencimientoPago ?? c.fechaVencimiento,
    }, n)));
    for (const a of alicuotas)
      vAlic.push(agregar(linea(LIVA_VENTAS_ALICUOTAS, { tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numero, netoGravado: a.neto.toString(), alicuota: a.alicuota, impuesto: a.impuesto.toString() }, n)));
    total = total.plus(c.total);
  }

  const compras = await tx.comprobanteCompra.findMany({
    where: { estado: 'CONFIRMADO', fechaContable: { gte: ctx.desde, lte: ctx.hasta } }, include: { ivas: true, percepcionesIibb: true, tercero: true },
    orderBy: [{ fechaContable: 'asc' }, { numeroInterno: 'asc' }],
  });
  for (const c of compras) {
    const tipo = codigoCompra(c.tipo, c.letra);
    const doc = documentoArca(c.tercero.tipoDocumento);
    const sinCredito = c.tipo === 'TICKET' || c.letra === 'C' || c.letra === 'B';
    const alicuotas = sinCredito ? [] : c.ivas.length ? c.ivas.map((i) => ({ alicuota: alic(i.alicuota), neto: i.base, impuesto: i.importe })) : [{ alicuota: '0003', neto: new D(0), impuesto: new D(0) }];
    const n = cCbte.length + 1;
    cCbte.push(agregar(linea(LIVA_COMPRAS_CBTE, {
      fecha: c.fechaEmision, tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numero, despacho: '',
      codigoDocumento: doc.codigo, numeroDocumento: doc.numero(c.tercero.cuit), denominacion: c.tercero.razonSocial,
      importeTotal: c.total.toString(), noGravado: c.noGravado.toString(), exento: c.exento.toString(), percepcionesIva: c.percepcionIva.toString(),
      percepcionesIibb: c.percepcionesIibb.reduce((s, x) => s.plus(x.importe), new D(0)).toString(), impuestosInternos: c.impuestosInternos.toString(),
      moneda: monedaArca(c.monedaCodigo as 'ARS' | 'USD'), tipoCambio: c.cotizacion.toString(), cantidadAlicuotas: alicuotas.length,
      codigoOperacion: sinCredito ? ' ' : codigoOperacion(c.ivas.length > 0, c.exento.gt(0), c.noGravado.gt(0)),
      creditoFiscalComputable: sinCredito ? '0' : c.iva.toString(), cuitCorredor: 0, denominacionCorredor: '', ivaComision: '0',
    }, n)));
    for (const a of alicuotas)
      cAlic.push(agregar(linea(LIVA_COMPRAS_ALICUOTAS, {
        tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numero, codigoDocumento: doc.codigo, numeroDocumento: doc.numero(c.tercero.cuit),
        netoGravado: a.neto.toString(), alicuota: a.alicuota, impuesto: a.impuesto.toString(),
      }, n)));
    total = total.plus(c.total);
  }

  if (!vCbte.length && !cCbte.length) advertencias.push(`No hay comprobantes en ${mmaaaa(ctx.periodo)}`);
  const contenido = await zip({
    'VENTAS_CBTE.txt': archivo(vCbte), 'VENTAS_ALICUOTAS.txt': archivo(vAlic), 'COMPRAS_CBTE.txt': archivo(cCbte), 'COMPRAS_ALICUOTAS.txt': archivo(cAlic),
  });
  return {
    nombreArchivo: `LIBRO_IVA_DIGITAL_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}.zip`, contenido, huellaDe: contenido,
    registros: vCbte.length + cCbte.length, total, advertencias,
  };
}
