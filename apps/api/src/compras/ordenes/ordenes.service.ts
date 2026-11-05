import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoOC, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { calcularTotales, importeRenglon } from '@gestion/shared';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { paginacion } from '../../comun/paginado';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { MonedasService } from '../../monedas/monedas.service';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { errorTransicion } from '../comun';
import { ConfigComprasService } from '../config/config-compras.service';
import { DatosOC } from './dto';

const D = Prisma.Decimal;
const INCLUIR = {
  renglones: { orderBy: { orden: 'asc' as const } },
  tercero: { select: { id: true, razonSocial: true, cuit: true } },
};

export interface FiltroOC {
  terceroId?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  pagina?: string;
  porPagina?: string;
}

@Injectable()
export class OrdenesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly numeracion: NumeracionService,
    private readonly monedas: MonedasService,
    private readonly config: ConfigComprasService,
    private readonly cls: ClsService,
  ) {}

  private get ctx() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO);
  }

  async listar(f: FiltroOC) {
    const where: Prisma.OrdenCompraWhereInput = {
      terceroId: f.terceroId || undefined,
      estado: f.estado && f.estado in EstadoOC ? (f.estado as EstadoOC) : undefined,
      fecha: { gte: f.desde ? new Date(`${f.desde}T00:00:00Z`) : undefined, lte: f.hasta ? new Date(`${f.hasta}T00:00:00Z`) : undefined },
    };
    const [items, total] = await Promise.all([
      this.tenant.db.ordenCompra.findMany({
        where, include: { tercero: { select: { razonSocial: true } } },
        orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }], ...paginacion(f),
      }),
      this.tenant.db.ordenCompra.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const oc = await tx.ordenCompra.findUnique({ where: { id }, include: INCLUIR });
    if (!oc) throw new NotFoundException('Orden de compra no encontrada');
    return {
      ...oc,
      renglones: oc.renglones.map((r) => ({ ...r, pendiente: r.cantidad.minus(r.cantidadRecibida) })),
    };
  }

  /** Valida el proveedor y arma renglones y totales calculados en el servidor. */
  private async preparar(tx: TxEmpresa, d: DatosOC) {
    const t = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!t || !t.esProveedor || !t.activo) throw new BadRequestException('El tercero no es un proveedor activo');
    const renglones = d.renglones.map((r, i) => ({
      orden: i + 1, articuloId: r.articuloId ?? null, descripcion: r.descripcion, cantidad: r.cantidad,
      precioUnitario: r.precioUnitario, bonificacionPct: r.bonificacionPct, alicuotaIva: r.alicuotaIva,
      centroCostoId: r.centroCostoId ?? null, importe: importeRenglon(r),
    }));
    const tot = calcularTotales({ discriminaIva: true, renglones: renglones.map((r) => ({ importe: r.importe, alicuotaIva: r.alicuotaIva })) });
    return {
      cabecera: {
        terceroId: d.terceroId, fecha: d.fecha, fechaEntrega: d.fechaEntrega ?? null, depositoId: d.depositoId ?? null,
        monedaCodigo: d.monedaCodigo, diasPago: d.diasPago ?? t.diasPago, observaciones: d.observaciones ?? null,
        neto: tot.netoGravado, iva: tot.iva, total: tot.total,
      },
      renglones,
    };
  }

  crear(d: DatosOC) {
    return this.tenant.transaccion(async (tx) => {
      const { cabecera, renglones } = await this.preparar(tx, d);
      const oc = await tx.ordenCompra.create({
        data: {
          ...cabecera, empresaId: this.tenant.empresaId, creadoPor: this.ctx.usuarioId,
          renglones: { create: renglones.map((r) => ({ ...r, empresaId: this.tenant.empresaId })) },
        },
      });
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: oc.id, accion: 'CREAR' });
      return this.obtener(oc.id, tx);
    });
  }

  modificar(id: string, d: DatosOC) {
    return this.tenant.transaccion(async (tx) => {
      const actual = await this.obtener(id, tx);
      if (actual.estado !== 'BORRADOR') throw new BadRequestException('Solo se pueden modificar órdenes en borrador');
      const { cabecera, renglones } = await this.preparar(tx, d);
      await tx.ordenCompraRenglon.deleteMany({ where: { ordenCompraId: id } });
      await tx.ordenCompraRenglon.createMany({ data: renglones.map((r) => ({ ...r, empresaId: this.tenant.empresaId, ordenCompraId: id })) });
      await tx.ordenCompra.update({ where: { id }, data: { ...cabecera, version: { increment: 1 } } });
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'MODIFICAR' });
      return this.obtener(id, tx);
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const actual = await this.obtener(id, tx);
      if (actual.estado !== 'BORRADOR') throw new BadRequestException('Solo se pueden eliminar órdenes en borrador');
      await tx.ordenCompraRenglon.deleteMany({ where: { ordenCompraId: id } });
      await tx.ordenCompra.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'ELIMINAR' });
      return { ok: true };
    });
  }

  /** Cambia el estado con bloqueo optimista (version) verificando el estado de origen. */
  private async transicion(tx: TxEmpresa, id: string, version: number, desde: EstadoOC[], data: Prisma.OrdenCompraUpdateManyMutationInput, mensaje: string) {
    const r = await tx.ordenCompra.updateMany({ where: { id, version, estado: { in: desde } }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) errorTransicion(await tx.ordenCompra.findUnique({ where: { id }, select: { version: true } }), version, mensaje);
  }

  confirmar(id: string, version: number) {
    return this.tenant.transaccion(async (tx) => {
      const oc = await this.obtener(id, tx);
      const cotizacion = await this.monedas.cotizacion(oc.monedaCodigo, oc.fecha);
      const totalPesos = oc.total.mul(cotizacion).toDecimalPlaces(2);
      const { montoAprobacionOc } = await this.config.parametros(tx);
      const automatica = montoAprobacionOc.gt(0) && totalPesos.lte(montoAprobacionOc);
      const numero = await this.numeracion.siguiente(tx, 'OC', 1);
      await this.transicion(tx, id, version, ['BORRADOR'], {
        numero, cotizacion, totalPesos,
        estado: automatica ? 'APROBADA' : 'PENDIENTE_APROBACION',
        aprobadoPor: null, aprobadoEn: automatica ? new Date() : null, motivoRechazo: null,
      }, 'Solo se pueden confirmar órdenes en borrador');
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'MODIFICAR', datos: { confirmada: true, numero } });
      if (automatica)
        await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'APROBAR', datos: { automatica: true, totalPesos: totalPesos.toString() } });
      return this.obtener(id, tx);
    });
  }

  aprobar(id: string, version: number) {
    return this.tenant.transaccion(async (tx) => {
      const oc = await this.obtener(id, tx);
      let autoaprobacion = false;
      if (oc.creadoPor === this.ctx.usuarioId) {
        const otros = await tx.usuarioEmpresa.count({
          where: {
            activo: true, usuarioId: { not: this.ctx.usuarioId }, usuario: { activo: true },
            OR: [{ rol: { permisos: { has: 'oc.aprobar' } } }, { usuario: { superadmin: true } }],
          },
        });
        if (otros) throw new ForbiddenException('No puede aprobar una orden creada por usted');
        autoaprobacion = true;
      }
      await this.transicion(tx, id, version, ['PENDIENTE_APROBACION'], {
        estado: 'APROBADA', aprobadoPor: this.ctx.usuarioId, aprobadoEn: new Date(),
      }, 'La orden no está pendiente de aprobación');
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'APROBAR', datos: autoaprobacion ? { autoaprobacion } : undefined });
      return this.obtener(id, tx);
    });
  }

  rechazar(id: string, version: number, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.transicion(tx, id, version, ['PENDIENTE_APROBACION'], { estado: 'BORRADOR', motivoRechazo: motivo }, 'La orden no está pendiente de aprobación');
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'MODIFICAR', datos: { rechazo: motivo } });
      return this.obtener(id, tx);
    });
  }

  anular(id: string, version: number, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const oc = await this.obtener(id, tx);
      if (oc.estado === 'BORRADOR') throw new BadRequestException('Los borradores se eliminan, no se anulan');
      if (oc.renglones.some((r) => r.cantidadRecibida.gt(0) || r.cantidadFacturada.gt(0)))
        throw new BadRequestException('La orden tiene recepciones o facturas: no se puede anular');
      await this.transicion(tx, id, version, ['PENDIENTE_APROBACION', 'APROBADA'], { estado: 'ANULADA', motivoAnulacion: motivo }, 'La orden no se puede anular en su estado actual');
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }

  cerrar(id: string, version: number, motivo?: string | null) {
    return this.tenant.transaccion(async (tx) => {
      await this.transicion(tx, id, version, ['APROBADA', 'PARCIALMENTE_RECIBIDA'], { estado: 'CUMPLIDA' }, 'Solo se pueden cerrar órdenes aprobadas o parcialmente recibidas');
      await this.auditoria.registrar(tx, { entidad: 'OrdenCompra', entidadId: id, accion: 'MODIFICAR', datos: { cierre: true, motivo } });
      return this.obtener(id, tx);
    });
  }

  /** Recalcula el estado según lo recibido (usado por recepciones y sus anulaciones). */
  async recalcularEstado(tx: TxEmpresa, ordenCompraId: string): Promise<void> {
    const oc = await tx.ordenCompra.findUnique({ where: { id: ordenCompraId }, include: { renglones: true } });
    if (!oc || !['APROBADA', 'PARCIALMENTE_RECIBIDA', 'CUMPLIDA'].includes(oc.estado)) return;
    const todo = oc.renglones.every((r) => r.cantidadRecibida.gte(r.cantidad));
    const algo = oc.renglones.some((r) => r.cantidadRecibida.gt(0));
    const estado: EstadoOC = todo ? 'CUMPLIDA' : algo ? 'PARCIALMENTE_RECIBIDA' : 'APROBADA';
    if (estado !== oc.estado) await tx.ordenCompra.update({ where: { id: oc.id }, data: { estado, version: { increment: 1 } } });
  }
}

export { D };
