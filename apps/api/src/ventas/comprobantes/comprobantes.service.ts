import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ComprobanteVenta } from '@prisma/client';
import { calcularVenta, cbteTipo, docTipoArca, ETIQUETAS_CONDICION_IVA, formatearCuit, letraVenta, monedaArca, normalizarCuit, urlQrArca, type AlicuotaVenta, type LetraVenta } from '@gestion/shared';
import { fechaAR } from '../../compras/comun';
import { importeAR, pdfVenta } from '../pdf/pdf-venta';
import { importesConIva } from '../pdf/importes-b';
import { ClsService } from 'nestjs-cls';
import { VentasStock } from '../../stock/ventas-stock';
import { OrigenesVenta } from './origenes';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear, MODIFICADO } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cotizacion, D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { DatosComprobanteVenta } from './dto';

export const AUTORIZADO_NO_SE_ANULA = 'Un comprobante autorizado no se anula: emita una nota de crédito';
export const EMISION_SIN_CONFIRMAR = 'El comprobante tiene una emisión sin confirmar: reintente para resolverla';
/** Una emisión se considera abandonada pasado este tiempo (más que el peor caso de llamadas a ARCA con sus timeouts). */
export const EN_CURSO_MS = 5 * 60000;
export const INCLUIR_VENTA = { renglones: { orderBy: { orden: 'asc' } }, ivas: true, tercero: true } satisfies Prisma.ComprobanteVentaInclude;

/** "0001-00000012" */
export const numeroVenta = (puntoVenta: number, numero: number | null) => `${String(puntoVenta).padStart(4, '0')}-${String(numero ?? 0).padStart(8, '0')}`;
export const emisionEnCurso = (c: Pick<ComprobanteVenta, 'emisionEnCurso'>) => !!c.emisionEnCurso && Date.now() - c.emisionEnCurso.getTime() < EN_CURSO_MS;

