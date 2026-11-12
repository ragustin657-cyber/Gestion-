import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RubroBienUso } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { DatosRubro } from './dto';


@Injectable()
export class RubrosService {
  constructor(private readonly tenant: TenantPrisma) {}

  async listar() {
    const db = this.tenant.db;
    const rubros = await db.rubroBienUso.findMany({ orderBy: { nombre: 'asc' } });
    const cuentas = new Map((await db.cuentaContable.findMany({ where: { id: { in: rubros.flatMap((r) => [r.cuentaOrigenId, r.cuentaAmortizacionId, r.cuentaGastoId]) } }, select: { id: true, codigo: true, nombre: true } })).map((c) => [c.id, c]));
    return rubros.map((r) => ({ ...r, cuentaOrigen: cuentas.get(r.cuentaOrigenId), cuentaAmortizacion: cuentas.get(r.cuentaAmortizacionId), cuentaGasto: cuentas.get(r.cuentaGastoId) }));
  }

  /** Rubro activo cuya cuenta de valor de origen es la indicada. */
  rubroDeCuenta(tx: TxEmpresa, cuentaContableId: string): Promise<RubroBienUso | null> {
    return tx.rubroBienUso.findFirst({ where: { cuentaOrigenId: cuentaContableId, activo: true } });
  }

  private async validar(tx: TxEmpresa, d: DatosRubro, id?: string) {
    const ids = [d.cuentaOrigenId, d.cuentaAmortizacionId, d.cuentaGastoId];
    const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: ids } } });
    for (const cid of ids) {
      const c = cuentas.find((x) => x.id === cid);
      if (!c) throw new BadRequestException('Cuenta contable inexistente');
      if (!c.imputable) throw new BadRequestException(`La cuenta ${c.codigo} no es imputable`);
    }
    const otro = await tx.rubroBienUso.findFirst({ where: { cuentaOrigenId: d.cuentaOrigenId, ...(id ? { id: { not: id } } : {}) } });
    if (otro) throw new BadRequestException(`La cuenta ${cuentas.find((x) => x.id === d.cuentaOrigenId)!.codigo} ya es de otro rubro`);
    if (await tx.rubroBienUso.findFirst({ where: { nombre: d.nombre, ...(id ? { id: { not: id } } : {}) } })) throw new BadRequestException(`Ya existe el rubro ${d.nombre}`);
  }

  crear(d: DatosRubro) {
    return this.tenant.transaccion(async (tx) => {
      await this.validar(tx, d);
      return tx.rubroBienUso.create({ data: { ...d, empresaId: this.tenant.empresaId } });
    });
  }

  modificar(id: string, d: DatosRubro) {
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.rubroBienUso.findUnique({ where: { id } }))) throw new NotFoundException('Rubro inexistente');
      await this.validar(tx, d, id);
      return tx.rubroBienUso.update({ where: { id }, data: d });
    });
  }
}
