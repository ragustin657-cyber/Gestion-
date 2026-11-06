import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { bloquear, MODIFICADO } from '../../compras/comun';
import { ConceptoCuenta } from '../../compras/config/conceptos';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../../tesoreria/sucursales/alcance.service';
import { CarteraService, noDisponible } from '../../tesoreria/operaciones/cartera.service';
import { SALDO_INSUFICIENTE, saldoCaja } from '../../tesoreria/operaciones/tesoreria-comun';
import { formatoImporte, OrdenesPagoService } from './ordenes-pago.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface MedioPago {
  tipo: 'TRANSFERENCIA' | 'CHEQUE' | 'EFECTIVO' | 'CHEQUE_TERCERO';
  /** Para CHEQUE_TERCERO se toman del cheque. */
  monedaCodigo?: 'ARS' | 'USD';
  importe?: number;
  chequeId?: string | null;
  cuentaBancariaId?: string | null;
  cajaId?: string | null;
  chequeraId?: string | null;
  chequeNumero?: string | null;
  chequeFechaPago?: Date | null;
  referencia?: string | null;
}

const MONEDA_DISTINTA = 'La moneda del medio de pago no coincide con la de la cuenta';

/** Ejecuta el pago de una OP aprobada: medios, cheques, tesorería, aplicaciones, certificados y asiento. */
@Injectable()
export class PagoService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly ordenes: OrdenesPagoService,
    private readonly asientos: AsientosService,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
    private readonly alcance: AlcanceSucursalService,
    private readonly cartera: CarteraService,
  ) {}

  pagar(id: string, version: number, fechaPago: Date, mediosPedidos: MedioPago[]) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      // Cheques de terceros: importe y moneda salen del cheque, que debe estar en cartera en una caja del usuario
      const chequeIds = mediosPedidos.filter((m) => m.tipo === 'CHEQUE_TERCERO').map((m) => m.chequeId!);
      if (new Set(chequeIds).size !== chequeIds.length) throw new BadRequestException('Hay cheques de terceros repetidos');
      const medios: (MedioPago & { monedaCodigo: 'ARS' | 'USD'; importe: number })[] = [];
      for (const m of mediosPedidos) {
        if (m.tipo !== 'CHEQUE_TERCERO') {
          medios.push(m as MedioPago & { monedaCodigo: 'ARS' | 'USD'; importe: number });
          continue;
        }
        const ch = await tx.chequeTercero.findUnique({ where: { id: m.chequeId! } });
        if (!ch) throw new NotFoundException('Cheque no encontrado');
        if (ch.estado !== 'EN_CARTERA' || !ch.cajaId) throw noDisponible(ch.numero);
        await this.alcance.verificarCaja(tx, ch.cajaId).catch(() => {
          throw new NotFoundException('Cheque no encontrado');
        });
        medios.push({ ...m, monedaCodigo: ch.monedaCodigo as 'ARS' | 'USD', importe: Number(ch.importe), cajaId: ch.cajaId });
      }
      await bloquear(tx, 'OrdenPago', empresaId, [id]);
      const op = await tx.ordenPago.findUnique({ where: { id }, include: { imputaciones: true, anticipo: true } });
      if (!op) throw new NotFoundException('Orden de pago no encontrada');
      if (op.version !== version) throw new ConflictException(MODIFICADO);
      if (op.estado !== 'APROBADA') throw new BadRequestException('Solo se pueden pagar órdenes aprobadas');
      if (medios.some((m) => m.monedaCodigo === 'USD') && op.cotizacion.lte(1))
        throw new BadRequestException('Para pagar en dólares, indique la cotización del dólar en la orden de pago');
      // Orden de bloqueo: OP → proveedor → movimientos → chequeras. El proveedor serializa los pagos del mes (acumulado de Ganancias).
      await bloquear(tx, 'Tercero', empresaId, [op.terceroId]);

      // 1. Retenciones a la fecha de pago
      const rets = await this.ordenes.calcularRetenciones(tx, id, fechaPago);
      const { totalRetenciones, netoPagar } = await this.ordenes.guardarRetenciones(tx, id, rets, op.totalCancelarPesos);

      // 2. Medios: validación y conversión a pesos
      const preparados = [];
      for (const m of medios) {
        const importe = new D(m.importe);
        const importePesos = (m.monedaCodigo === 'USD' ? importe.mul(op.cotizacion) : importe).toDecimalPlaces(2);
        let cuentaContableId: string;
        let cuentaBancariaId: string | null = null;
        let chequera = null;
        if (m.tipo === 'TRANSFERENCIA') {
          const c = m.cuentaBancariaId ? await tx.cuentaBancaria.findUnique({ where: { id: m.cuentaBancariaId } }) : null;
          if (!c) throw new BadRequestException('Indique una cuenta bancaria válida');
          if (c.monedaCodigo !== m.monedaCodigo) throw new BadRequestException(MONEDA_DISTINTA);
          cuentaContableId = c.cuentaContableId;
          cuentaBancariaId = c.id;
        } else if (m.tipo === 'CHEQUE_TERCERO') {
          cuentaContableId = await this.cuentas.cuenta(tx, 'VALORES_A_DEPOSITAR');
        } else if (m.tipo === 'EFECTIVO') {
          if (!m.cajaId) throw new BadRequestException('Indique una caja válida');
          const c = await this.alcance.verificarCaja(tx, m.cajaId);
          if (c.monedaCodigo !== m.monedaCodigo) throw new BadRequestException(MONEDA_DISTINTA);
          cuentaContableId = c.cuentaContableId;
        } else {
          chequera = m.chequeraId ? await tx.chequera.findUnique({ where: { id: m.chequeraId }, include: { cuentaBancaria: true } }) : null;
          if (!chequera || !chequera.activa) throw new BadRequestException('Indique una chequera válida');
          if (!m.chequeFechaPago) throw new BadRequestException('Indique la fecha de pago del cheque');
          if (chequera.cuentaBancaria.monedaCodigo !== m.monedaCodigo) throw new BadRequestException(MONEDA_DISTINTA);
          if (chequera.tipo === 'ECHEQ' && !m.chequeNumero) throw new BadRequestException('Indique el número del e-cheq');
          cuentaContableId = chequera.cuentaBancaria.cuentaContableId;
          cuentaBancariaId = chequera.cuentaBancariaId;
        }
        preparados.push({ ...m, importe, importePesos, cuentaContableId, cuentaBancariaId, chequera });
      }
      const totalMedios = preparados.reduce((s, m) => s.plus(m.importePesos), new D(0));
      if (!totalMedios.plus(totalRetenciones).eq(op.totalCancelarPesos))
        throw new BadRequestException(
          `Los medios de pago ($${formatoImporte(totalMedios)}) más las retenciones ($${formatoImporte(totalRetenciones)}) no coinciden con el total a cancelar ($${formatoImporte(op.totalCancelarPesos)})`,
        );

      // 3. Revalidar saldos con bloqueo
      await bloquear(tx, 'MovimientoCuentaCorriente', empresaId, op.imputaciones.map((i) => i.movimientoId));
      const movs = await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: op.imputaciones.map((i) => i.movimientoId) } } });
      for (const i of op.imputaciones) {
        const m = movs.find((x) => x.id === i.movimientoId)!;
        if (m.anulado || i.importe.isNegative() !== m.saldo.isNegative() || i.importe.abs().gt(m.saldo.abs()))
          throw new BadRequestException('El saldo de un comprobante cambió: revise la orden de pago');
      }

      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const renglones: RenglonAsiento[] = [];
      const debe = (cuentaContableId: string, importe: Dec) => renglones.push({ cuentaContableId, debe: importe.toFixed(2) });
      const haber = (cuentaContableId: string, importe: Dec) => renglones.push({ cuentaContableId, haber: importe.toFixed(2) });
      const cuenta = (c: ConceptoCuenta) => this.cuentas.cuenta(tx, c);

      // 4. Medios: cheques y tesorería (orden de bloqueo: chequeras → cajas → cheques de terceros)
      await bloquear(tx, 'Chequera', empresaId, preparados.filter((m) => m.chequera).map((m) => m.chequera!.id));
      const efectivoPorCaja = new Map<string, Dec>();
      for (const m of preparados.filter((x) => x.tipo === 'EFECTIVO'))
        efectivoPorCaja.set(m.cajaId!, (efectivoPorCaja.get(m.cajaId!) ?? new D(0)).plus(m.importe));
      await bloquear(tx, 'Caja', empresaId, [...efectivoPorCaja.keys()]);
      for (const [cajaId, importe] of efectivoPorCaja) if (importe.gt(await saldoCaja(tx, cajaId))) throw new BadRequestException(SALDO_INSUFICIENTE);
      await bloquear(tx, 'ChequeTercero', empresaId, chequeIds);
      const pesosIngreso = new Map<string, Dec>();
      for (const m of preparados.filter((x) => x.tipo === 'CHEQUE_TERCERO')) {
        const ch = await tx.chequeTercero.findUniqueOrThrow({ where: { id: m.chequeId! } });
        pesosIngreso.set(ch.id, ch.importePesos);
        if (ch.estado !== 'EN_CARTERA' || ch.cajaId !== m.cajaId || !ch.importe.eq(m.importe)) throw noDisponible(ch.numero);
        await this.cartera.cambiarEstado(tx, ch.id, 'ENDOSADO', { cajaId: null, terceroDestinoId: op.terceroId }, { tipo: 'OP', id, fecha: fechaPago }, ['EN_CARTERA']);
      }
      for (const m of preparados) {
        let numero: string | null = m.chequeNumero ?? null;
        let diferido = false;
        if (m.tipo === 'CHEQUE') {
          const ch = await tx.chequera.findUniqueOrThrow({ where: { id: m.chequera!.id } });
          if (ch.tipo === 'FISICA') {
            const n = numero ? Number(numero) : ch.proximoNumero;
            if (!n || !Number.isInteger(n) || n < (ch.desde ?? 0) || n > (ch.hasta ?? 0))
              throw new BadRequestException('El número de cheque está fuera del rango de la chequera');
            numero = String(n);
            await tx.chequera.update({ where: { id: ch.id }, data: { proximoNumero: Math.max(ch.proximoNumero ?? 0, n + 1) } });
          }
          if (await tx.chequePropio.findFirst({ where: { chequeraId: ch.id, numero: numero! } })) throw new ConflictException(`El cheque ${numero} ya fue emitido`);
          diferido = m.chequeFechaPago! > fechaPago;
          await tx.chequePropio.create({
            data: {
              empresaId, chequeraId: ch.id, numero: numero!, fechaEmision: fechaPago, fechaPago: m.chequeFechaPago!, monedaCodigo: m.monedaCodigo,
              importe: m.importe, beneficiarioId: op.terceroId, ordenPagoId: id,
            },
          });
        }
        await tx.ordenPagoMedio.create({
          data: {
            empresaId, ordenPagoId: id, tipo: m.tipo, monedaCodigo: m.monedaCodigo, importe: m.importe, importePesos: m.importePesos,
            cuentaBancariaId: m.cuentaBancariaId, cajaId: m.cajaId ?? null, chequeraId: m.chequera?.id ?? null, chequeNumero: numero,
            chequeFechaPago: m.chequeFechaPago ?? null, referencia: m.referencia ?? null, chequeTerceroId: m.chequeId ?? null,
          },
        });
        if (!diferido && m.tipo !== 'CHEQUE_TERCERO')
          await tx.movimientoTesoreria.create({
            data: {
              empresaId, fecha: m.tipo === 'CHEQUE' ? m.chequeFechaPago! : fechaPago, tipo: 'EGRESO', cuentaBancariaId: m.cuentaBancariaId,
              cajaId: m.cajaId ?? null, monedaCodigo: m.monedaCodigo, importe: m.importe, origenTipo: 'OP', origenId: id,
            },
          });
        if (m.tipo === 'CHEQUE_TERCERO') {
          // Valores a depositar se cancela por lo registrado al ingresar el cheque; la diferencia es de cambio
          const registrado = pesosIngreso.get(m.chequeId!)!;
          haber(m.cuentaContableId, registrado);
          const dif = m.importePesos.minus(registrado);
          if (dif.gt(0)) haber(await cuenta('DIFERENCIA_CAMBIO_POSITIVA'), dif);
          if (dif.lt(0)) debe(await cuenta('DIFERENCIA_CAMBIO_NEGATIVA'), dif.neg());
        } else haber(diferido ? await cuenta('CHEQUES_DIFERIDOS') : m.cuentaContableId, m.importePesos);
      }

      // 5. Aplicaciones a la cuenta corriente (saldo en pesos proporcional al histórico)
      let historico = new D(0);
      let alDia = new D(0);
      for (const i of op.imputaciones) {
        const m = movs.find((x) => x.id === i.movimientoId)!;
        const hist = i.importe.eq(m.saldo) ? m.saldoPesos : i.importe.mul(m.saldoPesos).div(m.saldo).toDecimalPlaces(2);
        await tx.movimientoCuentaCorriente.update({ where: { id: m.id }, data: { saldo: { decrement: i.importe }, saldoPesos: { decrement: hist } } });
        await tx.aplicacionCuentaCorriente.create({
          data: { empresaId, origenTipo: 'OP', origenId: id, movimientoId: m.id, importe: i.importe, importePesosHistorico: hist, fecha: fechaPago },
        });
        debe(await cuenta(m.origenTipo === 'ANTICIPO' ? 'ANTICIPOS_PROVEEDORES' : 'PROVEEDORES'), hist);
        historico = historico.plus(hist);
        alDia = alDia.plus(i.importePesos);
      }
      const difCambio = alDia.minus(historico);
      if (difCambio.gt(0)) debe(await cuenta('DIFERENCIA_CAMBIO_NEGATIVA'), difCambio);
      if (difCambio.lt(0)) haber(await cuenta('DIFERENCIA_CAMBIO_POSITIVA'), difCambio.neg());

      // 6. Anticipo nuevo
      if (op.anticipo) {
        const pesos = (op.anticipo.monedaCodigo === 'USD' ? op.anticipo.importe.mul(op.cotizacion) : op.anticipo.importe).toDecimalPlaces(2);
        await tx.movimientoCuentaCorriente.create({
          data: {
            empresaId, terceroId: op.terceroId, origenTipo: 'ANTICIPO', origenId: id, fecha: fechaPago, fechaVencimiento: fechaPago,
            monedaCodigo: op.anticipo.monedaCodigo, importe: op.anticipo.importe.neg(), importePesos: pesos.neg(), saldo: op.anticipo.importe.neg(), saldoPesos: pesos.neg(),
          },
        });
        debe(await cuenta('ANTICIPOS_PROVEEDORES'), pesos);
      }

      // 7. Certificados de retención
      const guardadas = await tx.ordenPagoRetencion.findMany({ where: { ordenPagoId: id } });
      for (const r of guardadas) {
        if (r.importe.lte(0)) continue;
        const talonario = r.impuesto === 'GANANCIAS' ? 'RET-GAN' : `RET-IIBB-${r.jurisdiccion}`;
        await tx.ordenPagoRetencion.update({ where: { id: r.id }, data: { certificadoNumero: await this.numeracion.siguiente(tx, talonario, 0) } });
        haber(await cuenta(r.impuesto === 'GANANCIAS' ? 'RETENCION_GANANCIAS' : 'RETENCION_IIBB'), r.importe);
      }

      // 8. Asiento y estado
      const tercero = await tx.tercero.findUniqueOrThrow({ where: { id: op.terceroId } });
      const asiento = await this.asientos.generar(tx, {
        fecha: fechaPago, descripcion: `Orden de pago 0001-${String(op.numero).padStart(8, '0')} - ${tercero.razonSocial}`,
        origenTipo: 'PAGO', origenId: id, renglones,
      });
      await tx.ordenPago.update({
        where: { id },
        data: { estado: 'PAGADA', fechaPago, pagadoPor: usuario, asientoId: asiento.id, totalRetenciones, netoPagar, version: { increment: 1 } },
      });
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'MODIFICAR', datos: { pago: true, medios: medios.length } });
      return this.ordenes.obtener(id, tx);
    });
  }
}
