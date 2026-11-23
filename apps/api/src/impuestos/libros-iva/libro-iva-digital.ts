import { coeficienteDelMes, conProrrateo } from '../posicion-iva/prorrateo-datos';
import { cbteTipo, monedaArca, normalizarCuit, type LetraVenta } from '@gestion/shared';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { ALICUOTA_LIVA, codigoCompra, codigoOperacion, documentoArca } from '../codigos';
import { archivo, linea } from '../formato/escritor';
import { LIVA_COMPRAS_ALICUOTAS, LIVA_COMPRAS_CBTE, LIVA_COMPRAS_IMPORTACIONES, LIVA_VENTAS_ALICUOTAS, LIVA_VENTAS_CBTE } from '../formato/formatos';
import { ContextoGeneracion, Generado, mmaaaa, zip } from '../presentaciones/generado';
import { ventasDelAmbiente } from './libro-ventas.service';

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
  const vCbte: string[] = [], vAlic: string[] = [], cCbte: string[] = [], cAlic: string[] = [], cImp: string[] = [];
  // Totales de control en pesos, calculados igual que los libros (NC restan; IVA redondeado por alícuota)
  const control = { ventas: { total: new D(0), iva: new D(0) }, compras: { total: new D(0), iva: new D(0) } };
  const acumular = (lado: 'ventas' | 'compras', c: { tipo: string; cotizacion: Dec; totalPesos: Dec; ivas: { importe: Dec }[] }) => {
    const s = c.tipo === 'NOTA_CREDITO' ? -1 : 1;
    control[lado].total = control[lado].total.plus(c.totalPesos.mul(s));
    for (const i of c.ivas) control[lado].iva = control[lado].iva.plus(i.importe.mul(c.cotizacion).toDecimalPlaces(2).mul(s));
  };

  const { ambiente, omitidos } = await ventasDelAmbiente(tx, ctx.desde, ctx.hasta);
  advertencias.push(...omitidos);
  const ventas = await tx.comprobanteVenta.findMany({
    where: { estado: 'AUTORIZADO', ambiente, fecha: { gte: ctx.desde, lte: ctx.hasta } }, include: { ivas: true, tercero: true, percepcionesDetalle: true },
    orderBy: [{ fecha: 'asc' }, { tipo: 'asc' }, { puntoVenta: 'asc' }, { numero: 'asc' }],
  });
  for (const c of ventas) {
    const tipo = cbteTipo(c.tipo, c.letra as LetraVenta, c.fce);
    const doc = documentoArca(c.tercero.tipoDocumento);
    const esC = c.letra === 'C';
    const alicuotas = esC ? [] : c.ivas.length ? c.ivas.map((i) => ({ alicuota: alic(i.alicuota), neto: i.base, impuesto: i.importe })) : [{ alicuota: '0003', neto: new D(0), impuesto: new D(0) }];
    const n = vCbte.length + 1;
    vCbte.push(agregar(linea(LIVA_VENTAS_CBTE, {
      fecha: c.fecha, tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numero, numeroHasta: c.numero,
      codigoDocumento: doc.codigo, numeroDocumento: doc.numero(c.tercero.cuit), denominacion: c.tercero.razonSocial,
      importeTotal: c.total.toString(), noGravado: esC ? '0' : c.noGravado.toString(), exento: esC ? '0' : c.exento.toString(),
      // E39: percepciones practicadas (moneda de origen, como los demás importes)
      percepcionesNacionales: c.percepcionesDetalle.filter((x) => x.tipo === 'IVA').reduce((t, x) => t.plus(x.importe), new D(0)).toString(),
      percepcionesIibb: c.percepcionesDetalle.filter((x) => x.tipo === 'IIBB').reduce((t, x) => t.plus(x.importe), new D(0)).toString(),
      moneda: monedaArca(c.monedaCodigo as 'ARS' | 'USD'), tipoCambio: c.cotizacion.toString(), cantidadAlicuotas: alicuotas.length,
      codigoOperacion: esC ? ' ' : codigoOperacion(c.ivas.length > 0, c.exento.gt(0), c.noGravado.gt(0)),
      fechaVencimientoPago: c.fechaVencimientoPago ?? c.fechaVencimiento,
    }, n)));
    for (const a of alicuotas)
      vAlic.push(agregar(linea(LIVA_VENTAS_ALICUOTAS, { tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numero, netoGravado: a.neto.toString(), alicuota: a.alicuota, impuesto: a.impuesto.toString() }, n)));
    acumular('ventas', c);
  }

  const compras = await tx.comprobanteCompra.findMany({
    where: { estado: 'CONFIRMADO', fechaContable: { gte: ctx.desde, lte: ctx.hasta } }, include: { ivas: true, percepcionesIibb: true, tercero: true },
    orderBy: [{ fechaContable: 'asc' }, { numeroInterno: 'asc' }],
  });
  for (const c of compras) {
    const tipo = codigoCompra(c.tipo, c.letra, c.fce);
    const doc = documentoArca(c.tercero.tipoDocumento);
    const sinCredito = c.tipo === 'TICKET' || c.letra === 'C' || c.letra === 'B';
    const alicuotas = sinCredito ? [] : c.ivas.length ? c.ivas.map((i) => ({ alicuota: alic(i.alicuota), neto: i.base, impuesto: i.importe })) : [{ alicuota: '0003', neto: new D(0), impuesto: new D(0) }];
    const n = cCbte.length + 1;
    cCbte.push(agregar(linea(LIVA_COMPRAS_CBTE, {
      // E41: el despacho va sin punto de venta ni número, con su número de despacho
      fecha: c.fechaEmision, tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numeroDespacho ? 0 : c.numero, despacho: c.numeroDespacho ?? '',
      codigoDocumento: doc.codigo, numeroDocumento: doc.numero(c.tercero.cuit), denominacion: c.tercero.razonSocial,
      importeTotal: c.total.toString(), noGravado: c.noGravado.toString(), exento: c.exento.toString(), percepcionesIva: c.percepcionIva.toString(), percepcionesNacionales: c.percepcionGanancias.toString(),
      percepcionesIibb: c.percepcionesIibb.reduce((s, x) => s.plus(x.importe), new D(0)).toString(), impuestosInternos: c.impuestosInternos.toString(),
      moneda: monedaArca(c.monedaCodigo as 'ARS' | 'USD'), tipoCambio: c.cotizacion.toString(), cantidadAlicuotas: alicuotas.length,
      codigoOperacion: sinCredito ? ' ' : codigoOperacion(c.ivas.length > 0, c.exento.gt(0), c.noGravado.gt(0)),
      creditoFiscalComputable: sinCredito ? '0' : c.iva.toString(), otrosTributos: c.derechosImportacion.plus(c.tasaEstadistica).toString(), cuitCorredor: 0, denominacionCorredor: '', ivaComision: '0',
    }, n)));
    // E41 (revisión): las alícuotas de un despacho van al archivo de importaciones, identificadas por el número de despacho
    if (c.numeroDespacho)
      for (const a of alicuotas) cImp.push(agregar(linea(LIVA_COMPRAS_IMPORTACIONES, { despacho: c.numeroDespacho, netoGravado: a.neto.toString(), alicuota: a.alicuota, impuesto: a.impuesto.toString() }, n)));
    else for (const a of alicuotas)
      cAlic.push(agregar(linea(LIVA_COMPRAS_ALICUOTAS, {
        tipoComprobante: tipo, puntoVenta: c.puntoVenta, numero: c.numeroDespacho ? 0 : c.numero, codigoDocumento: doc.codigo, numeroDocumento: doc.numero(c.tercero.cuit),
        netoGravado: a.neto.toString(), alicuota: a.alicuota, impuesto: a.impuesto.toString(),
      }, n)));
    acumular('compras', c);
  }

  if (!vCbte.length && !cCbte.length) advertencias.push(`No hay comprobantes en ${mmaaaa(ctx.periodo)}`);
  // E40: el crédito computable del archivo es el IVA de cada compra; el prorrateo se declara en ARCA (a verificar)
  const anio = Number(ctx.periodo.slice(0, 4)), mes = Number(ctx.periodo.slice(4, 6));
  if (conProrrateo(ctx.config, anio, mes)) {
    const { coeficiente } = await coeficienteDelMes(tx, ctx.config, anio, mes);
    advertencias.push(`Con prorrateo del crédito fiscal: declare el prorrateo global en el Libro IVA Digital (coeficiente ${coeficiente.replace('.', ',')})`);
  }
  const archivos: Record<string, Buffer> = { 'VENTAS_CBTE.txt': archivo(vCbte), 'VENTAS_ALICUOTAS.txt': archivo(vAlic), 'COMPRAS_CBTE.txt': archivo(cCbte), 'COMPRAS_ALICUOTAS.txt': archivo(cAlic) };
  // Solo con despachos: así la huella de los meses sin importaciones no cambia
  if (cImp.length) archivos['COMPRAS_IMPORTACIONES.txt'] = archivo(cImp);
  const contenido = await zip(archivos);
  // La huella es la de los TXT (nombre y contenido), no la del ZIP: no cambia si cambia la compresión
  const huellaDe = Buffer.from(Object.entries(archivos).flatMap(([n, b]) => [n, b.toString('latin1')]).join('\n'), 'latin1');
  return {
    nombreArchivo: `LIBRO_IVA_DIGITAL_${normalizarCuit(ctx.empresa.cuit)}_${ctx.periodo}.zip`, contenido, huellaDe,
    registros: vCbte.length + cCbte.length, total: control.ventas.total, advertencias,
    controles: {
      ventas: { registros: vCbte.length, total: control.ventas.total.toFixed(2), iva: control.ventas.iva.toFixed(2) },
      compras: { registros: cCbte.length, total: control.compras.total.toFixed(2), iva: control.compras.iva.toFixed(2) },
    },
  };
}
