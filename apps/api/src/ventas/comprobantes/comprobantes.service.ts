import { FceRegistroService } from '../fce/registro.service';
import { verificarDeEmpresa } from '../../comun/de-empresa';
import { vendedorActivo } from '../comisiones/vendedor-activo';
import { BajasService } from '../../bienes-uso/bajas.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ComprobanteVenta } from '@prisma/client';
import { calcularVenta, cbteTipo, JURISDICCIONES_CM, docTipoArca, ETIQUETAS_CONDICION_IVA, formatearCuit, letraVenta, monedaArca, normalizarCuit, urlQrArca, type AlicuotaVenta, type LetraVenta } from '@gestion/shared';
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
import { PercepcionesVentaService } from '../percepciones/percepciones.service';

export const AUTORIZADO_NO_SE_ANULA = 'Un comprobante autorizado no se anula: emita una nota de crédito';
export const EMISION_SIN_CONFIRMAR = 'El comprobante tiene una emisión sin confirmar: reintente para resolverla';
/** Una emisión se considera abandonada pasado este tiempo (más que el peor caso de llamadas a ARCA con sus timeouts). */
export const EN_CURSO_MS = 5 * 60000;
export const INCLUIR_VENTA = { renglones: { orderBy: { orden: 'asc' } }, ivas: true, tercero: true, percepcionesDetalle: { orderBy: [{ tipo: 'asc' }, { jurisdiccion: 'asc' }, { tramo: 'asc' }] } } satisfies Prisma.ComprobanteVentaInclude;

/** "0001-00000012" */
export const numeroVenta = (puntoVenta: number, numero: number | null) => `${String(puntoVenta).padStart(4, '0')}-${String(numero ?? 0).padStart(8, '0')}`;
export const emisionEnCurso = (c: Pick<ComprobanteVenta, 'emisionEnCurso'>) => !!c.emisionEnCurso && Date.now() - c.emisionEnCurso.getTime() < EN_CURSO_MS;

