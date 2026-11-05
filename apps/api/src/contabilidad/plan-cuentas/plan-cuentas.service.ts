import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CuentaContable, Prisma, TipoCuenta } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { cargarPlanModelo } from '../../seed/plan-cuentas-modelo';

export interface NodoCuenta {
  id: string;
  codigo: string;
  nombre: string;
  imputable: boolean;
  tipo: TipoCuenta;
  activa: boolean;
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
      nodos.set(c.id, { id: c.id, codigo: c.codigo, nombre: c.nombre, imputable: c.imputable, tipo: c.tipo, activa: c.activa, hijos: [] });
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

  crear(d: { codigo: string; nombre: string; padreId?: string | null; imputable: boolean; tipo?: TipoCuenta }) {
    return conUnicidad(CODIGO_DUPLICADO, () =>
      this.tenant.transaccion(async (tx) => {
        let tipo = d.tipo;
        if (d.padreId) {
          const padre = await tx.cuentaContable.findUnique({ where: { id: d.padreId } });
          if (!padre) throw new NotFoundException('Cuenta padre no encontrada');
          if (padre.imputable) throw new BadRequestException('La cuenta padre no admite subcuentas');
          if (!d.codigo.startsWith(padre.codigo + '.'))
            throw new BadRequestException(`El código debe comenzar con ${padre.codigo}.`);
          tipo = padre.tipo;
        } else if (d.codigo.includes('.')) {
          throw new BadRequestException('Una subcuenta debe indicar su cuenta padre');
        } else if (!tipo) {
          throw new BadRequestException('Debe indicar el tipo de la cuenta');
        }
        const cuenta = await tx.cuentaContable.create({
          data: { empresaId: this.tenant.empresaId, codigo: d.codigo, nombre: d.nombre, padreId: d.padreId ?? null, imputable: d.imputable, tipo: tipo! },
        });
        await this.auditoria.registrar(tx, { entidad: 'CuentaContable', entidadId: cuenta.id, accion: 'CREAR', datos: d });
        return cuenta;
      }),
    );
  }

  modificar(id: string, d: { nombre?: string; imputable?: boolean; activa?: boolean }): Promise<CuentaContable> {
    return this.tenant.transaccion(async (tx) => {
      if (d.imputable) {
        const hijos = await tx.cuentaContable.count({ where: { padreId: id } });
        if (hijos) throw new BadRequestException('Una cuenta con subcuentas no puede ser imputable');
      }
      const cuenta = await tx.cuentaContable.update({ where: { id }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'CuentaContable', entidadId: id, accion: 'MODIFICAR', datos: d });
      return cuenta;
    });
  }

  /** Verifica que la cuenta exista en la empresa y sea imputable (para usar desde otros módulos). */
  async verificarImputable(tx: { cuentaContable: TenantPrisma['db']['cuentaContable'] }, id: string, campo = 'cuenta') {
    const c = await tx.cuentaContable.findUnique({ where: { id } });
    if (!c) throw new BadRequestException({ statusCode: 400, message: 'Cuenta contable inexistente', campos: { [campo]: 'Cuenta contable inexistente' } });
    if (!c.imputable) throw new BadRequestException({ statusCode: 400, message: 'La cuenta contable debe ser imputable', campos: { [campo]: 'La cuenta contable debe ser imputable' } });
  }
}
