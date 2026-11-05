import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizarCuit } from '@gestion/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { conUnicidad } from '../comun/errores';
import { paginacion } from '../comun/paginado';
import { NumeracionService } from '../numeracion/numeracion.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { AltaTercero, IibbTercero, ModTercero } from './dto';

const CUIT_DUPLICADO = 'Ya existe un proveedor o cliente con ese CUIT';

export interface FiltroTerceros {
  tipo?: 'proveedor' | 'cliente';
  q?: string;
  activo?: string;
  pagina?: string;
  porPagina?: string;
}

@Injectable()
export class TercerosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly numeracion: NumeracionService,
  ) {}

  async listar(f: FiltroTerceros) {
    const q = f.q?.trim();
    const digitos = q ? normalizarCuit(q) : '';
    const where: Prisma.TerceroWhereInput = {
      esProveedor: f.tipo === 'proveedor' ? true : undefined,
      esCliente: f.tipo === 'cliente' ? true : undefined,
      activo: f.activo === undefined || f.activo === '' ? undefined : f.activo === 'true',
      OR: q
        ? [
            { razonSocial: { contains: q, mode: 'insensitive' } },
            { nombreFantasia: { contains: q, mode: 'insensitive' } },
            ...(digitos ? [{ cuit: { contains: digitos } }] : []),
            ...(/^\d{1,9}$/.test(q) ? [{ codigo: Number(q) }] : []),
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.tenant.db.tercero.findMany({ where, orderBy: { razonSocial: 'asc' }, ...paginacion(f) }),
      this.tenant.db.tercero.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string) {
    const t = await this.tenant.db.tercero.findUnique({
      where: { id },
      include: { iibb: { orderBy: { jurisdiccion: 'asc' } } },
    });
    if (!t) throw new NotFoundException('Proveedor o cliente no encontrado');
    return t;
  }

  crear(d: AltaTercero) {
    return conUnicidad(CUIT_DUPLICADO, () =>
      this.tenant.transaccion(async (tx) => {
        const codigo = await this.numeracion.siguiente(tx, 'TERCERO', 0);
        const t = await tx.tercero.create({
          data: { ...d, email: d.email || null, empresaId: this.tenant.empresaId, codigo },
        });
        await this.auditoria.registrar(tx, { entidad: 'Tercero', entidadId: t.id, accion: 'CREAR', datos: d });
        return t;
      }),
    );
  }

  modificar(id: string, d: ModTercero) {
    return conUnicidad(CUIT_DUPLICADO, () =>
      this.tenant.transaccion(async (tx) => {
        const t = await tx.tercero.update({
          where: { id },
          data: { ...d, email: d.email === '' ? null : d.email, diasPago: 'diasPago' in d ? (d.diasPago ?? 0) : undefined },
        });
        await this.auditoria.registrar(tx, { entidad: 'Tercero', entidadId: id, accion: 'MODIFICAR', datos: d });
        return t;
      }),
    );
  }

  reemplazarIibb(id: string, lista: IibbTercero) {
    return this.tenant.transaccion(async (tx) => {
      const t = await tx.tercero.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Proveedor o cliente no encontrado');
      await tx.terceroIibb.deleteMany({ where: { terceroId: id } });
      await tx.terceroIibb.createMany({
        data: lista.map((l) => ({ ...l, terceroId: id, empresaId: this.tenant.empresaId })),
      });
      await this.auditoria.registrar(tx, { entidad: 'Tercero', entidadId: id, accion: 'MODIFICAR', datos: { iibb: lista } });
      return tx.terceroIibb.findMany({ where: { terceroId: id }, orderBy: { jurisdiccion: 'asc' } });
    });
  }
}