/** Opciones internas del alta: cuenta contable fija para los renglones y sin vendedor (intereses por mora, E27). */
export interface OpcionesComprobante { cuentaContableId?: string; sinVendedor?: boolean }

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
    private readonly bajas: BajasService,
    private readonly percepciones: PercepcionesVentaService,
    private readonly registroFce: FceRegistroService,
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
  async preparar(tx: TxEmpresa, d: DatosComprobanteVenta, id?: string, opciones: OpcionesComprobante = {}) {
    const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!tercero || !tercero.esCliente || !tercero.activo) throw new BadRequestException('Cliente inexistente o inactivo');
    const pv = await tx.puntoVenta.findUnique({ where: { id: d.puntoVentaId } });
    if (!pv) throw new BadRequestException('Punto de venta inexistente');
    if (!pv.electronico) throw new BadRequestException('El punto de venta no es electrónico');
    // E36: depósito y artículos de la empresa activa
    await verificarDeEmpresa(tx, [['deposito', d.depositoId], ...d.renglones.map((r) => ['articulo', r.articuloId] as ['articulo', string | null | undefined])]);
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
      if (asoc.fce !== !!d.fce) throw new BadRequestException('La nota tiene que ser de la misma clase que la factura: factura de crédito MiPyME o común');
      if (d.fce && d.anulacionFce) await this.registroFce.verificarAnulable(tx, asoc.id);
      letra = asoc.letra as LetraVenta;
    }
    // Venta de bienes de uso (spec E14 §5): el neto va al resultado por venta y la baja se registra al autorizar
    await this.bajas.validarVenta(tx, { id, tipo: d.tipo, fecha: d.fecha }, d.renglones);
    if (letra === 'A' && tercero.tipoDocumento !== 'CUIT') throw new BadRequestException('El cliente no tiene CUIT válido para una factura A');
    const calc = calcularVenta(d.renglones.map((r) => ({ cantidad: String(r.cantidad), precioUnitario: String(r.precioUnitario), alicuota: r.alicuota as AlicuotaVenta })), letra);
    const cot = d.monedaCodigo === 'ARS' ? new D(1) : d.cotizacion ? new D(d.cotizacion) : await cotizacion(tx, 'USD', d.fecha);
    // Percepciones practicadas (E39): el total las incluye
    const perc = await this.percepciones.calcular(tx, {
      tipo: d.tipo, letra, fecha: d.fecha, terceroId: d.terceroId, cotizacion: cot, netoGravado: calc.netoGravado, noGravado: calc.noGravado, exento: calc.exento,
      ivas: calc.ivas.map((x) => ({ alicuota: String(x.alicuota), base: x.base })), comprobanteAsociadoId: d.tipo === 'FACTURA' ? null : d.comprobanteAsociadoId ?? null, excluirId: id,
    });
    const total = new D(calc.total).plus(perc.total).toFixed(2);
    if (d.tipo === 'NOTA_CREDITO') {
      const disponible = await this.saldoDisponibleNc(tx, d.comprobanteAsociadoId!, id);
      if (new D(total).gt(disponible)) throw new BadRequestException(await this.mensajeTopeNc(tx, d.comprobanteAsociadoId!, id));
    }
    const origenes = await this.origenes.resolver(tx, { tipo: d.tipo, terceroId: d.terceroId, renglones: d.renglones });
    const articulos = await tx.articulo.findMany({ where: { id: { in: [...d.renglones.map((r) => r.articuloId), ...origenes.map((o) => o.articuloId)].filter((x): x is string => !!x) } } });
    const ventas = await this.cuentas.cuenta(tx, 'VENTAS');
    const resultadoBienes = d.renglones.some((r) => r.bienUsoId) ? await this.cuentas.cuenta(tx, 'RESULTADO_VENTA_BIENES_USO') : null;
    const renglones = d.renglones.map((r, i) => {
      if (r.articuloId && !articulos.some((a) => a.id === r.articuloId)) throw new BadRequestException('Artículo inexistente');
      const o = origenes[i];
      return {
        empresaId: this.tenant.empresaId, orden: i, articuloId: o.articuloId, descripcion: o.descripcion, remitoRenglonId: o.remitoRenglonId, pedidoRenglonId: o.pedidoRenglonId, cantidad: r.cantidad, precioUnitario: r.precioUnitario, alicuota: String(r.alicuota),
        neto: calc.renglones[i].neto, iva: calc.renglones[i].iva, bienUsoId: r.bienUsoId ?? null,
        cuentaContableId: opciones.cuentaContableId ?? (r.bienUsoId ? resultadoBienes! : (articulos.find((a) => a.id === o.articuloId)?.cuentaVentaId ?? ventas)),
      };
    });
    const vendedor = opciones.sinVendedor ? { vendedorId: null, comisionPct: null } : await this.vendedor(tx, d, tercero.vendedorId, origenes, id);
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
        // E50: en la FCE el vencimiento del pago es el del comprobante (factura); las notas no lo llevan
        fechaVencimientoPago: d.fce ? (d.tipo === 'FACTURA' ? d.fechaVencimiento : null) : d.concepto === 'PRODUCTOS' ? null : d.fechaVencimientoPago,
        fce: !!d.fce, transferenciaFce: d.fce && d.tipo === 'FACTURA' ? (d.transferenciaFce ?? (await tx.configArca.findFirst())?.transferenciaFce ?? 'SCA') : null, anulacionFce: d.fce && d.tipo !== 'FACTURA' ? !!d.anulacionFce : null,
        monedaCodigo: d.monedaCodigo, cotizacion: cot, netoGravado: calc.netoGravado, noGravado: calc.noGravado, exento: calc.exento, iva: calc.iva, total, percepciones: perc.total,
        totalPesos: new D(total).mul(cot).toDecimalPlaces(2), comprobanteAsociadoId: d.tipo === 'FACTURA' ? null : d.comprobanteAsociadoId, aplicarAAsociado: d.aplicarAAsociado,
        vendedorId: vendedor.vendedorId, comisionPct: vendedor.comisionPct,
      },
      renglones,
      ivas: calc.ivas.map((x) => ({ empresaId: this.tenant.empresaId, alicuota: x.alicuota, base: x.base, importe: x.importe })),
      percepciones: perc.renglones.map((r) => ({ empresaId: this.tenant.empresaId, ...r })),
    };
  }

  /**
   * Vendedor y porcentaje del comprobante (E24 §4). NC y ND heredan los de su asociado. Una factura usa el indicado
   * (null = sin vendedor); si no se indicó, el del pedido de origen y si no, el habitual del cliente. El porcentaje
   * se vuelve a copiar al autorizar.
   */
  private async vendedor(tx: TxEmpresa, d: DatosComprobanteVenta, delCliente: string | null, origenes: { pedidoRenglonId?: string | null; remitoRenglonId?: string | null }[], editandoId?: string) {
    if (d.tipo !== 'FACTURA') {
      const asoc = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id: d.comprobanteAsociadoId! } });
      return { vendedorId: asoc.vendedorId, comisionPct: asoc.comisionPct };
    }
    let id: string | null | undefined = d.vendedorId;
    if (id === undefined) {
      const pedidoRenglonIds = origenes.map((o) => o.pedidoRenglonId).filter((x): x is string => !!x);
      const remitoRenglonIds = origenes.map((o) => o.remitoRenglonId).filter((x): x is string => !!x);
      if (remitoRenglonIds.length)
        pedidoRenglonIds.push(...(await tx.remitoRenglon.findMany({ where: { id: { in: remitoRenglonIds } }, select: { pedidoRenglonId: true } })).flatMap((r) => (r.pedidoRenglonId ? [r.pedidoRenglonId] : [])));
      const pr = pedidoRenglonIds.length ? await tx.pedidoVentaRenglon.findFirst({ where: { id: { in: pedidoRenglonIds } }, select: { pedidoId: true } }) : null;
      const pedido = pr ? await tx.pedidoVenta.findUnique({ where: { id: pr.pedidoId }, select: { vendedorId: true } }) : null;
      id = pedido ? pedido.vendedorId : delCliente;
      // El propuesto pudo quedar inactivo: se factura sin vendedor en vez de rechazar
      if (id && !(await tx.vendedor.findFirst({ where: { id, activo: true } }))) id = null;
    } else if (id) {
      // Al modificar un borrador, el vendedor que ya tenía no se revalida (pudo quedar inactivo)
      const previo = editandoId ? await tx.comprobanteVenta.findUnique({ where: { id: editandoId }, select: { vendedorId: true } }) : null;
      if (previo?.vendedorId !== id) await vendedorActivo(tx, id);
    }
    if (!id) return { vendedorId: null, comisionPct: null };
    const v = await tx.vendedor.findUniqueOrThrow({ where: { id } });
    return { vendedorId: v.id, comisionPct: v.porcentaje };
  }

  crear(d: DatosComprobanteVenta) {
    return this.tenant.transaccion((tx) => this.crearEnTx(tx, d));
  }

  /** Alta dentro de una transacción; las opciones las usan los procesos internos (p. ej. intereses por mora). */
  async crearEnTx(tx: TxEmpresa, d: DatosComprobanteVenta, opciones: OpcionesComprobante = {}) {
    {
      const p = await this.preparar(tx, d, undefined, opciones);
      const numeroInterno = await this.numeracion.siguiente(tx, 'VENTA-INTERNO', 0);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const c = await tx.comprobanteVenta.create({
        data: { ...p.datos, numeroInterno, creadoPor: usuario, renglones: { create: p.renglones }, ivas: { create: p.ivas }, percepcionesDetalle: { create: p.percepciones } } as Prisma.ComprobanteVentaUncheckedCreateInput,
      });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: c.id, accion: 'CREAR', datos: { numeroInterno, tipo: c.tipo, letra: c.letra, total: c.total } });
      return { ...(await this.obtener(c.id, tx)), advertencias: p.advertencias };
    }
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
      if (await tx.liquidacionInteresesRenglon.findFirst({ where: { notaDebitoId: id } })) throw new BadRequestException('Las notas de débito de intereses no se modifican: elimínela y vuelva a liquidar');
      if (c.version !== version) throw new ConflictException(MODIFICADO);
      const p = await this.preparar(tx, d, id);
      await tx.comprobanteVentaRenglon.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVentaIva.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVentaPercepcion.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVenta.update({
        where: { id },
        data: { ...p.datos, version: { increment: 1 }, renglones: { create: p.renglones }, ivas: { create: p.ivas }, percepcionesDetalle: { create: p.percepciones } } as Prisma.ComprobanteVentaUncheckedUpdateInput,
      });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'MODIFICAR', datos: { total: p.datos.total } });
      return { ...(await this.obtener(id, tx)), advertencias: p.advertencias };
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
    const codigo = cbteTipo(c.tipo, letra, c.fce);
    const a = letra === 'A';
    const t = c.tercero;
    const documento = t.tipoDocumento === 'CUIT' ? `CUIT ${formatearCuit(t.cuit)}` : t.tipoDocumento === 'DNI' ? `DNI ${t.cuit}` : 'Sin identificar';
    const TITULOS_FCE = { FACTURA: 'FACTURA DE CRÉDITO ELECTRÓNICA MiPyMEs (FCE)', NOTA_DEBITO: 'NOTA DE DÉBITO ELECTRÓNICA MiPyMEs (FCE)', NOTA_CREDITO: 'NOTA DE CRÉDITO ELECTRÓNICA MiPyMEs (FCE)' } as const;
    const titulos = { FACTURA: 'FACTURA', NOTA_DEBITO: 'NOTA DE DÉBITO', NOTA_CREDITO: 'NOTA DE CRÉDITO' } as const;
    // E50: factura de crédito electrónica MiPyME
    const cuentaFce = c.fce && c.tipo === 'FACTURA' && config?.cuentaBancariaFceId ? await db.cuentaBancaria.findUnique({ where: { id: config.cuentaBancariaFceId } }) : null;
    const fce = c.fce
      ? { cbu: cuentaFce?.cbu ?? null, transferencia: c.tipo === 'FACTURA' ? (c.transferenciaFce ?? config?.transferenciaFce ?? 'SCA') : null, anulacion: c.tipo === 'FACTURA' ? null : !!c.anulacionFce }
      : null;
    const importesB = importesConIva(c.renglones.map((r) => ({ neto: r.neto.toString(), iva: r.iva.toString(), alicuota: r.alicuota })), c.ivas.map((x) => ({ alicuota: x.alicuota.toString(), importe: x.importe.toString() })));
    const totales: [string, string][] = [];
    if (a) {
      totales.push(['Neto gravado', importeAR(c.netoGravado.toString())]);
      for (const iva of c.ivas) totales.push([`IVA ${Number(iva.alicuota).toLocaleString('es-AR')}%`, importeAR(iva.importe.toString())]);
      if (!c.noGravado.isZero()) totales.push(['No gravado', importeAR(c.noGravado.toString())]);
      if (!c.exento.isZero()) totales.push(['Exento', importeAR(c.exento.toString())]);
    }
    // Percepciones practicadas (E39): en toda letra, entre el IVA y el total
    for (const p of c.percepcionesDetalle) {
      const alic = `${Number(p.alicuota).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} %`;
      totales.push([p.tipo === 'IVA' ? `Percepción IVA ${alic}` : `Percepción IIBB ${JURISDICCIONES_CM[p.jurisdiccion!] ?? p.jurisdiccion} ${alic}`, importeAR(p.importe.toString())]);
    }
    const contenido = await pdfVenta({
      empresa: { razonSocial: empresa.razonSocial, cuit: formatearCuit(empresa.cuit), condicionIva: ETIQUETAS_CONDICION_IVA[empresa.condicionIva], domicilio: empresa.domicilio },
      cliente: { razonSocial: t.razonSocial, documento, condicionIva: ETIQUETAS_CONDICION_IVA[t.condicionIva], domicilio: t.domicilio },
      titulo: c.fce ? TITULOS_FCE[c.tipo] : titulos[c.tipo], fce, letra, codigo: String(codigo).padStart(2, '0'), numero: numeroVenta(c.puntoVenta, c.numero), fecha: fechaAR(c.fecha), vencimiento: fechaAR(c.fechaVencimiento),
      servicio: c.concepto === 'PRODUCTOS' ? null : { desde: fechaAR(c.fechaServicioDesde!), hasta: fechaAR(c.fechaServicioHasta!), vencePago: fechaAR(c.fechaVencimientoPago ?? c.fechaVencimiento) },
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
