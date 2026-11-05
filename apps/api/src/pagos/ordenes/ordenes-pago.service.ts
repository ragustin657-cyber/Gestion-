import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoOP, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { baseSujeta } from '@gestion/shared';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { paginacion } from '../../comun/paginado';
import { errorTransicion } from '../../compras/comun';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { MonedasService } from '../../monedas/monedas.service';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ConfigPagosService } from '../config/config-pagos.service';
import { RetencionCalculada, RetencionesService } from '../retenciones/retenciones.service';
import { comprobantesDe, describirMovimientos } from './describir';
import { DatosOP } from './dto';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
export const ESTADOS_ABIERTOS: EstadoOP[] = ['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA'];
const fmt = (d: Dec) => {
  const [e, c] = d.abs().toFixed(2).split('.');
  return `${d.isNegative() ? '-' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${c}`;
};

@Injectable()
export class OrdenesPagoService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly numeracion: NumeracionService,
    private readonly monedas: MonedasService,
    private readonly config: ConfigPagosService,
    private readonly retenciones: RetencionesService,
    private readonly cls: ClsService,
  ) {}

  private get ctx() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO);
  }

  /** Importe de un movimiento comprometido en OP abiertas (sin contar la indicada). */
  async comprometido(tx: TxEmpresa, movimientoId: string, excluirOpId?: string): Promise<Dec> {
    const r = await tx.ordenPagoImputacion.aggregate({
      where: { movimientoId, ordenPago: { estado: { in: ESTADOS_ABIERTOS }, id: excluirOpId ? { not: excluirOpId } : undefined } },
      _sum: { importe: true },
    });
    return r._sum.importe ?? new D(0);
  }

  async pendientes(terceroId: string) {
    const movs = await this.tenant.db.movimientoCuentaCorriente.findMany({
      where: { terceroId, anulado: false, NOT: { saldo: 0 } },
      orderBy: [{ fechaVencimiento: 'asc' }, { fecha: 'asc' }],
    });
    const desc = await describirMovimientos(this.tenant.db, movs);
    const filas = [];
    for (const m of movs) {
      const comp = await this.comprometido(this.tenant.db, m.id);
      const disponible = m.saldo.minus(comp);
      if (disponible.isZero()) continue;
      filas.push({
        movimientoId: m.id, comprobante: desc.get(m.id), origenTipo: m.origenTipo, fecha: m.fecha, fechaVencimiento: m.fechaVencimiento,
        monedaCodigo: m.monedaCodigo, saldo: m.saldo, comprometido: comp, disponible,
      });
    }
    return filas;
  }

  async listar(f: { terceroId?: string; estado?: string; desde?: string; hasta?: string; pagina?: string; porPagina?: string }) {
    const where: Prisma.OrdenPagoWhereInput = {
      terceroId: f.terceroId || undefined,
      estado: f.estado && f.estado in EstadoOP ? (f.estado as EstadoOP) : undefined,
      fecha: { gte: f.desde ? new Date(`${f.desde}T00:00:00Z`) : undefined, lte: f.hasta ? new Date(`${f.hasta}T00:00:00Z`) : undefined },
    };
    const [items, total] = await Promise.all([
      this.tenant.db.ordenPago.findMany({ where, include: { tercero: { select: { razonSocial: true } } }, orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }], ...paginacion(f) }),
      this.tenant.db.ordenPago.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const op = await tx.ordenPago.findUnique({
      where: { id },
      include: {
        tercero: { select: { id: true, razonSocial: true, cuit: true } }, imputaciones: true, anticipo: true,
        retenciones: { orderBy: [{ impuesto: 'asc' }, { jurisdiccion: 'asc' }] }, medios: true,
      },
    });
    if (!op) throw new NotFoundException('Orden de pago no encontrada');
    const movs = await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: op.imputaciones.map((i) => i.movimientoId) } } });
    const desc = await describirMovimientos(tx, movs);
    return {
      ...op,
      imputaciones: op.imputaciones.map((i) => {
        const m = movs.find((x) => x.id === i.movimientoId);
        return { ...i, comprobante: desc.get(i.movimientoId), monedaCodigo: m?.monedaCodigo, fechaVencimiento: m?.fechaVencimiento };
      }),
    };
  }

  /** Valida imputaciones y calcula totales en pesos con la cotización de la OP. */
  private async preparar(tx: TxEmpresa, d: DatosOP, opId?: string) {
    const t = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!t || !t.esProveedor) throw new BadRequestException('El tercero no es un proveedor activo');
    const movs = await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: d.imputaciones.map((i) => i.movimientoId) } } });
    const usaUsd = movs.some((m) => m.monedaCodigo === 'USD') || d.anticipo?.monedaCodigo === 'USD';
    const cotizacion = d.cotizacion ? new D(d.cotizacion) : usaUsd ? await this.monedas.cotizacion('USD', d.fecha) : new D(1);
    const aPesos = (importe: Dec, moneda: string) => (moneda === 'USD' ? importe.mul(cotizacion) : importe).toDecimalPlaces(2);
    const imputaciones = [];
    for (const [i, imp] of d.imputaciones.entries()) {
      const m = movs.find((x) => x.id === imp.movimientoId);
      if (!m || m.anulado) throw new NotFoundException('Comprobante no encontrado');
      if (m.terceroId !== d.terceroId) throw new BadRequestException('El comprobante no pertenece al proveedor');
      const importe = new D(imp.importe);
      if (m.saldo.isZero() || importe.isNegative() !== m.saldo.isNegative())
        throw new BadRequestException({ statusCode: 400, message: 'El importe debe tener el mismo signo que el saldo', campos: { [`imputaciones.${i}.importe`]: 'El importe debe tener el mismo signo que el saldo' } });
      const disponible = m.saldo.minus(await this.comprometido(tx, m.id, opId));
      if (importe.abs().gt(disponible.abs()))
        throw new BadRequestException({ statusCode: 400, message: `El importe a cancelar supera el saldo disponible del comprobante (${disponible.toFixed(2)})`, campos: { [`imputaciones.${i}.importe`]: 'Supera el saldo disponible' } });
      imputaciones.push({ movimientoId: m.id, importe, importePesos: aPesos(importe, m.monedaCodigo) });
    }
    const anticipoPesos = d.anticipo ? aPesos(new D(d.anticipo.importe), d.anticipo.monedaCodigo) : new D(0);
    const total = imputaciones.reduce((s, x) => s.plus(x.importePesos), new D(0)).plus(anticipoPesos);
    if (total.lte(0)) throw new BadRequestException('La orden de pago no tiene importe a pagar');
    return { cotizacion, imputaciones, total };
  }

  crear(d: DatosOP) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.preparar(tx, d);
      const op = await tx.ordenPago.create({
        data: {
          empresaId: this.tenant.empresaId, terceroId: d.terceroId, fecha: d.fecha, cotizacion: p.cotizacion, observaciones: d.observaciones ?? null,
          totalCancelarPesos: p.total, netoPagar: p.total, creadoPor: this.ctx.usuarioId,
          imputaciones: { create: p.imputaciones.map((x) => ({ ...x, empresaId: this.tenant.empresaId })) },
          anticipo: d.anticipo ? { create: { ...d.anticipo, empresaId: this.tenant.empresaId } } : undefined,
        },
      });
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: op.id, accion: 'CREAR' });
      return this.obtener(op.id, tx);
    });
  }

  modificar(id: string, d: DatosOP) {
    return this.tenant.transaccion(async (tx) => {
      await this.obtener(id, tx);
      const p = await this.preparar(tx, d, id);
      const r = await tx.ordenPago.updateMany({
        where: { id, estado: 'BORRADOR' },
        data: { terceroId: d.terceroId, fecha: d.fecha, cotizacion: p.cotizacion, observaciones: d.observaciones ?? null, totalCancelarPesos: p.total, netoPagar: p.total, totalRetenciones: 0, version: { increment: 1 } },
      });
      if (!r.count) throw new BadRequestException('Solo se pueden modificar órdenes en borrador');
      await tx.ordenPagoImputacion.deleteMany({ where: { ordenPagoId: id } });
      await tx.ordenPagoAnticipo.deleteMany({ where: { ordenPagoId: id } });
      await tx.ordenPagoRetencion.deleteMany({ where: { ordenPagoId: id } });
      await tx.ordenPagoImputacion.createMany({ data: p.imputaciones.map((x) => ({ ...x, empresaId: this.tenant.empresaId, ordenPagoId: id })) });
      if (d.anticipo) await tx.ordenPagoAnticipo.create({ data: { ...d.anticipo, empresaId: this.tenant.empresaId, ordenPagoId: id } });
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'MODIFICAR' });
      return this.obtener(id, tx);
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.obtener(id, tx);
      const r = await tx.ordenPago.deleteMany({ where: { id, estado: 'BORRADOR' } });
      if (!r.count) throw new BadRequestException('Solo se pueden eliminar órdenes en borrador');
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'ELIMINAR' });
      return { ok: true };
    });
  }

  /** Bases sujetas a retención de cada imputación (y anticipo) de la OP, en pesos. */
  async bases(tx: TxEmpresa, op: { imputaciones: { movimientoId: string; importePesos: Dec }[]; anticipo: { monedaCodigo: string; importe: Dec } | null; cotizacion: Dec }) {
    const movs = await tx.movimientoCuentaCorriente.findMany({ where: { id: { in: op.imputaciones.map((i) => i.movimientoId) } } });
    const comps = await comprobantesDe(tx, movs);
    const bases = op.imputaciones.map((i) => {
      const m = movs.find((x) => x.id === i.movimientoId)!;
      const c = m.origenTipo === 'COMPRA' ? comps.find((x) => x.id === m.origenId) : null;
      return baseSujeta(i.importePesos.toString(), c ? { netoGravado: c.netoGravado.toString(), noGravado: c.noGravado.toString(), exento: c.exento.toString(), total: c.total.toString() } : null);
    });
    if (op.anticipo) bases.push((op.anticipo.monedaCodigo === 'USD' ? op.anticipo.importe.mul(op.cotizacion) : op.anticipo.importe).toFixed(2));
    return bases;
  }

  /** Calcula las retenciones de la OP a una fecha (sin guardar). */
  async calcularRetenciones(tx: TxEmpresa, opId: string, fechaPago: Date): Promise<RetencionCalculada[]> {
    const op = await tx.ordenPago.findUnique({ where: { id: opId }, include: { imputaciones: true, anticipo: true } });
    if (!op) throw new NotFoundException('Orden de pago no encontrada');
    return this.retenciones.calcular(tx, { terceroId: op.terceroId, fechaPago, bases: await this.bases(tx, op), excluirOrdenPagoId: op.id });
  }

  /** Vista previa de retenciones a otra fecha de pago, sin guardar. */
  async previsualizarRetenciones(id: string, fechaPago: Date) {
    const op = await this.obtener(id);
    const retenciones = await this.calcularRetenciones(this.tenant.db, id, fechaPago);
    const total = retenciones.reduce((s, r) => s.plus(r.importe), new D(0));
    return { retenciones, totalRetenciones: total.toFixed(2), netoPagar: op.totalCancelarPesos.minus(total).toFixed(2) };
  }

  /** Reemplaza las retenciones guardadas de la OP y actualiza totales. */
  async guardarRetenciones(tx: TxEmpresa, opId: string, rets: RetencionCalculada[], total: Dec) {
    await tx.ordenPagoRetencion.deleteMany({ where: { ordenPagoId: opId } });
    await tx.ordenPagoRetencion.createMany({
      data: rets.map((r) => ({ empresaId: this.tenant.empresaId, ordenPagoId: opId, impuesto: r.impuesto, jurisdiccion: r.jurisdiccion, regimen: r.regimen, base: r.base, alicuota: r.alicuota, importe: r.importe, detalle: r.detalle })),
    });
    const totalRet = rets.reduce((s, r) => s.plus(r.importe), new D(0));
    return { totalRetenciones: totalRet, netoPagar: total.minus(totalRet) };
  }

  private async transicion(tx: TxEmpresa, id: string, version: number, desde: EstadoOP[], data: Prisma.OrdenPagoUpdateManyMutationInput, mensaje: string) {
    const r = await tx.ordenPago.updateMany({ where: { id, version, estado: { in: desde } }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) errorTransicion(await tx.ordenPago.findUnique({ where: { id }, select: { version: true } }), version, mensaje);
  }

  confirmar(id: string, version: number) {
    return this.tenant.transaccion(async (tx) => {
      const op = await this.obtener(id, tx);
      const rets = await this.calcularRetenciones(tx, id, op.fecha);
      const { totalRetenciones, netoPagar } = await this.guardarRetenciones(tx, id, rets, op.totalCancelarPesos);
      const { montoAprobacionOp } = await this.config.parametros(tx);
      const automatica = montoAprobacionOp.gt(0) && op.totalCancelarPesos.lte(montoAprobacionOp);
      const numero = await this.numeracion.siguiente(tx, 'OP', 1);
      await this.transicion(tx, id, version, ['BORRADOR'], {
        numero, totalRetenciones, netoPagar, estado: automatica ? 'APROBADA' : 'PENDIENTE_APROBACION',
        aprobadoPor: null, aprobadoEn: automatica ? new Date() : null, motivoRechazo: null,
      }, 'Solo se pueden confirmar órdenes en borrador');
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'MODIFICAR', datos: { confirmada: true, numero } });
      if (automatica) await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'APROBAR', datos: { automatica: true } });
      return this.obtener(id, tx);
    });
  }

  aprobar(id: string, version: number) {
    return this.tenant.transaccion(async (tx) => {
      const op = await this.obtener(id, tx);
      let autoaprobacion = false;
      if (op.creadoPor === this.ctx.usuarioId) {
        const otros = await tx.usuarioEmpresa.count({
          where: { activo: true, usuarioId: { not: this.ctx.usuarioId }, usuario: { activo: true }, OR: [{ rol: { permisos: { has: 'op.aprobar' } } }, { usuario: { superadmin: true } }] },
        });
        if (otros) throw new ForbiddenException('No puede aprobar una orden creada por usted');
        autoaprobacion = true;
      }
      await this.transicion(tx, id, version, ['PENDIENTE_APROBACION'], { estado: 'APROBADA', aprobadoPor: this.ctx.usuarioId, aprobadoEn: new Date() }, 'La orden no está pendiente de aprobación');
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'APROBAR', datos: autoaprobacion ? { autoaprobacion } : undefined });
      return this.obtener(id, tx);
    });
  }

  rechazar(id: string, version: number, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.transicion(tx, id, version, ['PENDIENTE_APROBACION'], { estado: 'BORRADOR', motivoRechazo: motivo }, 'La orden no está pendiente de aprobación');
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'MODIFICAR', datos: { rechazo: motivo } });
      return this.obtener(id, tx);
    });
  }

  /** Anula una OP no pagada (las pagadas las anula AnulacionPagoService). */
  anularNoPagada(id: string, version: number, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.transicion(tx, id, version, ['PENDIENTE_APROBACION', 'APROBADA'], { estado: 'ANULADA', motivoAnulacion: motivo }, 'La orden no se puede anular en su estado actual');
      await this.auditoria.registrar(tx, { entidad: 'OrdenPago', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }
}

export { fmt as formatoImporte };
