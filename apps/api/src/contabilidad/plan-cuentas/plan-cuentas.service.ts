import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CuentaContable, Prisma, TipoCuenta } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cargarPlanModelo, monetariaPorDefecto } from '../../seed/plan-cuentas-modelo';

export interface NodoCuenta {
  id: string;
  codigo: string;
  nombre: string;
  imputable: boolean;
  tipo: TipoCuenta;
  activa: boolean;
  monetaria: boolean;
  cuentaAjusteId: string | null;
  hijos: NodoCuenta[];
}

const CODIGO_DUPLICADO = 'Ya existe una cuenta con ese código';

/** Compara códigos jerárquicos numéricamente por segmento ('1.10' después de '1.9'). */
function compararCodigos(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

@Injectable()
export class PlanCuentasService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Carga el plan modelo en una empresa nueva. Recibe un cliente de transacción sin filtro de empresa. */
  cargarModelo(tx: Prisma.TransactionClient, empresaId: string): Promise<number> {
    return cargarPlanModelo(tx, empresaId);
  }

  async arbol(): Promise<NodoCuenta[]> {
    const cuentas = await this.tenant.db.cuentaContable.findMany();
    cuentas.sort((a, b) => compararCodigos(a.codigo, b.codigo));
    const nodos = new Map<string, NodoCuenta>();
    for (const c of cuentas)
      nodos.set(c.id, { id: c.id, codigo: c.codigo, nombre: c.nombre, imputable: c.imputable, tipo: c.tipo, activa: c.activa, monetaria: c.monetaria, cuentaAjusteId: c.cuentaAjusteId, hijos: [] });
    const raices: NodoCuenta[] = [];
    for (const c of cuentas) {
      const n = nodos.get(c.id)!;
      const p = c.padreId ? nodos.get(c.padreId) : undefined;
      (p ? p.hijos : raices).push(n);
    }
    return raices;
  }

  /** Lista plana de cuentas imputables activas (para selectores). */
  imputables() {
    return this.tenant.db.cuentaContable.findMany({
      where: { imputable: true, activa: true },
      orderBy: { codigo: 'asc' },
    });
  }

  crear(d: { codigo: string; nombre: string; padreId?: string | null; imputable: boolean; tipo?: TipoCuenta; monetaria?: boolean }) {
    return conUnicidad(CODIGO_DUPLICADO, () =>
      this.tenant.transaccion(async (tx) => {
        let tipo = d.tipo;
        let monetaria = d.monetaria;
        if (d.padreId) {
          const padre = await tx.cuentaContable.findUnique({ where: { id: d.padreId } });
          if (!padre) throw new NotFoundException('Cuenta padre no encontrada');
          if (padre.imputable) throw new BadRequestException('La cuenta padre no admite subcuentas');
          if (!d.codigo.startsWith(padre.codigo + '.'))
            throw new BadRequestException(`El código debe comenzar con ${padre.codigo}.`);
          tipo = padre.tipo;
          monetaria ??= padre.monetaria;
        } else if (d.codigo.includes('.')) {
          throw new BadRequestException('Una subcuenta debe indicar su cuenta padre');
        } else if (!tipo) {
          throw new BadRequestException('Debe indicar el tipo de la cuenta');
        }
        const cuenta = await tx.cuentaContable.create({
          data: { empresaId: this.tenant.empresaId, codigo: d.codigo, nombre: d.nombre, padreId: d.padreId ?? null, imputable: d.imputable, tipo: tipo!, monetaria: monetaria ?? monetariaPorDefecto(d.codigo, tipo!) },
        });
        await this.auditoria.registrar(tx, { entidad: 'CuentaContable', entidadId: cuenta.id, accion: 'CREAR', datos: d });
        return cuenta;
      }),
    );
  }

  modificar(id: string, d: { nombre?: string; imputable?: boolean; activa?: boolean; monetaria?: boolean; cuentaAjusteId?: string | null }): Promise<CuentaContable> {
    return this.tenant.transaccion(async (tx) => {
      const actual = await tx.cuentaContable.findUnique({ where: { id } });
      if (!actual) throw new NotFoundException('Cuenta no encontrada');
      const monetaria = d.monetaria ?? actual.monetaria;
      const cuentaAjusteId = d.cuentaAjusteId === undefined ? actual.cuentaAjusteId : d.cuentaAjusteId;
      if (cuentaAjusteId && monetaria) throw new BadRequestException('Solo las cuentas no monetarias tienen cuenta de ajuste');
      if (monetaria && !actual.monetaria) {
        const ajustada = await tx.cuentaContable.findFirst({ where: { cuentaAjusteId: id } });
        if (ajustada) throw new BadRequestException(`La cuenta ajusta a la cuenta ${ajustada.codigo}: no puede ser monetaria`);
      }
      if (d.cuentaAjusteId) await this.validarCuentaAjuste(tx, id, d.cuentaAjusteId);
      if (d.imputable) {
        const hijos = await tx.cuentaContable.count({ where: { padreId: id } });
        if (hijos) throw new BadRequestException('Una cuenta con subcuentas no puede ser imputable');
      }
      const cuenta = await tx.cuentaContable.update({ where: { id }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'CuentaContable', entidadId: id, accion: 'MODIFICAR', datos: d });
      return cuenta;
    });
  }

  /** Reglas de la cuenta de ajuste por inflación (spec §3), en orden. */
  private async validarCuentaAjuste(tx: TxEmpresa, id: string, ajusteId: string) {
    const a = await tx.cuentaContable.findUnique({ where: { id: ajusteId } });
    if (!a || !a.imputable || a.monetaria) throw new BadRequestException('La cuenta de ajuste debe ser imputable y no monetaria');
    const cuenta = await tx.cuentaContable.findUniqueOrThrow({ where: { id } });
    if (a.tipo !== cuenta.tipo) throw new BadRequestException('La cuenta de ajuste debe ser del mismo tipo que la cuenta');
    if (ajusteId === id) throw new BadRequestException('La cuenta de ajuste no puede ser la misma cuenta');
    const otra = await tx.cuentaContable.findFirst({ where: { cuentaAjusteId: ajusteId, id: { not: id } } });
    if (otra) throw new BadRequestException(`La cuenta de ajuste ya ajusta a la cuenta ${otra.codigo}`);
    const esAjusteDeOtra = await tx.cuentaContable.count({ where: { cuentaAjusteId: id } });
    if (a.cuentaAjusteId || esAjusteDeOtra) throw new BadRequestException('Una cuenta de ajuste no puede tener a su vez cuenta de ajuste');
  }

  /** Verifica que la cuenta exista en la empresa y sea imputable (para usar desde otros módulos). */
  async verificarImputable(tx: { cuentaContable: TenantPrisma['db']['cuentaContable'] }, id: string, campo = 'cuenta') {
    const c = await tx.cuentaContable.findUnique({ where: { id } });
    if (!c) throw new BadRequestException({ statusCode: 400, message: 'Cuenta contable inexistente', campos: { [campo]: 'Cuenta contable inexistente' } });
    if (!c.imputable) throw new BadRequestException({ statusCode: 400, message: 'La cuenta contable debe ser imputable', campos: { [campo]: 'La cuenta contable debe ser imputable' } });
  }
}
