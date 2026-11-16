import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

export interface DatosTarjeta { nombre: string; tipo: 'CREDITO' | 'DEBITO' | 'QR'; cuentaBancariaId: string; cuentaContableId?: string | null; activa?: boolean }

/** Tarjetas, cupones y liquidaciones (spec E23). */
@Injectable()
export class TarjetasService {
  constructor(private readonly tenant: TenantPrisma, private readonly config: ConfigComprasService) {}

  listar() {
    return this.tenant.db.tarjeta.findMany({ orderBy: { nombre: 'asc' } });
  }

  private async validar(tx: TxEmpresa, d: DatosTarjeta, id?: string) {
    const cb = await tx.cuentaBancaria.findUnique({ where: { id: d.cuentaBancariaId } });
    if (!cb) throw new BadRequestException('Cuenta bancaria inexistente');
    if (cb.monedaCodigo !== 'ARS') throw new BadRequestException('La cuenta bancaria debe ser en pesos');
    if (await tx.tarjeta.findFirst({ where: { nombre: d.nombre, id: id ? { not: id } : undefined } })) throw new BadRequestException(`Ya existe la tarjeta ${d.nombre}`);
    const cuentaContableId = d.cuentaContableId ?? (await this.config.cuenta(tx, 'TARJETAS_A_COBRAR'));
    const c = await tx.cuentaContable.findUnique({ where: { id: cuentaContableId } });
    if (!c || !c.imputable || !c.activa) throw new BadRequestException('Cuenta contable inválida: debe ser imputable y activa');
    return cuentaContableId;
  }

  crear(d: DatosTarjeta) {
    return this.tenant.transaccion(async (tx) => {
      const cuentaContableId = await this.validar(tx, d);
      return tx.tarjeta.create({ data: { empresaId: this.tenant.empresaId, nombre: d.nombre, tipo: d.tipo, cuentaBancariaId: d.cuentaBancariaId, cuentaContableId, activa: d.activa ?? true } });
    });
  }

  modificar(id: string, d: DatosTarjeta) {
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.tarjeta.findUnique({ where: { id } }))) throw new NotFoundException('Tarjeta inexistente');
      const cuentaContableId = await this.validar(tx, d, id);
      return tx.tarjeta.update({ where: { id }, data: { nombre: d.nombre, tipo: d.tipo, cuentaBancariaId: d.cuentaBancariaId, cuentaContableId, activa: d.activa ?? true } });
    });
  }
}
