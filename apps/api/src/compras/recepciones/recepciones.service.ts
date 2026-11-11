import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { paginacion } from '../../comun/paginado';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { bloquear } from '../comun';
import { OrdenesService } from '../ordenes/ordenes.service';
import { DatosIR } from './dto';
import { ComprasStock } from '../../stock/compras-stock';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';

const D = Prisma.Decimal;

@Injectable()
export class RecepcionesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly numeracion: NumeracionService,
    private readonly ordenes: OrdenesService,
    private readonly cls: ClsService,
    private readonly stock: ComprasStock,
  ) {}

  async listar(f: { terceroId?: string; desde?: string; hasta?: string; pagina?: string; porPagina?: string }) {
    const where: Prisma.InformeRecepcionWhereInput = {
      terceroId: f.terceroId || undefined,
      fecha: { gte: f.desde ? new Date(`${f.desde}T00:00:00Z`) : undefined, lte: f.hasta ? new Date(`${f.hasta}T00:00:00Z`) : undefined },
    };
    const [items, total] = await Promise.all([
      this.tenant.db.informeRecepcion.findMany({ where, include: { tercero: { select: { razonSocial: true } } }, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(f) }),
      this.tenant.db.informeRecepcion.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const ir = await tx.informeRecepcion.findUnique({
      where: { id },
      include: {
        tercero: { select: { id: true, razonSocial: true, cuit: true } },
        renglones: { include: { ordenCompraRenglon: { include: { ordenCompra: { select: { id: true, numero: true } } } } } },
      },
    });
    if (!ir) throw new NotFoundException('Recepción no encontrada');
    return ir;
  }

  crear(d: DatosIR) {
    return conUnicidad('Ese remito ya fue registrado', () =>
      this.tenant.transaccion(async (tx) => {
        const ids = d.renglones.map((r) => r.ordenCompraRenglonId);
        await bloquear(tx, 'OrdenCompraRenglon', this.tenant.empresaId, ids);
        const renglonesOc = await tx.ordenCompraRenglon.findMany({ where: { id: { in: ids } }, include: { ordenCompra: true } });
        // Sumar cantidades por renglón de OC (puede repetirse en el pedido)
        const porRenglon = new Map<string, Prisma.Decimal>();
        for (const r of d.renglones) porRenglon.set(r.ordenCompraRenglonId, (porRenglon.get(r.ordenCompraRenglonId) ?? new D(0)).plus(r.cantidad));
        for (const [id, cantidad] of porRenglon) {
          const ro = renglonesOc.find((x) => x.id === id);
          if (!ro) throw new NotFoundException('Renglón de orden de compra no encontrado');
          if (ro.ordenCompra.terceroId !== d.terceroId) throw new BadRequestException('Todos los renglones deben ser del proveedor indicado');
          if (!['APROBADA', 'PARCIALMENTE_RECIBIDA'].includes(ro.ordenCompra.estado)) throw new BadRequestException('La orden de compra no está aprobada');
          const pendiente = ro.cantidad.minus(ro.cantidadRecibida);
          if (cantidad.gt(pendiente))
            throw new BadRequestException(`La cantidad recibida (${cantidad.toString()}) supera lo pendiente (${pendiente.toString()})`);
        }
        const numero = await this.numeracion.siguiente(tx, 'IR', 1);
        const ir = await tx.informeRecepcion.create({
          data: {
            empresaId: this.tenant.empresaId, numero, terceroId: d.terceroId, fecha: d.fecha, depositoId: d.depositoId ?? null,
            remitoNumero: d.remitoNumero, observaciones: d.observaciones ?? null, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
            renglones: { create: d.renglones.map((r) => ({ empresaId: this.tenant.empresaId, ordenCompraRenglonId: r.ordenCompraRenglonId, cantidad: r.cantidad })) },
          },
        });
        for (const [id, cantidad] of porRenglon)
          await tx.ordenCompraRenglon.update({ where: { id }, data: { cantidadRecibida: { increment: cantidad } } });
        for (const ocId of new Set(renglonesOc.map((r) => r.ordenCompraId))) await this.ordenes.recalcularEstado(tx, ocId);
        const conRenglones = await tx.informeRecepcion.findUniqueOrThrow({ where: { id: ir.id }, include: { tercero: true, renglones: { include: { ordenCompraRenglon: { include: { ordenCompra: true } } } } } });
        const asientoId = await this.stock.alRecibir(tx, { id: ir.id, numero, fecha: d.fecha, depositoId: d.depositoId ?? null, proveedor: conRenglones.tercero.razonSocial, renglones: conRenglones.renglones });
        if (asientoId) await tx.informeRecepcion.update({ where: { id: ir.id }, data: { asientoId } });
        await this.auditoria.registrar(tx, { entidad: 'InformeRecepcion', entidadId: ir.id, accion: 'CREAR', datos: { numero, remito: d.remitoNumero } });
        return this.obtener(ir.id, tx);
      }),
    );
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const ir = await this.obtener(id, tx);
      if (ir.estado === 'ANULADO') throw new ConflictException('La recepción ya está anulada');
      await bloquear(tx, 'InformeRecepcionRenglon', this.tenant.empresaId, ir.renglones.map((r) => r.id));
      const actuales = await tx.informeRecepcionRenglon.findMany({ where: { informeRecepcionId: id } });
      if (actuales.some((r) => r.cantidadFacturada.gt(0))) throw new BadRequestException('La recepción tiene renglones facturados');
      await bloquear(tx, 'OrdenCompraRenglon', this.tenant.empresaId, ir.renglones.map((r) => r.ordenCompraRenglonId));
      for (const r of ir.renglones)
        await tx.ordenCompraRenglon.update({ where: { id: r.ordenCompraRenglonId }, data: { cantidadRecibida: { decrement: r.cantidad } } });
      const r = await tx.informeRecepcion.updateMany({ where: { id, estado: 'CONFIRMADO' }, data: { estado: 'ANULADO', motivoAnulacion: motivo } });
      if (!r.count) throw new ConflictException('La recepción ya está anulada');
      for (const ocId of new Set(ir.renglones.map((x) => x.ordenCompraRenglon.ordenCompraId))) await this.ordenes.recalcularEstado(tx, ocId);
      const asientoAnulacionId = await this.stock.alAnularRecepcion(tx, { id, asientoId: ir.asientoId }, new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`), motivo);
      if (asientoAnulacionId) await tx.informeRecepcion.update({ where: { id }, data: { asientoAnulacionId } });
      await this.auditoria.registrar(tx, { entidad: 'InformeRecepcion', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }

  /** Renglones de recepciones confirmadas con cantidad pendiente de facturar. */
  async pendientesFacturar(terceroId?: string) {
    const filas = await this.tenant.db.informeRecepcionRenglon.findMany({
      where: { informeRecepcion: { estado: 'CONFIRMADO', terceroId: terceroId || undefined } },
      include: { informeRecepcion: true, ordenCompraRenglon: { include: { ordenCompra: { select: { numero: true } } } } },
      orderBy: { informeRecepcion: { numero: 'asc' } },
    });
    return filas
      .filter((f) => f.cantidad.gt(f.cantidadFacturada))
      .map((f) => ({
        informeRecepcionRenglonId: f.id, informeRecepcionId: f.informeRecepcionId, irNumero: f.informeRecepcion.numero,
        remitoNumero: f.informeRecepcion.remitoNumero, terceroId: f.informeRecepcion.terceroId,
        ordenCompraRenglonId: f.ordenCompraRenglonId, ocNumero: f.ordenCompraRenglon.ordenCompra.numero,
        articuloId: f.ordenCompraRenglon.articuloId, descripcion: f.ordenCompraRenglon.descripcion,
        precioUnitario: f.ordenCompraRenglon.precioUnitario, bonificacionPct: f.ordenCompraRenglon.bonificacionPct,
        alicuotaIva: f.ordenCompraRenglon.alicuotaIva, centroCostoId: f.ordenCompraRenglon.centroCostoId,
        recibido: f.cantidad, facturado: f.cantidadFacturada, pendiente: f.cantidad.minus(f.cantidadFacturada),
      }));
  }
}
