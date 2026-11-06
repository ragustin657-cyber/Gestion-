import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { bloquear } from '../compras/comun';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { BancosService } from '../tesoreria/operaciones/bancos.service';
import { ConciliacionesService } from './conciliaciones.service';
import { DatosRegistro } from './dto';

/** Registra como movimiento bancario las líneas del extracto que el sistema no tiene, y las concilia. */
@Injectable()
export class RegistroService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly conciliaciones: ConciliacionesService,
    private readonly bancos: BancosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  registrar(id: string, d: DatosRegistro) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.conciliaciones.abierta(tx, id);
      const ids = d.lineas.map((l) => l.lineaId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay líneas repetidas');
      await bloquear(tx, 'LineaExtracto', this.tenant.empresaId, ids);
      for (const item of d.lineas) {
        const l = await tx.lineaExtracto.findUnique({ where: { id: item.lineaId } });
        if (!l || l.cuentaBancariaId !== c.cuentaBancariaId || l.fecha < c.desde || l.fecha > c.hasta) throw new BadRequestException('La línea no pertenece a esta conciliación');
        if (l.estado !== 'PENDIENTE') throw new ConflictException('La línea ya fue conciliada');
        const mov = await this.bancos.movimientoEnTx(tx, {
          fecha: l.fecha, cuentaBancariaId: c.cuentaBancariaId, tipo: l.importe.isNegative() ? 'GASTO' : 'INGRESO',
          cuentaContableId: item.cuentaContableId, concepto: item.concepto, importe: Number(l.importe.abs()),
        });
        const mt = await tx.movimientoTesoreria.findFirstOrThrow({ where: { origenTipo: 'MOVIMIENTO_BANCARIO', origenId: mov.id } });
        await this.conciliaciones.vincular(tx, c, [l.id], [mt.id], 'REGISTRO');
      }
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: id, accion: 'MODIFICAR', datos: { registradas: ids } });
      return { registradas: d.lineas.length };
    }, { timeout: 60000 });
  }
}
