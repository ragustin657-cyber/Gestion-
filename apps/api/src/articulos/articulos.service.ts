import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { conUnicidad } from '../comun/errores';
import { paginacion } from '../comun/paginado';
import { PlanCuentasService } from '../contabilidad/plan-cuentas/plan-cuentas.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { bloquear } from '../compras/comun';
import { formatoEscalas, guardarEscalas, type DatosEscalas } from '../ventas/precios/escalas';
import { verificarRubro } from './rubros.service';

export interface DatosArticulo {
  codigo: string;
  descripcion: string;
  unidad?: string;
  alicuotaIva: number;
  cuentaCompraId?: string | null;
  cuentaVentaId?: string | null;
  esServicio?: boolean;
  activo?: boolean;
  controlaStock?: boolean;
  rubroId?: string | null;
  codigoNomencladorArba?: string | null;
  unidadMedidaArba?: string | null;
}

const DUPLICADO = 'Ya existe un artículo con ese código';

@Injectable()
export class ArticulosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly plan: PlanCuentasService,
  ) {}

  async listar(f: { q?: string; activo?: string; pagina?: string; porPagina?: string; rubroId?: string }) {
    const q = f.q?.trim();
    const where: Prisma.ArticuloWhereInput = {
      activo: f.activo ? f.activo === 'true' : undefined,
      rubroId: f.rubroId || undefined,
      OR: q
        ? [{ codigo: { contains: q, mode: 'insensitive' } }, { descripcion: { contains: q, mode: 'insensitive' } }]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.tenant.db.articulo.findMany({ where, orderBy: { codigo: 'asc' }, ...paginacion(f) }),
      this.tenant.db.articulo.count({ where }),
    ]);
    const rubros = new Map((await this.tenant.db.rubroArticulo.findMany({ where: { id: { in: items.map((i) => i.rubroId).filter((x): x is string => !!x) } } })).map((r) => [r.id, r.nombre]));
    return { items: items.map((i) => ({ ...i, rubro: i.rubroId ? (rubros.get(i.rubroId) ?? null) : null })), total };
  }

  obtener(id: string) {
    return this.tenant.db.articulo.findUniqueOrThrow({ where: { id } });
  }

  private async verificarCuentas(tx: TxEmpresa, d: Partial<DatosArticulo>) {
    if (d.cuentaCompraId) await this.plan.verificarImputable(tx, d.cuentaCompraId, 'cuentaCompraId');
    if (d.cuentaVentaId) await this.plan.verificarImputable(tx, d.cuentaVentaId, 'cuentaVentaId');
  }

  crear(d: DatosArticulo) {
    return conUnicidad(DUPLICADO, () =>
      this.tenant.transaccion(async (tx) => {
        await this.verificarCuentas(tx, d);
        await verificarRubro(tx, d.rubroId);
        if (d.esServicio && d.controlaStock) throw new BadRequestException('Un servicio no controla stock');
        const a = await tx.articulo.create({ data: { ...d, empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'Articulo', entidadId: a.id, accion: 'CREAR', datos: d });
        return a;
      }),
    );
  }

  modificar(id: string, d: Partial<DatosArticulo>) {
    return conUnicidad(DUPLICADO, () =>
      this.tenant.transaccion(async (tx) => {
        await this.verificarCuentas(tx, d);
        await bloquear(tx, 'Articulo', this.tenant.empresaId, [id]);
        const actual = await tx.articulo.findUniqueOrThrow({ where: { id } });
        await verificarRubro(tx, d.rubroId, actual.rubroId);
        const controla = d.controlaStock ?? actual.controlaStock;
        if ((d.esServicio ?? actual.esServicio) && controla) throw new BadRequestException('Un servicio no controla stock');
        if (actual.controlaStock && !controla && (await tx.movimientoStock.count({ where: { articuloId: id } })))
          throw new BadRequestException('El artículo tiene movimientos de stock');
        const a = await tx.articulo.update({ where: { id }, data: d });
        await this.auditoria.registrar(tx, { entidad: 'Articulo', entidadId: id, accion: 'MODIFICAR', datos: d });
        return a;
      }),
    );
  }

  /** E56: escalas de descuento propias del artículo. */
  async escalas(id: string) {
    await this.tenant.db.articulo.findUniqueOrThrow({ where: { id } });
    return formatoEscalas(await this.tenant.db.escalaDescuento.findMany({ where: { articuloId: id } }));
  }

  guardarEscalas(id: string, d: DatosEscalas) {
    return this.tenant.transaccion(async (tx) => {
      await tx.articulo.findUniqueOrThrow({ where: { id } });
      const r = await guardarEscalas(tx, this.tenant.empresaId, { articuloId: id }, d);
      await this.auditoria.registrar(tx, { entidad: 'Articulo', entidadId: id, accion: 'MODIFICAR', datos: { escalas: d.escalas } });
      return r;
    });
  }
}
