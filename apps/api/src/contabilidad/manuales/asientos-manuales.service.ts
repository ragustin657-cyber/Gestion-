import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear, MODIFICADO } from '../../compras/comun';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AsientosService } from '../asientos/asientos.service';
import { periodoAbierto } from '../periodos/control';
import { DatosAsientoManual } from './dto';

const AUTOMATICO = 'Los asientos automáticos se anulan desde su comprobante';
const renglones = (d: DatosAsientoManual) =>
  d.renglones.map((r) => ({ cuentaContableId: r.cuentaContableId, centroCostoId: r.centroCostoId ?? null, debe: String(r.debe ?? 0), haber: String(r.haber ?? 0), detalle: r.detalle ?? undefined }));

@Injectable()
export class AsientosManualesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly asientos: AsientosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private obtener(tx: TxEmpresa, id: string) {
    return tx.asiento.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
  }

  /** Asiento manual bloqueado; 404 si no existe, 400 si es automático. */
  private async manual(tx: TxEmpresa, id: string) {
    const a = await tx.asiento.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Asiento no encontrado');
    if (a.tipo !== 'MANUAL') throw new BadRequestException(AUTOMATICO);
    await bloquear(tx, 'Asiento', this.tenant.empresaId, [id]);
    return tx.asiento.findUniqueOrThrow({ where: { id } });
  }

  crear(d: DatosAsientoManual) {
    return this.tenant.transaccion(async (tx) => {
      const id = randomUUID();
      await this.asientos.generar(tx, { id, fecha: d.fecha, descripcion: d.descripcion, origenTipo: 'MANUAL', origenId: id, tipo: 'MANUAL', renglones: renglones(d) });
      return this.obtener(tx, id);
    });
  }

  modificar(id: string, version: number, d: DatosAsientoManual) {
    return this.tenant.transaccion(async (tx) => {
      const a = await this.manual(tx, id);
      if (a.version !== version) throw new ConflictException(MODIFICADO);
      await periodoAbierto(tx, this.tenant.empresaId, a.fecha);
      const { ejercicio } = await periodoAbierto(tx, this.tenant.empresaId, d.fecha);
      const nuevos = await this.asientos.validarRenglones(tx, renglones(d));
      await tx.asientoRenglon.deleteMany({ where: { asientoId: id } });
      await tx.asientoRenglon.createMany({ data: nuevos.map((r) => ({ ...r, empresaId: this.tenant.empresaId, asientoId: id })) });
      await tx.asiento.update({ where: { id }, data: { fecha: d.fecha, descripcion: d.descripcion, ejercicioId: ejercicio.id, version: { increment: 1 } } });
      await this.auditoria.registrar(tx, { entidad: 'Asiento', entidadId: id, accion: 'MODIFICAR', datos: { fecha: d.fecha, descripcion: d.descripcion, renglones: d.renglones } });
      return this.obtener(tx, id);
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const a = await this.manual(tx, id);
      await periodoAbierto(tx, this.tenant.empresaId, a.fecha);
      if (await tx.asiento.count({ where: { anulaAId: id } })) throw new BadRequestException('El asiento tiene un contraasiento: no se puede eliminar');
      const previo = await this.obtener(tx, id);
      await tx.asientoRenglon.deleteMany({ where: { asientoId: id } });
      await tx.asiento.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'Asiento', entidadId: id, accion: 'ELIMINAR', datos: previo });
      return { ok: true };
    });
  }

  anular(id: string, fecha: Date, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const a = await this.manual(tx, id);
      if (a.anulaAId) throw new BadRequestException('Un contraasiento no se anula: registre un asiento nuevo');
      if (await tx.asiento.count({ where: { anulaAId: id } })) throw new ConflictException('El asiento ya fue anulado');
      const r = await this.asientos.contraasiento(tx, id, fecha, `Anulación del asiento ${a.numeroDefinitivo ?? a.numero}: ${motivo}`);
      await this.auditoria.registrar(tx, { entidad: 'Asiento', entidadId: id, accion: 'ANULAR', datos: { motivo, contraasiento: r.id } });
      return this.obtener(tx, r.id);
    });
  }
}
