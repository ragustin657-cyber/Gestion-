import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { AplicacionCobro, ComprobanteVenta, MovimientoCuentaCorriente } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear, fechaAR } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cotizacion, D, Dec, hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { numeroVenta } from '../comprobantes/comprobantes.service';
import { EmisionService } from '../emision/emision.service';

export interface ItemAplicacion { creditoMovId: string; debitoMovId: string; importe: Dec }
export interface DatosAplicacion { terceroId: string; fecha: Date; origenTipo: 'RECIBO' | 'APLICACION' | 'VENTA'; origenId: string; items: ItemAplicacion[] }

const SUPERA = 'El importe supera el saldo disponible';
const r2 = (d: Dec) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);
/** Pesos proporcionales de una parte del saldo; con todo el saldo, los pesos completos (sin centavos sueltos). */
const proporcional = (importe: Dec, saldo: Dec, saldoPesos: Dec) => (importe.eq(saldo) ? saldoPesos : r2(importe.mul(saldoPesos).div(saldo)));

@Injectable()
export class AplicacionesService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly emision: EmisionService,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly numeracion: NumeracionService,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit() {
    this.emision.registrarAlAutorizar((tx, c) => this.aplicarNcAlAutorizar(tx, c));
  }

  /**
   * Cancela débitos (facturas, ND) con créditos (cobros, recibos, NC) del cliente. No genera asiento:
   * devuelve la diferencia de cambio total (pesos del crédito − pesos del débito) para que la contabilice quien llama.
   */
  async aplicarEnTx(tx: TxEmpresa, d: DatosAplicacion): Promise<{ aplicaciones: AplicacionCobro[]; diferenciaCambio: Dec }> {
    const empresaId = this.tenant.empresaId;
    const ids = [...new Set(d.items.flatMap((i) => [i.creditoMovId, i.debitoMovId]))];
    await bloquear(tx, 'MovimientoCuentaCorriente', empresaId, ids);
    const numero = await this.numeracion.siguiente(tx, 'APLICACION-COBRO', 0);
    const aplicaciones: AplicacionCobro[] = [];
    let diferencia = new D(0);
    for (const it of d.items) {
      const importe = r2(new D(it.importe));
      if (importe.lte(0)) throw new BadRequestException('El importe debe ser mayor a cero');
      const cred = await tx.movimientoCuentaCorriente.findUnique({ where: { id: it.creditoMovId } });
      const deb = await tx.movimientoCuentaCorriente.findUnique({ where: { id: it.debitoMovId } });
      if (!cred || !deb || cred.terceroId !== d.terceroId || deb.terceroId !== d.terceroId || cred.anulado || deb.anulado)
        throw new BadRequestException('Movimiento de cuenta corriente inexistente o de otro cliente');
      if (!cred.saldo.lt(0) || !deb.saldo.gt(0)) throw new BadRequestException('El crédito o el débito no tienen saldo pendiente');
      if (importe.gt(deb.saldo)) throw new BadRequestException(SUPERA);
      const { pesosCredito, consumoCredito } = await this.consumo(tx, cred, deb, importe, d.fecha);
      if (consumoCredito.gt(cred.saldo.neg())) throw new BadRequestException(SUPERA);
      const pesosDebito = proporcional(importe, deb.saldo, deb.saldoPesos);
      const pesosCred = consumoCredito.eq(cred.saldo.neg()) && cred.monedaCodigo !== 'ARS' ? cred.saldoPesos.neg() : pesosCredito;
      await tx.movimientoCuentaCorriente.update({ where: { id: deb.id }, data: { saldo: deb.saldo.minus(importe), saldoPesos: deb.saldoPesos.minus(pesosDebito) } });
      await tx.movimientoCuentaCorriente.update({ where: { id: cred.id }, data: { saldo: cred.saldo.plus(consumoCredito), saldoPesos: cred.saldoPesos.plus(pesosCred) } });
      const dif = pesosCred.minus(pesosDebito);
      diferencia = diferencia.plus(dif);
      aplicaciones.push(await tx.aplicacionCobro.create({
        data: { empresaId, numero, terceroId: d.terceroId, fecha: d.fecha, origenTipo: d.origenTipo, origenId: d.origenId, creditoMovId: cred.id, debitoMovId: deb.id, importe, importePesosCredito: pesosCred, importePesosDebito: pesosDebito, diferenciaCambio: dif },
      }));
    }
    return { aplicaciones, diferenciaCambio: diferencia };
  }

  /** Cuánto se descuenta del saldo del crédito (en su moneda) y cuántos pesos representa. */
  private async consumo(tx: TxEmpresa, cred: MovimientoCuentaCorriente, deb: MovimientoCuentaCorriente, importe: Dec, fecha: Date) {
    if (deb.monedaCodigo === 'ARS') {
      if (cred.monedaCodigo !== 'ARS') throw new BadRequestException('La moneda del crédito no coincide con la del comprobante');
      return { consumoCredito: importe, pesosCredito: importe };
    }
    if (cred.monedaCodigo === deb.monedaCodigo) return { consumoCredito: importe, pesosCredito: proporcional(importe, cred.saldo.neg(), cred.saldoPesos.neg()) };
    if (cred.monedaCodigo !== 'ARS') throw new BadRequestException('La moneda del crédito no coincide con la del comprobante');
    const pesos = r2(importe.mul(await cotizacion(tx, deb.monedaCodigo, fecha)));
    return { consumoCredito: pesos, pesosCredito: pesos };
  }

  /** Restituye los saldos de las aplicaciones de un origen y las marca anuladas. Devuelve la diferencia de cambio que tenían. */
  async revertirEnTx(tx: TxEmpresa, origenTipo: string, origenId: string): Promise<Dec> {
    const aps = await tx.aplicacionCobro.findMany({ where: { origenTipo, origenId, anulada: false } });
    await bloquear(tx, 'MovimientoCuentaCorriente', this.tenant.empresaId, [...new Set(aps.flatMap((a) => [a.creditoMovId, a.debitoMovId]))]);
    let dif = new D(0);
    for (const a of aps) {
      const cred = await tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: a.creditoMovId } });
      const consumo = cred.monedaCodigo === 'ARS' ? a.importePesosCredito : a.importe;
      await tx.movimientoCuentaCorriente.update({ where: { id: cred.id }, data: { saldo: { decrement: consumo }, saldoPesos: { decrement: a.importePesosCredito } } });
      await tx.movimientoCuentaCorriente.update({ where: { id: a.debitoMovId }, data: { saldo: { increment: a.importe }, saldoPesos: { increment: a.importePesosDebito } } });
      await tx.aplicacionCobro.update({ where: { id: a.id }, data: { anulada: true } });
      dif = dif.plus(a.diferenciaCambio);
    }
    return dif;
  }

  /** Renglones que llevan a resultados la diferencia de cambio, contra Deudores por ventas. */
  async renglonesDiferencia(tx: TxEmpresa, dif: Dec): Promise<RenglonAsiento[]> {
    if (dif.isZero()) return [];
    const deudores = await this.cuentas.cuenta(tx, 'DEUDORES_POR_VENTAS');
    return dif.gt(0)
      ? [{ cuentaContableId: deudores, debe: dif.toFixed(2) }, { cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIA_CAMBIO_POSITIVA'), haber: dif.toFixed(2) }]
      : [{ cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIA_CAMBIO_NEGATIVA'), debe: dif.neg().toFixed(2) }, { cuentaContableId: deudores, haber: dif.neg().toFixed(2) }];
  }

  /** Al autorizar una NC con "aplicar a la factura asociada": la aplica por lo que permitan ambos saldos. */
  async aplicarNcAlAutorizar(tx: TxEmpresa, nc: ComprobanteVenta) {
    if (nc.tipo !== 'NOTA_CREDITO' || !nc.aplicarAAsociado || !nc.comprobanteAsociadoId) return;
    const cred = await tx.movimientoCuentaCorriente.findFirst({ where: { origenTipo: 'VENTA', origenId: nc.id, anulado: false } });
    const deb = await tx.movimientoCuentaCorriente.findFirst({ where: { origenTipo: 'VENTA', origenId: nc.comprobanteAsociadoId, anulado: false } });
    if (!cred || !deb || !deb.saldo.gt(0)) return;
    const importe = D.min(cred.saldo.neg(), deb.saldo);
    const { diferenciaCambio } = await this.aplicarEnTx(tx, { terceroId: nc.terceroId, fecha: nc.fecha, origenTipo: 'VENTA', origenId: nc.id, items: [{ creditoMovId: cred.id, debitoMovId: deb.id, importe }] });
    const renglones = await this.renglonesDiferencia(tx, diferenciaCambio);
    if (renglones.length)
      await this.asientos.generar(tx, { fecha: nc.fecha, descripcion: `Diferencia de cambio - NC ${numeroVenta(nc.puntoVenta, nc.numero)}`, origenTipo: 'APLICACION_COBRO', origenId: nc.id, renglones });
  }

  /** Pantalla de Aplicación: una operación con su asiento de diferencia de cambio, si la hay. */
  aplicar(d: { terceroId: string; fecha: Date; items: { creditoMovId: string; debitoMovId: string; importe: number }[] }) {
    return this.tenant.transaccion(async (tx) => {
      const id = randomUUID();
      const r = await this.aplicarEnTx(tx, { terceroId: d.terceroId, fecha: d.fecha, origenTipo: 'APLICACION', origenId: id, items: d.items.map((i) => ({ ...i, importe: new D(i.importe) })) });
      const renglones = await this.renglonesDiferencia(tx, r.diferenciaCambio);
      if (renglones.length)
        await this.asientos.generar(tx, { fecha: d.fecha, descripcion: `Aplicación de cobros ${r.aplicaciones[0].numero} - diferencia de cambio`, origenTipo: 'APLICACION_COBRO', origenId: id, renglones });
      await this.auditoria.registrar(tx, { entidad: 'AplicacionCobro', entidadId: id, accion: 'CREAR', datos: { numero: r.aplicaciones[0].numero, items: d.items } });
      return { id, numero: r.aplicaciones[0].numero, diferenciaCambio: r.diferenciaCambio.toString(), aplicaciones: r.aplicaciones };
    });
  }

  anular(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const aps = await tx.aplicacionCobro.findMany({ where: { origenTipo: 'APLICACION', origenId: id } });
      if (!aps.length) throw new NotFoundException('Aplicación no encontrada');
      if (aps.every((a) => a.anulada)) throw new BadRequestException('La aplicación ya fue deshecha');
      await this.revertirEnTx(tx, 'APLICACION', id);
      const asiento = await tx.asiento.findFirst({ where: { origenTipo: 'APLICACION_COBRO', origenId: id, anulaAId: null } });
      if (asiento) {
        const fecha = hoy() < aps[0].fecha ? aps[0].fecha : hoy();
        await this.asientos.contraasiento(tx, asiento.id, fecha, `Anulación de la aplicación de cobros ${aps[0].numero}`);
      }
      await this.auditoria.registrar(tx, { entidad: 'AplicacionCobro', entidadId: id, accion: 'ANULAR', datos: { numero: aps[0].numero } });
      return { ok: true };
    });
  }

  /** Movimientos del cliente con saldo: créditos (saldo a favor) y débitos (comprobantes pendientes), con su descripción. */
  async pendientes(terceroId: string) {
    const db = this.tenant.db;
    const movs = await db.movimientoCuentaCorriente.findMany({ where: { terceroId, anulado: false, saldo: { not: 0 } }, orderBy: [{ fechaVencimiento: 'asc' }, { fecha: 'asc' }, { creadoEn: 'asc' }] });
    const ventas = await db.comprobanteVenta.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'VENTA').map((m) => m.origenId) } } });
    const recibos = await db.recibo.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'RECIBO').map((m) => m.origenId) } } });
    const ingresos = await db.ingresoValores.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'COBRO').map((m) => m.origenId) } } });
    const nombres = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito' } as const;
    const descripcion = (m: MovimientoCuentaCorriente) => {
      const v = ventas.find((x) => x.id === m.origenId);
      if (v) return `${nombres[v.tipo]} ${v.letra} ${numeroVenta(v.puntoVenta, v.numero)}`;
      const r = recibos.find((x) => x.id === m.origenId);
      if (r) return `Recibo ${numeroVenta(r.puntoVenta, r.numero)}`;
      const i = ingresos.find((x) => x.id === m.origenId);
      if (i) return `Cobro de Tesorería ${i.numero} del ${fechaAR(i.fecha)}`;
      return m.origenTipo;
    };
    const vista = (m: MovimientoCuentaCorriente) => ({
      id: m.id, origenTipo: m.origenTipo, origenId: m.origenId, descripcion: descripcion(m), fecha: m.fecha, fechaVencimiento: m.fechaVencimiento,
      monedaCodigo: m.monedaCodigo, importe: m.importe, saldo: m.saldo, saldoPesos: m.saldoPesos,
    });
    return { creditos: movs.filter((m) => m.saldo.lt(0)).map(vista), debitos: movs.filter((m) => m.saldo.gt(0)).map(vista) };
  }
}
