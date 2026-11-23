import { FceRegistroService } from '../fce/registro.service';
import { Obligacion, ObligacionFceService } from '../fce/obligacion.service';
import { verificarMesesAbiertos } from '../../impuestos/posicion-iva/bloqueo';
import { BajasService } from '../../bienes-uso/bajas.service';
import { BadGatewayException, BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { AmbienteArca, ComprobanteVenta, PeriodoContable, Tercero } from '@prisma/client';
import { alicuotaArca, cbteTipo, condicionIvaReceptorArca, docTipoArca, monedaArca, nombreJurisdiccion, normalizarCuit, type AlicuotaIva, type LetraVenta } from '@gestion/shared';
import { ConfigArcaService } from '../../arca/config-arca.service';
import { ClienteArca, DatosCae, ErrorConexionArca, ErrorServicioArca, ResultadoCae } from '../../arca/cliente-arca';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear, fechaAR } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { VentasStock } from '../../stock/ventas-stock';
import { OrigenesVenta } from '../comprobantes/origenes';
import { periodoAbierto } from '../../contabilidad/periodos/control';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { AUTORIZADO_NO_SE_ANULA, ComprobantesVentaService, emisionEnCurso, numeroVenta } from '../comprobantes/comprobantes.service';
import { asientoVenta } from './asiento-venta';
import { PercepcionesVentaService } from '../percepciones/percepciones.service';

const OTRA_EN_CURSO = 'Hay otra emisión en curso para este punto de venta, reintente en unos segundos';
const SIN_CONEXION = 'No se pudo conectar con ARCA: el comprobante quedó pendiente de CAE';
const TIPO_TEXTO = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito' } as const;
const CONCEPTO = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 } as const;
const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const fechaDe = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Gancho que corre al autorizar, dentro de la transacción del resultado (la aplicación automática de la NC). */
export type AlAutorizar = (tx: TxEmpresa, c: ComprobanteVenta) => Promise<void>;

