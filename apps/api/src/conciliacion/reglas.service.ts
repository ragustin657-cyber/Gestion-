import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PlanCuentasService } from '../contabilidad/plan-cuentas/plan-cuentas.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../tesoreria/sucursales/alcance.service';
import { DatosRegla } from './dto';

@Injectable()
export class ReglasService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly plan: PlanCuentasService,
    private readonly alcance: AlcanceSucursalService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Reglas ordenadas por prioridad, con la cuenta contable legible ("5.2.05 Impuesto…"). */
  async listar(tx: TxEmpresa = this.tenant.db) {
    if (this.alcance.sucursalUsuario()) return [];
    const reglas = await tx.reglaConciliacion.findMany({ orderBy: [{ prioridad: 'asc' }, { texto: 'asc' }] });
    const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: reglas.map((r) => r.cuentaContableId) } } });
    return reglas.map((r) => {
      const c = cuentas.find((x) => x.id === r.cuentaContableId);
      return { ...r, cuenta: c ? `${c.codigo} ${c.nombre}` : '' };
    });
  }

  private async validar(tx: TxEmpresa, d: Partial<DatosRegla>) {
    if (this.alcance.sucursalUsuario()) throw new NotFoundException('Regla no encontrada');
    if (d.cuentaContableId) await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
    if (d.cuentaBancariaId && !(await tx.cuentaBancaria.findUnique({ where: { id: d.cuentaBancariaId } }))) throw new NotFoundException('Cuenta bancaria no encontrada');
  }

  crear(d: DatosRegla) {
    return this.tenant.transaccion(async (tx) => {
      await this.validar(tx, d);
      const r = await tx.reglaConciliacion.create({ data: { ...d, cuentaBancariaId: d.cuentaBancariaId ?? null, concepto: d.concepto || null, empresaId: this.tenant.empresaId } });
      await this.auditoria.registrar(tx, { entidad: 'ReglaConciliacion', entidadId: r.id, accion: 'CREAR', datos: d });
      return r;
    });
  }

  modificar(id: string, d: Partial<DatosRegla>) {
    return this.tenant.transaccion(async (tx) => {
      await this.validar(tx, d);
      const r = await tx.reglaConciliacion.update({ where: { id }, data: { ...d, concepto: d.concepto === undefined ? undefined : d.concepto || null } });
      await this.auditoria.registrar(tx, { entidad: 'ReglaConciliacion', entidadId: id, accion: 'MODIFICAR', datos: d });
      return r;
    });
  }
}
