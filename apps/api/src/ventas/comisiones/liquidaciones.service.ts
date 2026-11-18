import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { LiquidacionesService } from '../../sueldos/liquidaciones.service';
import { ComisionesCalculoService, finDeMes } from './calculo.service';
import { pdfComisiones } from './pdf-comisiones';

const D = Prisma.Decimal;
const mm = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
const clave = (anio: number, mes: number) => anio * 12 + mes;

/** Liquidación mensual de comisiones: confirmar (con la novedad en sueldos), anular, historial y PDF (spec E24 §6). */
@Injectable()
export class LiquidacionesComisionesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly calculo: ComisionesCalculoService,
    private readonly numeracion: NumeracionService,
    private readonly sueldos: LiquidacionesService,
    private readonly cls: ClsService,
  ) {}

  /** Serializa confirmaciones y anulaciones de la empresa. */
  private async bloquear(tx: TxEmpresa) {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `comisiones:${this.tenant.empresaId}`);
  }

  /** Liquidación de sueldos donde va la comisión de un empleado: su final del mes si la tiene, si no la mensual. */
  private async destino(tx: TxEmpresa, empleadoId: string, anio: number, mes: number) {
    const finales = await tx.liquidacion.findMany({ where: { tipo: 'FINAL', anio, mes } });
    const egreso = finales.length ? await tx.egresoEmpleado.findFirst({ where: { empleadoId, liquidacionId: { in: finales.map((f) => f.id) } } }) : null;
    const id = egreso?.liquidacionId ?? (await tx.liquidacion.findFirst({ where: { tipo: 'MENSUAL', anio, mes } }))?.id;
    if (id) await tx.$queryRawUnsafe(`SELECT id FROM "Liquidacion" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, id, this.tenant.empresaId);
    const l = id ? await tx.liquidacion.findUniqueOrThrow({ where: { id } }) : null;
    if (egreso) {
      if (l!.estado !== 'BORRADOR') {
        const e = await tx.empleado.findUniqueOrThrow({ where: { id: empleadoId } });
        throw new BadRequestException(`La liquidación final de ${e.apellido}, ${e.nombre} de ${mm(anio, mes)} está cerrada: la comisión no se puede cargar`);
      }
      return l!;
    }
    if (!l || l.estado !== 'BORRADOR') throw new BadRequestException(`La liquidación mensual de sueldos de ${mm(anio, mes)} no está en borrador: créela o reábrala antes de confirmar las comisiones`);
    return l;
  }

  confirmar(anio: number, mes: number) {
    finDeMes(anio, mes);
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const confirmadas = await tx.liquidacionComisiones.findMany({ where: { estado: 'CONFIRMADA' } });
      if (confirmadas.some((l) => l.anio === anio && l.mes === mes)) throw new BadRequestException(`Las comisiones de ${mm(anio, mes)} ya están liquidadas`);
      if (confirmadas.some((l) => clave(l.anio, l.mes) > clave(anio, mes))) throw new BadRequestException('Ya hay una liquidación de comisiones de un mes posterior');
      const pendientes = await this.calculo.pendientes(tx, anio, mes);
      const vendedores = await tx.vendedor.findMany({ where: { id: { in: [...new Set(pendientes.map((r) => r.vendedorId))] } }, orderBy: { nombre: 'asc' } });
      const total = (id: string) => pendientes.filter((r) => r.vendedorId === id).reduce((s, r) => s.plus(r.comision), new D(0));
      // Un vendedor con total cero o negativo queda pendiente para el mes siguiente (E24 §10)
      const liquidables = vendedores.filter((v) => total(v.id).gt(0));
      if (!liquidables.length) throw new BadRequestException(`No hay comisiones para liquidar en ${mm(anio, mes)}`);
      const empleados = liquidables.filter((v) => v.tipo === 'EMPLEADO' && v.empleadoId);
      let conceptoId: string | null = null;
      if (empleados.length) {
        const cfg = await tx.configuracionSueldos.findFirst();
        const c = cfg?.conceptoComisionesId ? await tx.concepto.findUnique({ where: { id: cfg.conceptoComisionesId } }) : null;
        if (!c || !c.activo || c.tipo !== 'FIJO' || c.clase === 'DESCUENTO' || c.convenioId || c.soloAfiliados) throw new BadRequestException('Configure el concepto de comisiones en sueldos');
        conceptoId = c.id;
      }
      const destinos = new Map<string, string>();
      for (const v of empleados) destinos.set(v.id, (await this.destino(tx, v.empleadoId!, anio, mes)).id);

      const numero = await this.numeracion.siguiente(tx, 'LIQUIDACION_COMISIONES', 0);
      const ids = new Set(liquidables.map((v) => v.id));
      const renglones = pendientes.filter((r) => ids.has(r.vendedorId));
      const liq = await tx.liquidacionComisiones.create({
        data: {
          empresaId: this.tenant.empresaId, numero, anio, mes, fecha: finDeMes(anio, mes), creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
          renglones: { create: renglones.map((r) => ({ empresaId: this.tenant.empresaId, vendedorId: r.vendedorId, tipo: r.tipo, aplicacionId: r.aplicacionId, comprobanteId: r.comprobanteId, chequeId: r.chequeId, cobrado: r.cobrado, neto: r.neto, porcentaje: r.porcentaje, comision: r.comision })) },
        },
      });
      for (const v of empleados) {
        await tx.novedad.create({ data: { empresaId: this.tenant.empresaId, liquidacionId: destinos.get(v.id)!, empleadoId: v.empleadoId!, tipo: 'IMPORTE', conceptoId, importe: total(v.id), detalle: `Comisiones ${mm(anio, mes)}`, liquidacionComisionesId: liq.id } });
      }
      for (const id of new Set(destinos.values())) await this.sueldos.recalcularEnTx(tx, id);
      // La comisión tiene que quedar en un recibo: si el empleado no lo tiene (p. ej. egresó en un mes anterior) o el
      // concepto no se le aplica, se rechaza en vez de darla por pagada
      for (const v of empleados) {
        const destinoId = destinos.get(v.id)!;
        const recibo = await tx.reciboSueldo.findFirst({ where: { liquidacionId: destinoId, empleadoId: v.empleadoId! }, include: { renglones: { where: { conceptoId } } } });
        if (!recibo?.renglones.length) {
          const e = await tx.empleado.findUniqueOrThrow({ where: { id: v.empleadoId! } });
          throw new BadRequestException(`La comisión de ${e.apellido}, ${e.nombre} no se puede cargar en la liquidación de ${mm(anio, mes)}: el empleado no tiene recibo o el concepto de comisiones no se le aplica`);
        }
      }
      return { id: liq.id, numero, anio, mes, vendedores: liquidables.map((v) => ({ vendedorId: v.id, nombre: v.nombre, tipo: v.tipo, comision: total(v.id).toFixed(2) })) };
    }, { timeout: 60000 }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException(`Las comisiones de ${mm(anio, mes)} ya están liquidadas`);
      throw e;
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const l = await tx.liquidacionComisiones.findUnique({ where: { id } });
      if (!l) throw new NotFoundException('Liquidación de comisiones inexistente');
      if (l.estado === 'ANULADA') throw new BadRequestException('La liquidación de comisiones ya está anulada');
      const posteriores = (await tx.liquidacionComisiones.findMany({ where: { estado: 'CONFIRMADA' } })).filter((x) => clave(x.anio, x.mes) > clave(l.anio, l.mes)).sort((a, b) => clave(b.anio, b.mes) - clave(a.anio, a.mes));
      if (posteriores.length) throw new BadRequestException(`Anule primero la liquidación de comisiones de ${mm(posteriores[0].anio, posteriores[0].mes)}`);
      const novedades = await tx.novedad.findMany({ where: { liquidacionComisionesId: id } });
      const liquidaciones = [...new Set(novedades.map((n) => n.liquidacionId))].sort();
      for (const lid of liquidaciones) {
        await tx.$queryRawUnsafe(`SELECT id FROM "Liquidacion" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, lid, this.tenant.empresaId);
        const s = await tx.liquidacion.findUniqueOrThrow({ where: { id: lid } });
        if (s.estado !== 'BORRADOR')
          throw new BadRequestException(`La liquidación ${s.tipo === 'FINAL' ? 'final' : 'mensual de sueldos'} de ${mm(s.anio, s.mes)} está cerrada: reábrala antes de anular las comisiones`);
      }
      await tx.novedad.deleteMany({ where: { liquidacionComisionesId: id } });
      for (const lid of liquidaciones) await this.sueldos.recalcularEnTx(tx, lid);
      await tx.liquidacionComisionesRenglon.updateMany({ where: { liquidacionId: id }, data: { anulado: true } });
      return tx.liquidacionComisiones.update({ where: { id }, data: { estado: 'ANULADA', motivoAnulacion: motivo } });
    });
  }

  async listar() {
    const ls = await this.tenant.db.liquidacionComisiones.findMany({ include: { renglones: { select: { comision: true, vendedorId: true } } }, orderBy: [{ numero: 'desc' }] });
    const externos = await this.tenant.db.vendedor.findMany({ where: { tipo: 'EXTERNO', id: { in: [...new Set(ls.flatMap((l) => l.renglones.map((r) => r.vendedorId)))] } }, orderBy: { nombre: 'asc' } });
    return ls.map((l) => ({
      externos: externos.filter((v) => l.renglones.some((r) => r.vendedorId === v.id)).map((v) => ({ vendedorId: v.id, nombre: v.nombre })),
      id: l.id, numero: l.numero, anio: l.anio, mes: l.mes, fecha: l.fecha.toISOString().slice(0, 10), estado: l.estado, motivoAnulacion: l.motivoAnulacion,
      total: l.renglones.reduce((s, r) => s.plus(r.comision), new D(0)).toFixed(2),
    }));
  }

  async pdf(id: string, vendedorId: string) {
    const l = await this.tenant.db.liquidacionComisiones.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Liquidación de comisiones inexistente');
    const v = vendedorId ? await this.tenant.db.vendedor.findUnique({ where: { id: vendedorId } }) : null;
    if (!v) throw new BadRequestException('Vendedor inexistente');
    const rs = await this.tenant.db.liquidacionComisionesRenglon.findMany({ where: { liquidacionId: id, vendedorId } });
    if (!rs.length) throw new BadRequestException('El vendedor no tiene comisiones en esta liquidación');
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const detalle = await this.detalle(rs.map((r) => r.comprobanteId));
    const f = (x: Prisma.Decimal) => x.toFixed(2);
    const contenido = await pdfComisiones({
      empresa: { razonSocial: empresa.razonSocial, cuit: empresa.cuit }, vendedor: v.nombre, periodo: mm(l.anio, l.mes), numero: l.numero,
      renglones: rs.map((r) => ({ ...detalle(r.comprobanteId), neto: f(r.neto), porcentaje: f(r.porcentaje), comision: f(r.comision), cobro: r.tipo === 'COBRO' ? 'Cobro' : r.tipo === 'ANULACION' ? 'Cobro anulado' : 'Cheque rechazado' })),
      total: f(rs.reduce((s, r) => s.plus(r.comision), new D(0))),
    });
    return { nombre: `comisiones-${l.anio}-${String(l.mes).padStart(2, '0')}-${v.nombre}.pdf`, contenido };
  }

  private async detalle(comprobanteIds: string[]) {
    const cs = await this.tenant.db.comprobanteVenta.findMany({ where: { id: { in: comprobanteIds } } });
    const ts = new Map((await this.tenant.db.tercero.findMany({ where: { id: { in: cs.map((c) => c.terceroId) } } })).map((t) => [t.id, t.razonSocial]));
    return (id: string) => {
      const c = cs.find((x) => x.id === id);
      return { fecha: c ? c.fecha.toISOString().slice(0, 10).split('-').reverse().join('/') : '', cliente: c ? ts.get(c.terceroId) ?? '' : '', comprobante: c ? `${c.letra} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero ?? 0).padStart(8, '0')}` : '' };
    };
  }
}
