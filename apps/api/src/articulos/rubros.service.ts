import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { conUnicidad } from '../comun/errores';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { DatosEscalas, formatoEscalas, guardarEscalas } from '../ventas/precios/escalas';

const DUPLICADO = 'Ya existe un rubro con ese nombre';
export const RUBRO_INVALIDO = 'Rubro inexistente o inactivo';

/** E56: rubros de artículos. */
@Injectable()
export class RubrosArticulosService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}

  listar(activos?: boolean) {
    return this.tenant.db.rubroArticulo.findMany({ where: activos ? { activo: true } : {}, orderBy: { nombre: 'asc' } });
  }

  crear(d: { nombre: string }) {
    return conUnicidad(DUPLICADO, () => this.tenant.transaccion(async (tx) => {
      const r = await tx.rubroArticulo.create({ data: { empresaId: this.tenant.empresaId, nombre: d.nombre } });
      await this.auditoria.registrar(tx, { entidad: 'RubroArticulo', entidadId: r.id, accion: 'CREAR', datos: d });
      return r;
    }));
  }

  modificar(id: string, d: { nombre?: string; activo?: boolean }) {
    return conUnicidad(DUPLICADO, () => this.tenant.transaccion(async (tx) => {
      if (!(await tx.rubroArticulo.findUnique({ where: { id } }))) throw new NotFoundException('Rubro inexistente');
      const r = await tx.rubroArticulo.update({ where: { id }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'RubroArticulo', entidadId: id, accion: 'MODIFICAR', datos: d });
      return r;
    }));
  }

  async escalas(id: string) {
    if (!(await this.tenant.db.rubroArticulo.findUnique({ where: { id } }))) throw new NotFoundException('Rubro inexistente');
    return formatoEscalas(await this.tenant.db.escalaDescuento.findMany({ where: { rubroId: id } }));
  }

  guardarEscalas(id: string, d: DatosEscalas) {
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.rubroArticulo.findUnique({ where: { id } }))) throw new NotFoundException('Rubro inexistente');
      const r = await guardarEscalas(tx, this.tenant.empresaId, { rubroId: id }, d);
      await this.auditoria.registrar(tx, { entidad: 'RubroArticulo', entidadId: id, accion: 'MODIFICAR', datos: { escalas: d.escalas } });
      return r;
    });
  }
}

/** Rubro asignable a un artículo: activo, o el que el artículo ya tiene. */
export async function verificarRubro(tx: TxEmpresa, rubroId: string | null | undefined, actual?: string | null) {
  if (!rubroId || rubroId === actual) return;
  const r = await tx.rubroArticulo.findUnique({ where: { id: rubroId } });
  if (!r?.activo) throw new BadRequestException(RUBRO_INVALIDO);
}
