import { BadRequestException, Injectable } from '@nestjs/common';
import { ModoTresVias, Prisma } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { PlanCuentasService } from '../../contabilidad/plan-cuentas/plan-cuentas.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ConceptoCuenta } from './conceptos';

export interface ParametrosCompras {
  montoAprobacionOc: Prisma.Decimal;
  toleranciaPrecioPct: Prisma.Decimal;
  toleranciaCantidadPct: Prisma.Decimal;
  modoTresVias: ModoTresVias;
}

@Injectable()
export class ConfigComprasService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly plan: PlanCuentasService,
  ) {}

  /** Cuenta contable configurada para un concepto; 400 si falta. */
  async cuenta(tx: TxEmpresa, concepto: ConceptoCuenta): Promise<string> {
    const c = await tx.configCuenta.findUnique({ where: { empresaId_concepto: { empresaId: this.tenant.empresaId, concepto } } });
    if (!c) throw new BadRequestException(`Falta configurar la cuenta contable para ${concepto}`);
    return c.cuentaContableId;
  }

  async parametros(tx: TxEmpresa): Promise<ParametrosCompras> {
    const e = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return {
      montoAprobacionOc: e.montoAprobacionOc,
      toleranciaPrecioPct: e.toleranciaPrecioPct,
      toleranciaCantidadPct: e.toleranciaCantidadPct,
      modoTresVias: e.modoTresVias,
    };
  }

  async obtener() {
    const p = await this.parametros(this.tenant.db);
    const cuentas = await this.tenant.db.configCuenta.findMany({ select: { concepto: true, cuentaContableId: true }, orderBy: { concepto: 'asc' } });
    return { ...p, cuentas };
  }

  modificar(d: Partial<{ montoAprobacionOc: number; toleranciaPrecioPct: number; toleranciaCantidadPct: number; modoTresVias: ModoTresVias }>) {
    return this.tenant.transaccion(async (tx) => {
      await tx.empresa.update({ where: { id: this.tenant.empresaId }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'ConfigCompras', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: d });
      return this.parametros(tx);
    });
  }

  reemplazarCuentas(lista: { concepto: ConceptoCuenta; cuentaContableId: string }[]) {
    return this.tenant.transaccion(async (tx) => {
      for (const l of lista) {
        await this.plan.verificarImputable(tx, l.cuentaContableId, 'cuentaContableId');
        await tx.configCuenta.upsert({
          where: { empresaId_concepto: { empresaId: this.tenant.empresaId, concepto: l.concepto } },
          create: { empresaId: this.tenant.empresaId, ...l },
          update: { cuentaContableId: l.cuentaContableId },
        });
      }
      await this.auditoria.registrar(tx, { entidad: 'ConfigCompras', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: { cuentas: lista } });
      return tx.configCuenta.findMany({ select: { concepto: true, cuentaContableId: true }, orderBy: { concepto: 'asc' } });
    });
  }
}