@Injectable()
export class EmisionService {
  private alAutorizar: AlAutorizar | null = null;

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly arca: ConfigArcaService,
    private readonly comprobantes: ComprobantesVentaService,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly stock: VentasStock,
    private readonly origenes: OrigenesVenta,
    private readonly bajas: BajasService,
    private readonly percepciones: PercepcionesVentaService,
    private readonly obligacionFce: ObligacionFceService,
    private readonly registroFce: FceRegistroService,
  ) {}

  registrarAlAutorizar(f: AlAutorizar) {
    this.alAutorizar = f;
  }

  /**
   * Pide el CAE en tres pasos: reserva (transacción), ARCA (fuera de transacción) y resultado (transacción).
   * La cuenta corriente y el asiento se generan recién con la aprobación.
   */
  async emitir(id: string) {
    const cliente = await this.arca.cliente();
    const { ambiente } = await this.arca.obtener();
    // E50: la obligación de FCE se consulta fuera de la transacción (llama a ARCA); la regla se aplica con el total definitivo
    const previo = await this.tenant.db.comprobanteVenta.findUnique({ where: { id } });
    const obligacion = previo && previo.tipo === 'FACTURA' && previo.estado !== 'AUTORIZADO' ? await this.obligacionFce.obligacion(previo.terceroId, previo.fecha.toISOString().slice(0, 10)) : null;
    const r = await this.reservar(id, ambiente, obligacion);
    let resultado: ResultadoCae;
    let numero: number;
    try {
      ({ resultado, numero } = await this.pedir(cliente, r.c, r.datos));
    } catch (e) {
      // Solo si este intento sigue siendo el dueño de la emisión y nadie la autorizó mientras tanto
      await this.tenant.db.comprobanteVenta.updateMany({
        where: { id, emisionEnCurso: r.propietario, estado: { not: 'AUTORIZADO' } },
        data: { emisionEnCurso: null, ...(e instanceof ErrorConexionArca || e instanceof ErrorServicioArca ? { ultimoError: e.message } : {}), ...(e instanceof ErrorConexionArca ? { estado: 'PENDIENTE_CAE' } : {}) },
      });
      if (e instanceof ErrorServicioArca) throw new BadRequestException(e.message);
      if (e instanceof ErrorConexionArca) {
        await this.auditoria.registrar(this.tenant.db, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'MODIFICAR', datos: { emision: 'sin conexión', error: e.message } });
        throw new BadGatewayException(SIN_CONEXION);
      }
      throw e;
    }
    if (resultado.resultado === 'R') return this.registrarRechazo(id, r.propietario, resultado.errores);
    try {
      return await this.autorizar(id, numero, resultado);
    } catch (e) {
      // ARCA autorizó pero no se pudo registrar: queda pendiente con el número reservado y el reintento lo recupera
      await this.tenant.db.comprobanteVenta.updateMany({
        where: { id, estado: { not: 'AUTORIZADO' } },
        data: { emisionEnCurso: null, numeroReservado: numero, ultimoError: `ARCA autorizó el número ${numero} pero no se pudo registrar: ${(e as Error).message}` },
      });
      throw e;
    }
  }

  /** Resultado R de ARCA: el comprobante queda rechazado y sin número reservado. */
  async registrarRechazo(id: string, propietario: Date, errores: string[]): Promise<never> {
    const texto = errores.join('; ');
    await this.tenant.transaccion(async (tx) => {
      await bloquear(tx, 'ComprobanteVenta', this.tenant.empresaId, [id]);
      const c = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id } });
      // Un rechazo tardío (por ejemplo, 10016 porque otro intento ya autorizó ese número) no pisa nada
      if (c.estado === 'AUTORIZADO' || c.emisionEnCurso?.getTime() !== propietario.getTime())
        throw new ConflictException('El comprobante fue procesado por otro intento de emisión: actualice la pantalla');
      await tx.comprobanteVenta.update({ where: { id }, data: { estado: 'RECHAZADO', ultimoError: texto, emisionEnCurso: null, numeroReservado: null } });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'MODIFICAR', datos: { emision: 'rechazada', errores } });
    });
    throw new BadRequestException(`ARCA rechazó el comprobante: ${texto}`);
  }

  /** Paso 1: bloquea el comprobante y el talonario ARCA, valida y marca la emisión en curso. */
  private reservar(id: string, ambiente: AmbienteArca, obligacion: Obligacion | null = null) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      await this.comprobantes.obtener(id, tx);
      await bloquear(tx, 'ComprobanteVenta', empresaId, [id]);
      const leido = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id }, include: { tercero: true } });
      if (leido.estado === 'AUTORIZADO') throw new BadRequestException('El comprobante ya está autorizado');
      await verificarMesesAbiertos(tx, empresaId, leido.fecha);
      // E39: las percepciones se recalculan al emitir con el padrón vigente (salvo un reintento con número ya reservado: va lo mismo a ARCA)
      // Dos NC de la misma factura se serializan (aunque sean de otro punto de venta): la reversión ve a la otra (revisión E39)
      if (leido.tipo === 'NOTA_CREDITO' && leido.comprobanteAsociadoId) await bloquear(tx, 'ComprobanteVenta', empresaId, [leido.comprobanteAsociadoId]);
      const c = leido.numeroReservado === null ? await this.recalcularPercepciones(tx, leido) : leido;
      const tipoArca = cbteTipo(c.tipo, c.letra as LetraVenta, c.fce);
      if (c.fce) await this.validarFce(tx, c);
      if (obligacion && c.tipo === 'FACTURA') {
        const error = ObligacionFceService.errorEmision(obligacion, c.fce, c.totalPesos);
        if (error) throw new BadRequestException(error);
      }
      const clave = `ARCA-${ambiente}-${tipoArca}`;
      await tx.$executeRaw`INSERT INTO "Talonario" ("id", "empresaId", "tipoComprobante", "puntoVenta", "ultimoNumero")
        VALUES (gen_random_uuid(), ${empresaId}::uuid, ${clave}, ${c.puntoVenta}, 0) ON CONFLICT ("empresaId", "tipoComprobante", "puntoVenta") DO NOTHING`;
      const talonario = await tx.talonario.findFirstOrThrow({ where: { tipoComprobante: clave, puntoVenta: c.puntoVenta } });
      await bloquear(tx, 'Talonario', empresaId, [talonario.id]);
      const otras = await tx.comprobanteVenta.findMany({ where: { puntoVenta: c.puntoVenta, tipo: c.tipo, letra: c.letra, fce: c.fce, emisionEnCurso: { not: null } } });
      if (c.numeroReservado !== null && c.ambiente !== ambiente) throw new BadRequestException(`El comprobante tiene una emisión sin confirmar en ${c.ambiente}: vuelva a ese ambiente para resolverla`);
      if (otras.some(emisionEnCurso)) throw new ConflictException(OTRA_EN_CURSO);
      if (c.tipo === 'NOTA_CREDITO') {
        const disponible = await this.comprobantes.saldoDisponibleNc(tx, c.comprobanteAsociadoId!, c.id);
        if (c.total.gt(disponible)) throw new BadRequestException(await this.comprobantes.mensajeTopeNc(tx, c.comprobanteAsociadoId!, c.id));
      }
      await periodoAbierto(tx, empresaId, c.fecha);
      // Stock: lo que impediría registrar la venta se controla antes de pedir el CAE
      const renglones = await tx.comprobanteVentaRenglon.findMany({ where: { comprobanteId: id } });
      await this.origenes.resolver(tx, { tipo: c.tipo, terceroId: c.terceroId, renglones });
      await this.bajas.validarVenta(tx, { id, tipo: c.tipo, fecha: c.fecha }, renglones);
      await this.stock.prevalidar(tx, { id, tipo: c.tipo, depositoId: c.depositoId, devuelveMercaderia: c.devuelveMercaderia, comprobanteAsociadoId: c.comprobanteAsociadoId, renglones: renglones.filter((x) => !x.remitoRenglonId) });
      const datos = await this.datosCae(tx, c, tipoArca);
      const propietario = new Date();
      await tx.comprobanteVenta.update({ where: { id }, data: { emisionEnCurso: propietario, intentos: { increment: 1 }, ambiente } });
      return { c, datos, propietario };
    });
  }

  private async recalcularPercepciones(tx: TxEmpresa, c: ComprobanteVenta & { tercero: Tercero }): Promise<ComprobanteVenta & { tercero: Tercero }> {
    const ivas = await tx.comprobanteVentaIva.findMany({ where: { comprobanteId: c.id } });
    const p = await this.percepciones.calcular(tx, {
      tipo: c.tipo, letra: c.letra, fecha: c.fecha, terceroId: c.terceroId, cotizacion: c.cotizacion, netoGravado: c.netoGravado.toString(), noGravado: c.noGravado.toString(),
      exento: c.exento.toString(), ivas: ivas.map((x) => ({ alicuota: x.alicuota.toString(), base: x.base.toString() })), comprobanteAsociadoId: c.comprobanteAsociadoId, excluirId: c.id,
    });
    await tx.comprobanteVentaPercepcion.deleteMany({ where: { comprobanteId: c.id } });
    if (p.renglones.length) await tx.comprobanteVentaPercepcion.createMany({ data: p.renglones.map((r) => ({ empresaId: this.tenant.empresaId, comprobanteId: c.id, ...r })) });
    const total = c.total.minus(c.percepciones).plus(p.total);
    const actualizado = await tx.comprobanteVenta.update({ where: { id: c.id }, data: { percepciones: p.total, total, totalPesos: total.mul(c.cotizacion).toDecimalPlaces(2) } });
    return { ...actualizado, tercero: c.tercero };
  }

  private async datosCae(tx: TxEmpresa, c: ComprobanteVenta & { tercero: Tercero }, tipoArca: number): Promise<Omit<DatosCae, 'numero'>> {
    const ivas = await tx.comprobanteVentaIva.findMany({ where: { comprobanteId: c.id } });
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const letraC = c.letra === 'C';
    const asociados = [];
    if (c.comprobanteAsociadoId) {
      const a = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id: c.comprobanteAsociadoId } });
      asociados.push({ tipo: cbteTipo(a.tipo, a.letra as LetraVenta, a.fce), ptoVta: a.puntoVenta, nro: a.numero!, cuit: normalizarCuit(empresa.cuit), fecha: yyyymmdd(a.fecha) });
    }
    const servicio = c.concepto !== 'PRODUCTOS';
    return {
      ptoVta: c.puntoVenta, cbteTipo: tipoArca, concepto: CONCEPTO[c.concepto], docTipo: docTipoArca(c.tercero.tipoDocumento),
      docNro: c.tercero.tipoDocumento === 'OTRO' ? '0' : c.tercero.cuit, condicionIvaReceptor: condicionIvaReceptorArca(c.tercero.condicionIva), fecha: yyyymmdd(c.fecha),
      impTotal: c.total.toFixed(2), impTotConc: letraC ? '0.00' : c.noGravado.toFixed(2), impNeto: letraC ? c.total.toFixed(2) : c.netoGravado.toFixed(2),
      impOpEx: letraC ? '0.00' : c.exento.toFixed(2), impIva: letraC ? '0.00' : c.iva.toFixed(2), monId: monedaArca(c.monedaCodigo as 'ARS' | 'USD'), monCotiz: c.cotizacion.toString(),
      ...(servicio ? { fchServDesde: yyyymmdd(c.fechaServicioDesde!), fchServHasta: yyyymmdd(c.fechaServicioHasta!) } : {}),
      ...(c.fechaVencimientoPago && (servicio || (c.fce && c.tipo === 'FACTURA')) ? { fchVtoPago: yyyymmdd(c.fechaVencimientoPago) } : {}),
      ...(c.fce ? { opcionales: await this.opcionalesFce(tx, c) } : {}),
      iva: letraC ? [] : ivas.map((x) => ({ id: alicuotaArca(Number(x.alicuota) as AlicuotaIva), baseImp: x.base.toFixed(2), importe: x.importe.toFixed(2) })),
      asociados,
      // Percepciones (E39): Id 7 IIBB, 6 IVA (tabla FEParamGetTiposTributos)
      tributos: (await tx.comprobanteVentaPercepcion.findMany({ where: { comprobanteId: c.id }, orderBy: [{ tipo: 'asc' }, { jurisdiccion: 'asc' }, { tramo: 'asc' }] })).map((p) => ({
        id: p.tipo === 'IVA' ? 6 : 7, desc: p.tipo === 'IVA' ? `Percepción IVA RG ${p.regimenCodigo ?? ''}`.trim() : `Percepción IIBB ${nombreJurisdiccion(p.jurisdiccion!)}`,
        baseImp: p.base.toFixed(2), alic: p.alicuota.toFixed(2), importe: p.importe.toFixed(2),
      })),
    };
  }

  /** E50: la empresa tiene que ser MiPyME y tener la cuenta con CBU de la FCE. */
  private async validarFce(tx: TxEmpresa, c: ComprobanteVenta) {
    const conf = await tx.configArca.findFirst();
    if (!conf?.mipyme) throw new BadRequestException('La empresa no está marcada como MiPyME: no puede emitir factura de crédito');
    const cuenta = conf.cuentaBancariaFceId ? await tx.cuentaBancaria.findUnique({ where: { id: conf.cuentaBancariaFceId } }) : null;
    if (c.tipo === 'FACTURA' && !cuenta?.cbu) throw new BadRequestException('Configure la cuenta bancaria (CBU) para la factura de crédito');
    if (c.tipo !== 'FACTURA' && c.anulacionFce && c.comprobanteAsociadoId) await this.registroFce.verificarAnulable(tx, c.comprobanteAsociadoId);
    if (c.tipo === 'FACTURA' && c.fechaVencimientoPago && c.fechaVencimientoPago < c.fecha) throw new BadRequestException('La fecha de vencimiento del pago no puede ser anterior a la fecha del comprobante');
  }

  /** E50: opcionales de la FCE (2101 CBU y 27 transferencia en la factura; 22 anulación en las notas). */
  private async opcionalesFce(tx: TxEmpresa, c: ComprobanteVenta): Promise<{ id: string; valor: string }[]> {
    if (c.tipo !== 'FACTURA') return [{ id: '22', valor: c.anulacionFce ? 'S' : 'N' }];
    const conf = await tx.configArca.findFirstOrThrow();
    const cuenta = await tx.cuentaBancaria.findUniqueOrThrow({ where: { id: conf.cuentaBancariaFceId! } });
    return [{ id: '2101', valor: cuenta.cbu!.replace(/\D/g, '') }, { id: '27', valor: c.transferenciaFce ?? conf.transferenciaFce }];
  }

  /** Paso 2, fuera de transacción: recuperación de un intento previo sin respuesta y solicitud del CAE. */
  private async pedir(cliente: ClienteArca, c: ComprobanteVenta, d: Omit<DatosCae, 'numero'>): Promise<{ resultado: ResultadoCae; numero: number }> {
    const ultimo = await cliente.ultimoAutorizado(d.ptoVta, d.cbteTipo);
    if (c.numeroReservado !== null && c.numeroReservado <= ultimo) {
      const previo = await cliente.consultar(d.ptoVta, d.cbteTipo, c.numeroReservado);
      const coincide = previo && previo.docNro === d.docNro && previo.fecha.replace(/-/g, '') === d.fecha && new D(previo.impTotal).eq(d.impTotal) && previo.monId === d.monId;
      // Un número que ya tiene otro comprobante local no es de este
      const ocupado = await this.tenant.db.comprobanteVenta.findFirst({ where: { id: { not: c.id }, ambiente: c.ambiente, puntoVenta: c.puntoVenta, tipo: c.tipo, letra: c.letra, fce: c.fce, numero: c.numeroReservado } });
      if (previo && coincide && !ocupado) return { resultado: { resultado: 'A', cae: previo.cae, caeVencimiento: previo.caeVencimiento, observaciones: ['Recuperado de un intento anterior'] }, numero: c.numeroReservado };
      await this.auditoria.registrar(this.tenant.db, { entidad: 'ComprobanteVenta', entidadId: c.id, accion: 'MODIFICAR', datos: { recuperacion: 'el número reservado no corresponde a este comprobante', numeroReservado: c.numeroReservado } });
    }
    const numero = ultimo + 1;
    await this.tenant.db.comprobanteVenta.update({ where: { id: c.id }, data: { numeroReservado: numero } });
    return { resultado: await cliente.solicitarCae({ ...d, numero }), numero };
  }

  /** Paso 3: número y CAE; cuenta corriente y asiento. Si el mes se cerró mientras tanto, el asiento va al primer día abierto siguiente. */
  private autorizar(id: string, numero: number, r: Extract<ResultadoCae, { resultado: 'A' }>) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      await bloquear(tx, 'ComprobanteVenta', empresaId, [id]);
      const advertencias: string[] = [];
      const actual = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id } });
      if (actual.estado === 'AUTORIZADO') return { ...(await this.comprobantes.obtener(id, tx)), advertencias: ['El comprobante ya había sido autorizado por otro intento'] };
      // El porcentaje de comisión de una factura es el del vendedor al emitir (E24 §4); NC y ND conservan el heredado
      const comisionPct = actual.vendedorId && !actual.comprobanteAsociadoId ? (await tx.vendedor.findUnique({ where: { id: actual.vendedorId } }))?.porcentaje ?? actual.comisionPct : actual.comisionPct;
      const c = await tx.comprobanteVenta.update({
        where: { id },
        data: {
          estado: 'AUTORIZADO', comisionPct, numero, cae: r.cae, caeVencimiento: fechaDe(r.caeVencimiento), emisionEnCurso: null, numeroReservado: null,
          ultimoError: r.observaciones.length ? `Observaciones de ARCA: ${r.observaciones.join('; ')}` : null,
        },
        include: { tercero: true, renglones: true, percepcionesDetalle: true },
      });
      await tx.movimientoCuentaCorriente.create({
        data: {
          empresaId, terceroId: c.terceroId, origenTipo: 'VENTA', origenId: c.id, fecha: c.fecha, fechaVencimiento: c.fechaVencimiento, monedaCodigo: c.monedaCodigo,
          ...(c.tipo === 'NOTA_CREDITO'
            ? { importe: c.total.neg(), importePesos: c.totalPesos.neg(), saldo: c.total.neg(), saldoPesos: c.totalPesos.neg() }
            : { importe: c.total, importePesos: c.totalPesos, saldo: c.total, saldoPesos: c.totalPesos }),
        },
      });
      const fecha = await this.fechaAsiento(tx, c.fecha, advertencias);
      advertencias.push(...(await this.origenes.registrar(tx, c.renglones)));
      await this.stock.bloquearArticulos(tx, c.renglones.filter((x) => !x.remitoRenglonId));
      const renglones = asientoVenta(
        { tipo: c.tipo, total: c.total.toString(), iva: c.iva.toString(), cotizacion: c.cotizacion.toString(), renglones: c.renglones.map((x) => ({ cuentaContableId: x.cuentaContableId, neto: x.neto.toString() })),
          percepciones: await Promise.all(c.percepcionesDetalle.map(async (p) => ({ cuentaContableId: await this.cuentas.cuenta(tx, p.tipo === 'IVA' ? 'PERCEPCION_IVA_PRACTICADA' : 'PERCEPCION_IIBB_PRACTICADA'), importe: p.importe.toString() }))) },
        { deudores: await this.cuentas.cuenta(tx, 'DEUDORES_POR_VENTAS'), ivaDebito: await this.cuentas.cuenta(tx, 'IVA_DEBITO_FISCAL') },
      );
      const asiento = await this.asientos.generar(tx, {
        fecha, descripcion: `${TIPO_TEXTO[c.tipo]} ${c.letra} ${numeroVenta(c.puntoVenta, numero)} - ${c.tercero.razonSocial}`, origenTipo: 'VENTA', origenId: c.id, renglones,
      });
      const final = await tx.comprobanteVenta.update({ where: { id }, data: { asientoId: asiento.id } });
      await this.bajas.alAutorizarVenta(tx, fecha, c.fecha, c.renglones);
      advertencias.push(...(await this.stock.alEmitir(tx, {
        id, tipo: c.tipo, depositoId: c.depositoId, devuelveMercaderia: c.devuelveMercaderia, comprobanteAsociadoId: c.comprobanteAsociadoId,
        renglones: [...c.renglones].filter((x) => !x.remitoRenglonId).sort((a, b) => a.orden - b.orden).map((x) => ({ id: x.id, articuloId: x.articuloId, cantidad: x.cantidad })),
      }, fecha, `${TIPO_TEXTO[c.tipo]} ${c.letra} ${numeroVenta(c.puntoVenta, numero)} - ${c.tercero.razonSocial}`)));
      if (this.alAutorizar) await this.alAutorizar(tx, final);
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'MODIFICAR', datos: { emision: 'autorizada', numero, cae: r.cae, advertencias } });
      return { ...(await this.comprobantes.obtener(id, tx)), advertencias };
    });
  }

  private async fechaAsiento(tx: TxEmpresa, fecha: Date, advertencias: string[]): Promise<Date> {
    const periodo = await tx.periodoContable.findFirst({ where: { desde: { lte: fecha }, hasta: { gte: fecha } } });
    if (!periodo || periodo.estado === 'ABIERTO') return fecha;
    const siguiente: PeriodoContable | null = await tx.periodoContable.findFirst({ where: { estado: 'ABIERTO', desde: { gt: fecha } }, orderBy: { desde: 'asc' } });
    if (!siguiente) return fecha; // generar informa el error de período
    advertencias.push(`El período de la fecha ${fechaAR(fecha)} se cerró durante la emisión: el asiento se registró el ${fechaAR(siguiente.desde)}`);
    return siguiente.desde;
  }
}

export { AUTORIZADO_NO_SE_ANULA };