@Injectable()
export class ComprobantesVentaService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
    private readonly stock: VentasStock,
    private readonly origenes: OrigenesVenta,
  ) {}

  obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    return tx.comprobanteVenta.findUnique({ where: { id }, include: INCLUIR_VENTA }).then((c) => {
      if (!c) throw new NotFoundException('Comprobante no encontrado');
      return c;
    });
  }

  /**
   * Lo que todavía se puede acreditar a un comprobante: su saldo en la cuenta corriente (en su moneda)
   * menos las NC autorizadas que lo referencian y todavía no se aplicaron.
   */
  async saldoDisponibleNc(tx: TxEmpresa, asociadoId: string, excluirId?: string): Promise<Dec> {
    const mov = await tx.movimientoCuentaCorriente.findFirst({ where: { origenTipo: 'VENTA', origenId: asociadoId, anulado: false } });
    const ncs = await tx.comprobanteVenta.findMany({ where: { comprobanteAsociadoId: asociadoId, tipo: 'NOTA_CREDITO', estado: 'AUTORIZADO', id: excluirId ? { not: excluirId } : undefined }, select: { id: true } });
    const movsNc = ncs.length ? await tx.movimientoCuentaCorriente.findMany({ where: { origenTipo: 'VENTA', origenId: { in: ncs.map((n) => n.id) }, anulado: false } }) : [];
    // También las NC pendientes de CAE sobre el mismo comprobante: dos NC en paralelo no pueden superar el saldo
    const pendientes = await tx.comprobanteVenta.aggregate({ where: { comprobanteAsociadoId: asociadoId, tipo: 'NOTA_CREDITO', estado: 'PENDIENTE_CAE', id: excluirId ? { not: excluirId } : undefined }, _sum: { total: true } });
    return movsNc.reduce((s: Dec, m) => s.plus(m.saldo), new D(mov?.saldo ?? 0)).minus(pendientes._sum.total ?? 0);
  }

  /** Mensaje del tope de NC; si hay NC pendientes de CAE sobre el mismo comprobante, las nombra (pueden ser borradores olvidados). */
  async mensajeTopeNc(tx: TxEmpresa, asociadoId: string, excluirId?: string): Promise<string> {
    const asoc = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id: asociadoId } });
    const base = `La nota de crédito supera el saldo de la factura ${numeroVenta(asoc.puntoVenta, asoc.numero)}`;
    const pendientes = await tx.comprobanteVenta.findMany({ where: { comprobanteAsociadoId: asociadoId, tipo: 'NOTA_CREDITO', estado: 'PENDIENTE_CAE', id: excluirId ? { not: excluirId } : undefined }, orderBy: { numeroInterno: 'asc' } });
    if (!pendientes.length) return base;
    return `${base}. Hay notas de crédito pendientes de CAE sobre esa factura: ${pendientes.map((p) => `N° interno ${p.numeroInterno} por ${importeAR(p.total.toString())}`).join(', ')}. Edítelas o elimínelas.`;
  }

  /** Valida y calcula: letra, cuenta de cada renglón, importes y cotización. Lanza 400 con los mensajes de la spec. */
  async preparar(tx: TxEmpresa, d: DatosComprobanteVenta, id?: string) {
    const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!tercero || !tercero.esCliente || !tercero.activo) throw new BadRequestException('Cliente inexistente o inactivo');
    const pv = await tx.puntoVenta.findUnique({ where: { id: d.puntoVentaId } });
    if (!pv) throw new BadRequestException('Punto de venta inexistente');
    if (!pv.electronico) throw new BadRequestException('El punto de venta no es electrónico');
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    let letra: LetraVenta;
    try {
      letra = letraVenta(empresa.condicionIva, tercero.condicionIva);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (d.tipo !== 'FACTURA') {
      const asoc = await tx.comprobanteVenta.findUnique({ where: { id: d.comprobanteAsociadoId! } });
      if (!asoc || asoc.estado !== 'AUTORIZADO' || asoc.tipo === 'NOTA_CREDITO') throw new BadRequestException('El comprobante asociado debe ser una factura o nota de débito autorizada');
      if (asoc.terceroId !== d.terceroId) throw new BadRequestException('El comprobante asociado es de otro cliente');
      if (asoc.monedaCodigo !== d.monedaCodigo) throw new BadRequestException('El comprobante asociado está en otra moneda');
      letra = asoc.letra as LetraVenta;
    }
    if (letra === 'A' && tercero.tipoDocumento !== 'CUIT') throw new BadRequestException('El cliente no tiene CUIT válido para una factura A');
    const calc = calcularVenta(d.renglones.map((r) => ({ cantidad: String(r.cantidad), precioUnitario: String(r.precioUnitario), alicuota: r.alicuota as AlicuotaVenta })), letra);
    if (d.tipo === 'NOTA_CREDITO') {
      const disponible = await this.saldoDisponibleNc(tx, d.comprobanteAsociadoId!, id);
      if (new D(calc.total).gt(disponible)) throw new BadRequestException(await this.mensajeTopeNc(tx, d.comprobanteAsociadoId!, id));
    }
    const cot = d.monedaCodigo === 'ARS' ? new D(1) : d.cotizacion ? new D(d.cotizacion) : await cotizacion(tx, 'USD', d.fecha);
    const origenes = await this.origenes.resolver(tx, { tipo: d.tipo, terceroId: d.terceroId, renglones: d.renglones });
    const articulos = await tx.articulo.findMany({ where: { id: { in: [...d.renglones.map((r) => r.articuloId), ...origenes.map((o) => o.articuloId)].filter((x): x is string => !!x) } } });
    const ventas = await this.cuentas.cuenta(tx, 'VENTAS');
    const renglones = d.renglones.map((r, i) => {
      if (r.articuloId && !articulos.some((a) => a.id === r.articuloId)) throw new BadRequestException('Artículo inexistente');
      const o = origenes[i];
      return {
        empresaId: this.tenant.empresaId, orden: i, articuloId: o.articuloId, descripcion: o.descripcion, remitoRenglonId: o.remitoRenglonId, pedidoRenglonId: o.pedidoRenglonId, cantidad: r.cantidad, precioUnitario: r.precioUnitario, alicuota: String(r.alicuota),
        neto: calc.renglones[i].neto, iva: calc.renglones[i].iva, cuentaContableId: articulos.find((a) => a.id === o.articuloId)?.cuentaVentaId ?? ventas,
      };
    });
    const depositoId = d.depositoId ?? pv.depositoId ?? null;
    // Los renglones de remito ya salieron del stock: no se controlan ni se mueven
    const advertencias = await this.stock.controlar(tx, {
      id, tipo: d.tipo, depositoId, devuelveMercaderia: d.devuelveMercaderia, comprobanteAsociadoId: d.comprobanteAsociadoId ?? null,
      renglones: d.renglones.map((r, i) => ({ articuloId: origenes[i].remitoRenglonId ? null : origenes[i].articuloId, cantidad: r.cantidad })),
    });
    return {
      advertencias,
      datos: {
        depositoId, devuelveMercaderia: d.devuelveMercaderia,
        tipo: d.tipo, letra, puntoVentaId: pv.id, puntoVenta: pv.numero, terceroId: d.terceroId, fecha: d.fecha, fechaVencimiento: d.fechaVencimiento, concepto: d.concepto,
        fechaServicioDesde: d.concepto === 'PRODUCTOS' ? null : d.fechaServicioDesde, fechaServicioHasta: d.concepto === 'PRODUCTOS' ? null : d.fechaServicioHasta,
        fechaVencimientoPago: d.concepto === 'PRODUCTOS' ? null : d.fechaVencimientoPago,
        monedaCodigo: d.monedaCodigo, cotizacion: cot, netoGravado: calc.netoGravado, noGravado: calc.noGravado, exento: calc.exento, iva: calc.iva, total: calc.total,
        totalPesos: new D(calc.total).mul(cot).toDecimalPlaces(2), comprobanteAsociadoId: d.tipo === 'FACTURA' ? null : d.comprobanteAsociadoId, aplicarAAsociado: d.aplicarAAsociado,
      },
      renglones,
      ivas: calc.ivas.map((x) => ({ empresaId: this.tenant.empresaId, alicuota: x.alicuota, base: x.base, importe: x.importe })),
    };
  }

  crear(d: DatosComprobanteVenta) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.preparar(tx, d);
      const numeroInterno = await this.numeracion.siguiente(tx, 'VENTA-INTERNO', 0);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const c = await tx.comprobanteVenta.create({
        data: { ...p.datos, numeroInterno, creadoPor: usuario, renglones: { create: p.renglones }, ivas: { create: p.ivas } } as Prisma.ComprobanteVentaUncheckedCreateInput,
      });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: c.id, accion: 'CREAR', datos: { numeroInterno, tipo: c.tipo, letra: c.letra, total: c.total } });
      return { ...(await this.obtener(c.id, tx)), advertencias: p.advertencias };
    });
  }

  /** Bloquea un comprobante que todavía se puede editar o eliminar. */
  private async editable(tx: TxEmpresa, id: string) {
    await this.obtener(id, tx);
    await bloquear(tx, 'ComprobanteVenta', this.tenant.empresaId, [id]);
    const c = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id } });
    if (c.estado === 'AUTORIZADO') throw new BadRequestException(AUTORIZADO_NO_SE_ANULA);
    if (emisionEnCurso(c)) throw new ConflictException('Hay una emisión en curso para este comprobante');
    if (c.numeroReservado !== null) throw new BadRequestException(EMISION_SIN_CONFIRMAR);
    return c;
  }

  modificar(id: string, version: number, d: DatosComprobanteVenta) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.editable(tx, id);
      if (c.version !== version) throw new ConflictException(MODIFICADO);
      const p = await this.preparar(tx, d, id);
      await tx.comprobanteVentaRenglon.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVentaIva.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVenta.update({
        where: { id },
        data: { ...p.datos, version: { increment: 1 }, renglones: { create: p.renglones }, ivas: { create: p.ivas } } as Prisma.ComprobanteVentaUncheckedUpdateInput,
      });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'MODIFICAR', datos: { total: p.datos.total } });
      return this.obtener(id, tx);
    });
  }

  /** PDF de un comprobante autorizado, con QR de ARCA. En Simulado y Homologación lleva "SIN VALIDEZ FISCAL". */
  async pdf(id: string): Promise<{ nombre: string; contenido: Buffer }> {
    const db = this.tenant.db;
    const c = await this.obtener(id);
    if (c.estado !== 'AUTORIZADO' || !c.cae || c.numero === null) throw new BadRequestException('El comprobante no tiene CAE');
    const empresa = await db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const config = await db.configArca.findFirst();
    const asoc = c.comprobanteAsociadoId ? await db.comprobanteVenta.findUnique({ where: { id: c.comprobanteAsociadoId } }) : null;
    const letra = c.letra as LetraVenta;
    const codigo = cbteTipo(c.tipo, letra);
    const a = letra === 'A';
    const t = c.tercero;
    const documento = t.tipoDocumento === 'CUIT' ? `CUIT ${formatearCuit(t.cuit)}` : t.tipoDocumento === 'DNI' ? `DNI ${t.cuit}` : 'Sin identificar';
    const titulos = { FACTURA: 'FACTURA', NOTA_DEBITO: 'NOTA DE DÉBITO', NOTA_CREDITO: 'NOTA DE CRÉDITO' } as const;
    const importesB = importesConIva(c.renglones.map((r) => ({ neto: r.neto.toString(), iva: r.iva.toString(), alicuota: r.alicuota })), c.ivas.map((x) => ({ alicuota: x.alicuota.toString(), importe: x.importe.toString() })));
    const totales: [string, string][] = [];
    if (a) {
      totales.push(['Neto gravado', importeAR(c.netoGravado.toString())]);
      for (const iva of c.ivas) totales.push([`IVA ${Number(iva.alicuota).toLocaleString('es-AR')}%`, importeAR(iva.importe.toString())]);
      if (!c.noGravado.isZero()) totales.push(['No gravado', importeAR(c.noGravado.toString())]);
      if (!c.exento.isZero()) totales.push(['Exento', importeAR(c.exento.toString())]);
    }
    const contenido = await pdfVenta({
      empresa: { razonSocial: empresa.razonSocial, cuit: formatearCuit(empresa.cuit), condicionIva: ETIQUETAS_CONDICION_IVA[empresa.condicionIva], domicilio: empresa.domicilio },
      cliente: { razonSocial: t.razonSocial, documento, condicionIva: ETIQUETAS_CONDICION_IVA[t.condicionIva], domicilio: t.domicilio },
      titulo: titulos[c.tipo], letra, codigo: String(codigo).padStart(2, '0'), numero: numeroVenta(c.puntoVenta, c.numero), fecha: fechaAR(c.fecha), vencimiento: fechaAR(c.fechaVencimiento),
      servicio: c.concepto === 'PRODUCTOS' ? null : { desde: fechaAR(c.fechaServicioDesde!), hasta: fechaAR(c.fechaServicioHasta!), vencePago: fechaAR(c.fechaVencimientoPago!) },
      moneda: c.monedaCodigo === 'ARS' ? 'Pesos' : 'Dólares', cotizacion: c.monedaCodigo === 'ARS' ? null : importeAR(c.cotizacion.toString()),
      asociado: asoc ? `${asoc.letra} ${numeroVenta(asoc.puntoVenta, asoc.numero)}` : null,
      discriminaIva: a,
      renglones: c.renglones.map((r, i) => {
        const conIva = !a && letra === 'B';
        const factor = conIva && r.alicuota !== 'NO_GRAVADO' && r.alicuota !== 'EXENTO' ? 1 + Number(r.alicuota) / 100 : 1;
        return {
          descripcion: r.descripcion, cantidad: Number(r.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 4 }),
          precio: Number(r.precioUnitario.mul(factor).toDecimalPlaces(2)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
          alicuota: r.alicuota === 'NO_GRAVADO' ? 'No grav.' : r.alicuota === 'EXENTO' ? 'Exento' : `${Number(r.alicuota).toLocaleString('es-AR')}%`,
          importe: importeAR(a ? r.neto.toString() : conIva ? importesB[i] : r.neto.plus(r.iva).toString()),
        };
      }),
      totales, total: importeAR(c.total.toString()), cae: c.cae, caeVencimiento: fechaAR(c.caeVencimiento!),
      urlQr: urlQrArca({
        fecha: c.fecha.toISOString().slice(0, 10), cuit: normalizarCuit(empresa.cuit), ptoVta: c.puntoVenta, tipoCmp: codigo, nroCmp: c.numero, importe: c.total.toFixed(2),
        moneda: monedaArca(c.monedaCodigo as 'ARS' | 'USD'), ctz: c.cotizacion.toString(), tipoDocRec: docTipoArca(t.tipoDocumento), nroDocRec: t.tipoDocumento === 'OTRO' ? '0' : t.cuit, cae: c.cae,
      }),
      sinValidez: (config?.ambiente ?? 'SIMULADO') !== 'PRODUCCION',
    });
    return { nombre: `${titulos[c.tipo].toLowerCase().replace(/ /g, '-')}-${letra}-${numeroVenta(c.puntoVenta, c.numero)}.pdf`, contenido };
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.editable(tx, id);
      await tx.comprobanteVenta.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'ELIMINAR', datos: { numeroInterno: c.numeroInterno, total: c.total } });
      return { ok: true };
    });
  }
}
