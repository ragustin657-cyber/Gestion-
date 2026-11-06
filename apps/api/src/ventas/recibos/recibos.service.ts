import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { IngresosService } from '../../tesoreria/operaciones/ingresos.service';
import { cotizacion, D, Dec, hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { AplicacionesService } from '../aplicaciones/aplicaciones.service';
import { numeroVenta } from '../comprobantes/comprobantes.service';
import { importeAR } from '../pdf/pdf-venta';
import { DatosRecibo } from './dto';

const CUENTA_RETENCION = { IVA: 'RETENCION_SUFRIDA_IVA', GANANCIAS: 'RETENCION_SUFRIDA_GANANCIAS', IIBB: 'RETENCION_SUFRIDA_IIBB', SUSS: 'RETENCION_SUFRIDA_SUSS' } as const;
const INCLUIR = { retenciones: true } satisfies Prisma.ReciboInclude;

@Injectable()
export class RecibosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly ingresos: IngresosService,
    private readonly aplicaciones: AplicacionesService,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly numeracion: NumeracionService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const r = await tx.recibo.findUnique({ where: { id }, include: INCLUIR });
    if (!r) throw new NotFoundException('Recibo no encontrado');
    const ingreso = r.ingresoId ? await tx.ingresoValores.findUnique({ where: { id: r.ingresoId }, include: { efectivo: true, cheques: true, transferencias: true } }) : null;
    const aplicaciones = await tx.aplicacionCobro.findMany({ where: { origenTipo: 'RECIBO', origenId: id } });
    const tercero = await tx.tercero.findUniqueOrThrow({ where: { id: r.terceroId } });
    return { ...r, tercero, ingreso, aplicaciones };
  }

  /**
   * Recibo: los valores entran a la caja por un ingreso de Tesorería (sin su asiento ni su movimiento),
   * las retenciones sufridas van a sus cuentas y el total cancela comprobantes; lo que sobra queda a cuenta.
   */
  crear(d: DatosRecibo) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
      if (!tercero || !tercero.esCliente) throw new BadRequestException('Cliente inexistente');
      const pv = await tx.puntoVenta.findUnique({ where: { id: d.puntoVentaId } });
      if (!pv) throw new BadRequestException('Punto de venta inexistente');
      const caja = await tx.caja.findUnique({ where: { id: d.cajaId } });
      if (!caja) throw new BadRequestException('Caja inexistente');
      const hayValores = !!d.efectivo || d.cheques.length > 0 || d.transferencias.length > 0;
      if (!hayValores && !d.retenciones.length) throw new BadRequestException('Ingrese al menos un valor o una retención');

      const numero = await this.numeracion.siguiente(tx, 'RECIBO', pv.numero);
      const etiqueta = `Recibo ${numeroVenta(pv.numero, numero)}`;
      const valores = hayValores
        ? await this.ingresos.crearEnTx(tx, { fecha: d.fecha, cajaId: d.cajaId, origen: 'CLIENTE', terceroId: d.terceroId, cuentaContableId: null, concepto: `${etiqueta} - ${tercero.razonSocial}`, efectivo: d.efectivo, cheques: d.cheques, transferencias: d.transferencias }, { sinAsiento: true, sinCuentaCorriente: true })
        : null;
      const totalValores = valores?.totalPesos ?? new D(0);
      const totalRetenciones = d.retenciones.reduce((s: Dec, r) => s.plus(new D(r.importe).toDecimalPlaces(2)), new D(0));
      const total = totalValores.plus(totalRetenciones);

      // Lo aplicado, en pesos del día, no puede superar el total; cada comprobante, no más que su saldo
      const debitos = [];
      let aplicadoPesos = new D(0);
      for (const a of d.aplicaciones) {
        const c = await tx.comprobanteVenta.findUnique({ where: { id: a.comprobanteId } });
        if (!c || c.terceroId !== d.terceroId || c.estado !== 'AUTORIZADO' || c.tipo === 'NOTA_CREDITO') throw new BadRequestException('Solo se aplican facturas y notas de débito autorizadas del cliente');
        const mov = await tx.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'VENTA', origenId: c.id, anulado: false } });
        const importe = new D(a.importe).toDecimalPlaces(2);
        if (importe.gt(mov.saldo)) throw new BadRequestException(`El comprobante ${numeroVenta(c.puntoVenta, c.numero)} tiene saldo ${importeAR(mov.saldo.toString())}`);
        aplicadoPesos = aplicadoPesos.plus(c.monedaCodigo === 'ARS' ? importe : importe.mul(await cotizacion(tx, c.monedaCodigo, d.fecha)).toDecimalPlaces(2));
        debitos.push({ mov, importe });
      }
      if (aplicadoPesos.gt(total)) throw new BadRequestException('Lo aplicado supera el total del recibo');

      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const recibo = await tx.recibo.create({
        data: {
          empresaId, puntoVentaId: pv.id, puntoVenta: pv.numero, numero, terceroId: d.terceroId, fecha: d.fecha, sucursalId: caja.sucursalId, cajaId: caja.id,
          ingresoId: valores?.ingreso.id ?? null, totalValores, totalRetenciones, total, creadoPor: usuario,
          retenciones: { create: d.retenciones.map((r) => ({ empresaId, tipo: r.tipo, jurisdiccion: r.jurisdiccion ?? null, numeroCertificado: r.numeroCertificado, fecha: r.fecha, importe: r.importe })) },
        },
      });
      const credito = await tx.movimientoCuentaCorriente.create({
        data: { empresaId, terceroId: d.terceroId, origenTipo: 'RECIBO', origenId: recibo.id, fecha: d.fecha, fechaVencimiento: d.fecha, monedaCodigo: 'ARS', importe: total.neg(), importePesos: total.neg(), saldo: total.neg(), saldoPesos: total.neg() },
      });
      const { diferenciaCambio } = debitos.length
        ? await this.aplicaciones.aplicarEnTx(tx, { terceroId: d.terceroId, fecha: d.fecha, origenTipo: 'RECIBO', origenId: recibo.id, items: debitos.map((x) => ({ creditoMovId: credito.id, debitoMovId: x.mov.id, importe: x.importe })) })
        : { diferenciaCambio: new D(0) };

      const renglones: RenglonAsiento[] = [...(valores?.renglones ?? [])];
      for (const r of d.retenciones)
        renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, CUENTA_RETENCION[r.tipo]), debe: new D(r.importe).toFixed(2), detalle: `Retención ${r.tipo}${r.jurisdiccion ? ` ${r.jurisdiccion}` : ''} cert. ${r.numeroCertificado}` });
      renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'DEUDORES_POR_VENTAS'), haber: total.toFixed(2) });
      renglones.push(...(await this.aplicaciones.renglonesDiferencia(tx, diferenciaCambio)));
      const asiento = await this.asientos.generar(tx, { fecha: d.fecha, descripcion: `${etiqueta} - ${tercero.razonSocial}`, origenTipo: 'RECIBO', origenId: recibo.id, renglones });
      await tx.recibo.update({ where: { id: recibo.id }, data: { asientoId: asiento.id } });
      await this.auditoria.registrar(tx, { entidad: 'Recibo', entidadId: recibo.id, accion: 'CREAR', datos: { numero, total, aplicaciones: d.aplicaciones } });
      return { ...(await this.obtener(recibo.id, tx)), advertencias: valores?.ingreso.advertencias ?? [] };
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.obtener(id, tx);
      await bloquear(tx, 'Recibo', this.tenant.empresaId, [id]);
      const r = await tx.recibo.findUniqueOrThrow({ where: { id } });
      if (r.estado === 'ANULADO') throw new BadRequestException('El recibo ya está anulado');
      const mov = await tx.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'RECIBO', origenId: id } });
      // Bloqueado antes de contar: una Aplicación concurrente sobre este crédito espera o ya se ve
      await bloquear(tx, 'MovimientoCuentaCorriente', this.tenant.empresaId, [mov.id]);
      if (await tx.aplicacionCobro.count({ where: { creditoMovId: mov.id, anulada: false, NOT: { origenTipo: 'RECIBO', origenId: id } } }))
        throw new BadRequestException('El saldo del recibo fue aplicado: deshaga primero la aplicación');
      await this.aplicaciones.revertirEnTx(tx, 'RECIBO', id);
      if (r.ingresoId) await this.ingresos.anularEnTx(tx, r.ingresoId, `Anulación del recibo ${numeroVenta(r.puntoVenta, r.numero)}: ${motivo}`);
      await tx.movimientoCuentaCorriente.update({ where: { id: mov.id }, data: { anulado: true, saldo: 0, saldoPesos: 0 } });
      const fecha = hoy() < r.fecha ? r.fecha : hoy();
      const contra = await this.asientos.contraasiento(tx, r.asientoId!, fecha, `Anulación del recibo ${numeroVenta(r.puntoVenta, r.numero)} - ${motivo}`);
      await tx.recibo.update({ where: { id }, data: { estado: 'ANULADO', asientoAnulacionId: contra.id, motivoAnulacion: motivo } });
      await this.auditoria.registrar(tx, { entidad: 'Recibo', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }
}
