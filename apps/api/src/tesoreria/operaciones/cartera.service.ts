import { ConflictException, Injectable } from '@nestjs/common';
import type { ChequeTercero, EstadoCheque, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

/** Estados desde los que se puede pasar a cada estado. */
const DESDE: Record<EstadoCheque, EstadoCheque[]> = {
  EN_CARTERA: ['EN_TRANSITO', 'DEPOSITADO', 'ENDOSADO'],
  EN_TRANSITO: ['EN_CARTERA'],
  DEPOSITADO: ['EN_CARTERA'],
  ACREDITADO: ['DEPOSITADO'],
  ENDOSADO: ['EN_CARTERA'],
  RECHAZADO: ['DEPOSITADO', 'ACREDITADO', 'ENDOSADO'],
  DEVUELTO: ['RECHAZADO'],
  ANULADO: ['EN_CARTERA'],
};

export interface OrigenMovimientoCheque {
  tipo: string;
  id: string;
  fecha: Date;
}

export const noDisponible = (numero: string) => new ConflictException(`El cheque ${numero} ya no está disponible`);

/** Único punto que cambia el estado de un cheque de terceros; siempre deja registro en el historial. */
@Injectable()
export class CarteraService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly cls: ClsService,
  ) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  /** Registra en el historial el alta del cheque en cartera. */
  async alta(tx: TxEmpresa, cheque: ChequeTercero, origen: OrigenMovimientoCheque): Promise<void> {
    await tx.movimientoCheque.create({
      data: {
        empresaId: this.tenant.empresaId, chequeId: cheque.id, fecha: origen.fecha, estadoAnterior: null, estadoNuevo: cheque.estado,
        cajaId: cheque.cajaId, cuentaBancariaId: cheque.cuentaBancariaId, origenTipo: origen.tipo, origenId: origen.id, usuarioId: this.usuario(),
      },
    });
  }

  /**
   * Cambia el estado del cheque (que el llamador ya bloqueó). 409 si el estado actual no permite la transición.
   * `estadosDesde` restringe aún más los estados de partida admitidos.
   */
  async cambiarEstado(
    tx: TxEmpresa, chequeId: string, nuevo: EstadoCheque, datos: Prisma.ChequeTerceroUncheckedUpdateInput,
    origen: OrigenMovimientoCheque, estadosDesde?: EstadoCheque[],
  ): Promise<ChequeTercero> {
    const actual = await tx.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } });
    const permitidos = DESDE[nuevo].filter((e) => !estadosDesde || estadosDesde.includes(e));
    if (!permitidos.includes(actual.estado)) throw noDisponible(actual.numero);
    const cheque = await tx.chequeTercero.update({ where: { id: chequeId }, data: { ...datos, estado: nuevo } });
    await tx.movimientoCheque.create({
      data: {
        empresaId: this.tenant.empresaId, chequeId, fecha: origen.fecha, estadoAnterior: actual.estado, estadoNuevo: nuevo,
        cajaId: cheque.cajaId, cuentaBancariaId: cheque.cuentaBancariaId, origenTipo: origen.tipo, origenId: origen.id, usuarioId: this.usuario(),
      },
    });
    return cheque;
  }
}
