import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { CarteraService } from './cartera.service';
import { ConsultasTesoreriaService } from './consultas.service';
import { DatosDevolucion, DatosRechazo } from './dto';
import { aPesos, D, registrarMovimiento } from './tesoreria-comun';

const NO_RECHAZABLE = 'Solo se pueden rechazar cheques depositados, acreditados o endosados';

@Injectable()
export class RechazosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly cartera: CarteraService,
    private readonly consultas: ConsultasTesoreriaService,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async visible(tx: TxEmpresa, id: string) {
    const c = await tx.chequeTercero.findFirst({ where: { AND: [{ id }, await this.consultas.visibilidadCheques(tx)] } });
    if (!c) throw new NotFoundException('Cheque no encontrado');
    return c;
  }

  rechazar(id: string, d: DatosRechazo) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const previo = await this.visible(tx, id);
      // Orden de bloqueo: terceros → cheques
      await bloquear(tx, 'Tercero', empresaId, [previo.terceroOrigenId, previo.terceroDestinoId].filter((x): x is string => !!x));
      await bloquear(tx, 'ChequeTercero', empresaId, [id]);
      const ch = await tx.chequeTercero.findUniqueOrThrow({ where: { id } });
      if (!['DEPOSITADO', 'ACREDITADO', 'ENDOSADO'].includes(ch.estado)) throw new BadRequestException(NO_RECHAZABLE);
      const gastos = new D(d.gastos ?? 0).toDecimalPlaces(2);
      if (ch.estado === 'ENDOSADO' && gastos.gt(0)) throw new BadRequestException('Un cheque endosado rechazado no lleva gastos bancarios');
      const fechaRef = ch.fechaDeposito ?? ch.fechaEmision;
      if (d.fecha < fechaRef) throw new BadRequestException('La fecha de rechazo no puede ser anterior al depósito del cheque');

      const pesos = await aPesos(tx, ch.monedaCodigo, ch.importe, d.fecha);
      const renglones: RenglonAsiento[] = [{ cuentaContableId: await this.cuentas.cuenta(tx, 'CHEQUES_RECHAZADOS'), debe: pesos.toFixed(2) }];
      // El cliente que entregó el cheque vuelve a deberlo (lado Ventas); el proveedor endosatario, lado Compras
      const ccMov = async (terceroId: string, origenTipo: 'CHEQUE_RECHAZADO' | 'CHEQUE_RECHAZADO_CLIENTE') => {
        await tx.movimientoCuentaCorriente.create({
          data: {
            empresaId, terceroId, origenTipo, origenId: ch.id, fecha: d.fecha, fechaVencimiento: d.fecha, monedaCodigo: ch.monedaCodigo,
            importe: ch.importe, importePesos: pesos, saldo: ch.importe, saldoPesos: pesos,
          },
        });
      };
      if (ch.estado === 'ENDOSADO') {
        renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'PROVEEDORES'), haber: pesos.toFixed(2) });
        if (ch.terceroDestinoId) await ccMov(ch.terceroDestinoId, 'CHEQUE_RECHAZADO');
      } else {
        const cuenta = await tx.cuentaBancaria.findUniqueOrThrow({ where: { id: ch.cuentaBancariaId! } });
        const gastosPesos = await aPesos(tx, cuenta.monedaCodigo, gastos, d.fecha);
        await registrarMovimiento(tx, empresaId, {
          fecha: d.fecha, tipo: 'EGRESO', cuentaBancariaId: cuenta.id, monedaCodigo: cuenta.monedaCodigo, importe: ch.importe.plus(gastos), origenTipo: 'RECHAZO_CHEQUE', origenId: ch.id,
        });
        if (gastos.gt(0)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'GASTOS_BANCARIOS'), debe: gastosPesos.toFixed(2) });
        renglones.push({ cuentaContableId: cuenta.cuentaContableId, haber: pesos.plus(gastosPesos).toFixed(2) });
      }
      if (ch.terceroOrigenId) await ccMov(ch.terceroOrigenId, 'CHEQUE_RECHAZADO_CLIENTE');

      await this.asientos.generar(tx, {
        fecha: d.fecha, descripcion: `Rechazo del cheque ${ch.numero} ${ch.banco} - ${d.motivo}`, origenTipo: 'RECHAZO_CHEQUE', origenId: ch.id, renglones,
      });
      const r = await this.cartera.cambiarEstado(tx, id, 'RECHAZADO', { fechaRechazo: d.fecha, motivoRechazo: d.motivo }, { tipo: 'RECHAZO_CHEQUE', id, fecha: d.fecha });
      await this.auditoria.registrar(tx, { entidad: 'ChequeTercero', entidadId: id, accion: 'MODIFICAR', datos: { rechazo: d.motivo, gastos: gastos.toString() } });
      return r;
    });
  }

  devolver(id: string, d: DatosDevolucion) {
    return this.tenant.transaccion(async (tx) => {
      await this.visible(tx, id);
      await bloquear(tx, 'ChequeTercero', this.tenant.empresaId, [id]);
      const r = await this.cartera.cambiarEstado(tx, id, 'DEVUELTO', {}, { tipo: 'DEVOLUCION_CHEQUE', id, fecha: d.fecha });
      await this.auditoria.registrar(tx, { entidad: 'ChequeTercero', entidadId: id, accion: 'MODIFICAR', datos: { devolucion: d.observaciones ?? true } });
      return r;
    });
  }
}
