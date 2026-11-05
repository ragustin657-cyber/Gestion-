import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { bloquear, MODIFICADO } from '../../compras/comun';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { CarteraService } from '../../tesoreria/operaciones/cartera.service';
import { OrdenesPagoService } from './ordenes-pago.service';

/** Anulación de órdenes de pago: las no pagadas cambian de estado; las pagadas se revierten por completo. */
@Injectable()
export class AnulacionPagoService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly ordenes: OrdenesPagoService,
    private readonly asientos: AsientosService,
    private readonly auditoria: AuditoriaService,
    private readonly cartera: CarteraService,
  ) {}

  async anular(id: string, version: number, motivo: string) {
    const op = await this.tenant.db.ordenPago.findUnique({ where: { id } });
    if (!op) throw new NotFoundException('Orden de pago no encontrada');
    if (op.estado === 'ANULADA') throw new ConflictException('La orden de pago ya está anulada');
    if (op.estado !== 'PAGADA') return this.ordenes.anularNoPagada(id, version, motivo);

    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      await bloquear(tx, 'OrdenPago', empresaId, [id]);
      const actual = await tx.ordenPago.findUniqueOrThrow({ where: { id } });
      if (actual.estado === 'ANULADA') throw new ConflictException('La orden de pago ya está anulada');
      if (actual.version !== version) throw new ConflictException(MODIFICADO);

      // Bloqueo en un solo paso (ordenado) del anticipo generado y de los movimientos aplicados
      const anticipoId = (await tx.movimientoCuentaCorriente.findFirst({ where: { origenTipo: 'ANTICIPO', origenId: id, anulado: false }, select: { id: true } }))?.id;
      const aplicaciones = await tx.aplicacionCuentaCorriente.findMany({ where: { origenTipo: 'OP', origenId: id, anulada: false } });
      await bloquear(tx, 'MovimientoCuentaCorriente', empresaId, [...aplicaciones.map((a) => a.movimientoId), ...(anticipoId ? [anticipoId] : [])]);

      // El anticipo generado por esta OP no puede estar aplicado (se relee con la fila bloqueada)
      const anticipo = anticipoId ? await tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: anticipoId } }) : null;
      if (anticipo && !anticipo.saldo.eq(anticipo.importe)) throw new BadRequestException('El anticipo de esta orden ya fue aplicado');
      if (anticipo) await tx.movimientoCuentaCorriente.update({ where: { id: anticipo.id }, data: { anulado: true, saldo: 0, saldoPesos: 0 } });

      // Restaurar saldos de lo cancelado
      for (const a of aplicaciones) {
        await tx.movimientoCuentaCorriente.update({ where: { id: a.movimientoId }, data: { saldo: { increment: a.importe }, saldoPesos: { increment: a.importePesosHistorico } } });
        await tx.aplicacionCuentaCorriente.update({ where: { id: a.id }, data: { anulada: true } });
      }

      await tx.chequePropio.updateMany({ where: { ordenPagoId: id }, data: { estado: 'ANULADO' } });
      await tx.movimientoTesoreria.updateMany({ where: { origenTipo: 'OP', origenId: id }, data: { anulado: true } });
      await tx.ordenPagoRetencion.updateMany({ where: { ordenPagoId: id }, data: { anulada: true } });

      const fecha = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
      // Cheques de terceros endosados: vuelven a cartera en su caja original
      const endosos = await tx.ordenPagoMedio.findMany({ where: { ordenPagoId: id, tipo: 'CHEQUE_TERCERO' } });
      await bloquear(tx, 'ChequeTercero', empresaId, endosos.map((m) => m.chequeTerceroId!));
      for (const m of endosos) {
        const ch = await tx.chequeTercero.findUniqueOrThrow({ where: { id: m.chequeTerceroId! } });
        if (ch.estado !== 'ENDOSADO') throw new BadRequestException(`El cheque de terceros ${ch.numero} de esta orden ya fue rechazado o devuelto`);
        await this.cartera.cambiarEstado(tx, ch.id, 'EN_CARTERA', { cajaId: m.cajaId, terceroDestinoId: null }, { tipo: 'ANULACION_OP', id, fecha }, ['ENDOSADO']);
      }
      const contra = actual.asientoId ? await this.asientos.contraasiento(tx, actual.asientoId, fecha, `Anulación OP: ${motivo}`) : null;
      await tx.ordenPago.update({
        where: { id },
        data: { estado: 'ANULADA', motivoAnulacion: motivo, asientoAnulacionId: contra?.id ?? null, version: { increment: 1 } },
      });
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'ANULAR', datos: { motivo, pagada: true } });
      return this.ordenes.obtener(id, tx);
    });
  }
}
