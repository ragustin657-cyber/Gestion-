import { avisosDisponible } from '../../stock/reservas';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hoyEn, formatearCuit, ZONA_ARGENTINA } from '@gestion/shared';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { contabilizarRegularizacion, Partida, revertirOrigen } from '../../stock/documentos/documentos.service';
import { MotorStock } from '../../stock/motor';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { pdfDocumento } from '../pedidos/pdf-pedido';
import { PedidosService } from '../pedidos/pedidos.service';
import type { DatosDevolucion, DatosRemito } from './dto';

export const ORIGEN_REMITO = 'REMITO';
export const ORIGEN_COSTO_REMITO = 'COSTO_REMITO';
export const numeroRemito = (pv: number, n: number) => `R ${String(pv).padStart(4, '0')}-${String(n).padStart(8, '0')}`;
const fAR = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

@Injectable()
export class RemitosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly motor: MotorStock,
    private readonly asientos: AsientosService,
    private readonly conceptos: ConfigComprasService,
    private readonly numeracion: NumeracionService,
    private readonly pedidos: PedidosService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const r = await tx.remito.findUnique({ where: { id }, include: { renglones: { orderBy: { orden: 'asc' } } } });
    if (!r) throw new NotFoundException('Remito no encontrado');
    return { ...r, numeroTexto: numeroRemito(r.puntoVenta, r.numero) };
  }

  async listar(q: { terceroId?: string; pendientes?: string; tipo?: string }) {
    const rs = await this.tenant.db.remito.findMany({ where: { terceroId: q.terceroId || undefined, tipo: q.tipo === 'DEVOLUCION' || q.tipo === 'ENTREGA' ? q.tipo : undefined }, include: { renglones: { orderBy: { orden: 'asc' } } }, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], take: 300 });
    const terceros = new Map((await this.tenant.db.tercero.findMany({ where: { id: { in: rs.map((r) => r.terceroId) } } })).map((t) => [t.id, t.razonSocial]));
    return rs.map((r) => ({
      ...r, numeroTexto: numeroRemito(r.puntoVenta, r.numero), cliente: terceros.get(r.terceroId) ?? '',
      pendienteFacturar: r.estado === 'CONFIRMADO' && r.tipo === 'ENTREGA' ? r.renglones.reduce((s, x) => s.plus(D.max(new D(x.cantidad).minus(x.cantidadFacturada).minus(x.cantidadDevuelta), 0)), new D(0)).toString() : '0',
    })).filter((r) => q.pendientes !== 'facturar' || new D(r.pendienteFacturar).gt(0));
  }

  crear(d: DatosRemito) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const pv = await tx.puntoVenta.findUnique({ where: { id: d.puntoVentaId } });
      if (!pv) throw new BadRequestException('Punto de venta inexistente');
      const depositoId = d.depositoId ?? pv.depositoId;
      if (!depositoId) throw new BadRequestException('Indique el depósito');
      if (!(await tx.deposito.findUnique({ where: { id: depositoId } }))) throw new BadRequestException('Depósito inexistente');
      const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
      if (!tercero || !tercero.esCliente || !tercero.activo) throw new BadRequestException('Cliente inexistente o inactivo');

      // 1. Renglones de pedido: bloqueo y tope de entrega
      const prIds = d.renglones.map((r) => r.pedidoRenglonId).filter((x): x is string => !!x);
      // Orden de bloqueo: pedido y luego sus renglones (como anular y cerrar el pedido)
      const pedidosIds = [...new Set((await tx.pedidoVentaRenglon.findMany({ where: { id: { in: prIds } }, select: { pedidoId: true } })).map((x) => x.pedidoId))];
      await bloquear(tx, 'PedidoVenta', empresaId, pedidosIds);
      await bloquear(tx, 'PedidoVentaRenglon', empresaId, prIds);
      const prs = await tx.pedidoVentaRenglon.findMany({ where: { id: { in: prIds } }, include: { pedido: true } });
      const pedidas = new Map<string, Dec>();
      for (const r of d.renglones) if (r.pedidoRenglonId) pedidas.set(r.pedidoRenglonId, (pedidas.get(r.pedidoRenglonId) ?? new D(0)).plus(r.cantidad));
      for (const [id, cant] of pedidas) {
        const pr = prs.find((x) => x.id === id);
        if (!pr) throw new NotFoundException('Renglón de pedido no encontrado');
        if (pr.pedido.terceroId !== d.terceroId) throw new BadRequestException('Todos los renglones deben ser del cliente indicado');
        if (!['CONFIRMADO', 'PARCIALMENTE_ENTREGADO'].includes(pr.pedido.estado)) throw new BadRequestException('El pedido no está confirmado');
        const pendiente = new D(pr.cantidad).minus(pr.cantidadEntregada);
        if (cant.gt(pendiente)) throw new BadRequestException(`La cantidad a entregar (${cant.toString()}) supera lo pendiente del pedido (${pendiente.toString()})`);
      }
      const artIds = d.renglones.map((r) => r.articuloId).filter((x): x is string => !!x);
      if (artIds.length && (await tx.articulo.count({ where: { id: { in: artIds } } })) !== new Set(artIds).size) throw new BadRequestException('Artículo inexistente');

      // 2. Remito
      const numero = await this.numeracion.siguiente(tx, 'REMITO', pv.numero);
      const remito = await tx.remito.create({
        data: {
          empresaId, numero, puntoVenta: pv.numero, terceroId: d.terceroId, fecha: d.fecha, depositoId, observaciones: d.observaciones ?? null,
          creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
          renglones: {
            create: d.renglones.map((r, i) => {
              const pr = prs.find((x) => x.id === r.pedidoRenglonId);
              return { empresaId, orden: i, pedidoRenglonId: r.pedidoRenglonId ?? null, articuloId: pr ? pr.articuloId : (r.articuloId ?? null), descripcion: pr ? pr.descripcion : r.descripcion!, cantidad: r.cantidad };
            }),
          },
        },
        include: { renglones: true },
      });
      for (const [id, cant] of pedidas) await tx.pedidoVentaRenglon.update({ where: { id }, data: { cantidadEntregada: { increment: cant } } });

      // E53: aviso de lo reservado por otros pedidos (con el stock de antes de la salida; los pedidos de este remito no cuentan)
      const cantRem = new Map<string, Dec>();
      for (const r of remito.renglones) if (r.articuloId) cantRem.set(r.articuloId, (cantRem.get(r.articuloId) ?? new D(0)).plus(r.cantidad));
      const avisosReserva = await avisosDisponible(tx, { depositoId, cantidades: cantRem, excluirPedidoIds: [...new Set(prs.map((x) => x.pedidoId))], cola: (q) => `se entregan ${q.toString()}`, soloSiAlcanzaElStock: true });
      // 3. Stock y costo (después de los renglones de pedido; antes que el asiento)
      const conStock = new Set((await tx.articulo.findMany({ where: { id: { in: remito.renglones.map((r) => r.articuloId).filter((x): x is string => !!x) }, controlaStock: true } })).map((a) => a.id));
      const res = await this.motor.moverVarios(tx, remito.renglones.filter((r) => r.articuloId && conStock.has(r.articuloId)).map((r) => ({
        fecha: d.fecha, articuloId: r.articuloId!, depositoId, cantidad: new D(r.cantidad).neg(), tipo: 'VENTA' as const, origenTipo: ORIGEN_REMITO, origenId: remito.id, origenRenglonId: r.id,
      })));
      let asientoId: string | null = null;
      if (res.length) {
        const [merc, cmv] = await Promise.all([this.conceptos.cuenta(tx, 'MERCADERIAS'), this.conceptos.cuenta(tx, 'COSTO_MERCADERIAS_VENDIDAS')]);
        const p = new Partida();
        for (const x of res) {
          p.agregar(merc, x.importe.plus(x.regularizacion));
          p.agregar(cmv, x.importe.plus(x.regularizacion).neg());
        }
        const rs = p.renglones();
        if (rs.length) asientoId = (await this.asientos.generar(tx, { fecha: d.fecha, descripcion: `Costo de ventas - ${numeroRemito(pv.numero, numero)} - ${tercero.razonSocial}`, origenTipo: ORIGEN_COSTO_REMITO, origenId: remito.id, renglones: rs })).id;
      }
      if (asientoId) await tx.remito.update({ where: { id: remito.id }, data: { asientoId } });
      for (const pedidoId of new Set(prs.map((x) => x.pedidoId))) await this.pedidos.recalcularEstado(tx, pedidoId);
      await this.auditoria.registrar(tx, { entidad: 'Remito', entidadId: remito.id, accion: 'CREAR', datos: { numero: numeroRemito(pv.numero, numero) } });
      return { ...(await this.obtener(remito.id, tx)), advertencias: [...res.map((x) => x.advertencia).filter((x): x is string => !!x), ...avisosReserva] };
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.obtener(id, tx);
      await bloquear(tx, 'Remito', this.tenant.empresaId, [id]);
      await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, (await tx.remitoRenglon.findMany({ where: { remitoId: id }, select: { id: true } })).map((x) => x.id));
      const r = await this.obtener(id, tx);
      if (r.estado === 'ANULADO') throw new ConflictException('El remito ya está anulado');
      if (r.tipo === 'DEVOLUCION') return this.anularDevolucion(tx, r, motivo);
      if (r.renglones.some((x) => new D(x.cantidadDevuelta).gt(0))) throw new BadRequestException('El remito tiene devoluciones: anúlelas primero');
      if (r.renglones.some((x) => new D(x.cantidadFacturada).gt(0))) throw new BadRequestException('El remito tiene renglones facturados');
      // Una factura que ya pidió el CAE sobre este remito no puede quedar sobre un remito anulado
      const enEmision = await tx.comprobanteVenta.count({
        where: { estado: { not: 'AUTORIZADO' }, OR: [{ emisionEnCurso: { not: null } }, { numeroReservado: { not: null } }], renglones: { some: { remitoRenglonId: { in: r.renglones.map((x) => x.id) } } } },
      });
      if (enEmision) throw new BadRequestException('El remito tiene una factura en emisión: espere a que termine');
      const prIds = r.renglones.map((x) => x.pedidoRenglonId).filter((x): x is string => !!x);
      await bloquear(tx, 'PedidoVentaRenglon', this.tenant.empresaId, prIds);
      const hoy = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
      const res = await revertirOrigen(tx, this.motor, ORIGEN_REMITO, id, hoy);
      const contra = r.asientoId ? await this.asientos.contraasiento(tx, r.asientoId, hoy, `Anulación del remito ${r.numeroTexto}: ${motivo}`) : null;
      await contabilizarRegularizacion(tx, this.asientos, this.conceptos, res, { fecha: hoy, descripcion: `Regularización de stock - anulación del remito ${r.numeroTexto}`, origenTipo: ORIGEN_COSTO_REMITO, origenId: id });
      for (const x of r.renglones) if (x.pedidoRenglonId) await tx.pedidoVentaRenglon.update({ where: { id: x.pedidoRenglonId }, data: { cantidadEntregada: { decrement: x.cantidad } } });
      const pedidos = await tx.pedidoVentaRenglon.findMany({ where: { id: { in: prIds } }, select: { pedidoId: true } });
      for (const pedidoId of new Set(pedidos.map((x) => x.pedidoId))) await this.pedidos.recalcularEstado(tx, pedidoId);
      await tx.remito.update({ where: { id }, data: { estado: 'ANULADO', motivoAnulacion: motivo, asientoAnulacionId: contra?.id ?? null } });
      await this.auditoria.registrar(tx, { entidad: 'Remito', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }

  /** E54: remito de devolución (spec §3): entra el stock al costo de salida del renglón de origen y baja lo pendiente de facturar. */
  crearDevolucion(d: DatosDevolucion) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const pv = await tx.puntoVenta.findUnique({ where: { id: d.puntoVentaId } });
      if (!pv) throw new BadRequestException('Punto de venta inexistente');
      const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
      if (!tercero || !tercero.esCliente) throw new BadRequestException('Cliente inexistente');
      const ids = [...new Set(d.renglones.map((r) => r.remitoRenglonOrigenId))];
      await bloquear(tx, 'RemitoRenglon', empresaId, ids);
      const origenes = await tx.remitoRenglon.findMany({ where: { id: { in: ids } }, include: { remito: true } });
      for (const id of ids) {
        const o = origenes.find((x) => x.id === id);
        if (!o || o.remito.tipo !== 'ENTREGA' || o.remito.estado !== 'CONFIRMADO' || o.remito.terceroId !== d.terceroId)
          throw new BadRequestException('Los renglones deben ser de remitos de entrega confirmados del cliente');
      }
      const depositos = new Set(origenes.map((o) => o.remito.depositoId));
      if (depositos.size > 1) throw new BadRequestException('Los renglones deben ser de remitos del mismo depósito');
      const depositoId = [...depositos][0];
      // Facturas sin autorizar sobre los renglones de origen
      const sinAutorizar = await tx.comprobanteVenta.count({ where: { estado: { not: 'AUTORIZADO' }, renglones: { some: { remitoRenglonId: { in: ids } } } } });
      if (sinAutorizar) throw new BadRequestException('El remito tiene una factura sin autorizar: emítala o elimínela antes de la devolución');
      // La mercadería ya devuelta con una nota de crédito con devolución en la factura que la facturó
      const facturados = await tx.comprobanteVentaRenglon.findMany({ where: { remitoRenglonId: { in: ids }, comprobante: { estado: 'AUTORIZADO', tipo: 'FACTURA' } }, select: { comprobanteId: true, articuloId: true } });
      for (const f of facturados) {
        if (!f.articuloId) continue;
        const nc = await tx.comprobanteVenta.count({ where: { comprobanteAsociadoId: f.comprobanteId, tipo: 'NOTA_CREDITO', devuelveMercaderia: true, OR: [{ estado: 'AUTORIZADO' }, { numeroReservado: { not: null } }], renglones: { some: { articuloId: f.articuloId } } } });
        if (nc) throw new BadRequestException('La mercadería de este remito ya se devolvió con una nota de crédito');
      }
      // Cantidades: no más de lo entregado menos lo ya devuelto; lo que excede lo pendiente de facturar queda a acreditar
      const acumulado = new Map<string, Dec>();
      const renglones = d.renglones.map((r, i) => {
        const o = origenes.find((x) => x.id === r.remitoRenglonOrigenId)!;
        const previo = acumulado.get(o.id) ?? new D(0);
        const quedan = new D(o.cantidad).minus(o.cantidadDevuelta).minus(previo);
        if (new D(r.cantidad).gt(quedan)) throw new BadRequestException(`No se puede devolver más de lo entregado en el remito ${numeroRemito(o.remito.puntoVenta, o.remito.numero)} (${o.descripcion}): quedan ${quedan.toString()}`);
        const pendFacturar = D.max(new D(o.cantidad).minus(o.cantidadFacturada).minus(o.cantidadDevuelta).minus(previo), 0);
        const aAcreditar = D.max(new D(r.cantidad).minus(pendFacturar), 0);
        acumulado.set(o.id, previo.plus(r.cantidad));
        return { empresaId, orden: i, remitoRenglonOrigenId: o.id, pedidoRenglonId: null, articuloId: o.articuloId, descripcion: o.descripcion, cantidad: r.cantidad, cantidadAAcreditar: aAcreditar, _origen: o, _sinFacturar: new D(r.cantidad).minus(aAcreditar) };
      });
      const numero = await this.numeracion.siguiente(tx, 'REMITO_DEVOLUCION', pv.numero);
      const remito = await tx.remito.create({
        data: {
          empresaId, tipo: 'DEVOLUCION', numero, puntoVenta: pv.numero, terceroId: d.terceroId, fecha: d.fecha, depositoId, observaciones: d.observaciones ?? null,
          creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
          renglones: { create: renglones.map(({ _origen, _sinFacturar, ...r }) => r) },
        },
        include: { renglones: { orderBy: { orden: 'asc' } } },
      });
      for (const r of renglones) {
        await tx.remitoRenglon.update({ where: { id: r._origen.id }, data: { cantidadDevuelta: { increment: r.cantidad } } });
        if (r._origen.pedidoRenglonId && r._sinFacturar.gt(0)) await tx.pedidoVentaRenglon.update({ where: { id: r._origen.pedidoRenglonId }, data: { cantidadDevuelta: { increment: r._sinFacturar } } });
      }
      // Stock al costo con que salió cada renglón de origen
      const conStock = new Set((await tx.articulo.findMany({ where: { id: { in: remito.renglones.map((r) => r.articuloId).filter((x): x is string => !!x) }, controlaStock: true } })).map((a) => a.id));
      const salidas = await tx.movimientoStock.findMany({ where: { origenTipo: ORIGEN_REMITO, tipo: 'VENTA', anulaAId: null, origenRenglonId: { in: ids } } });
      const res = await this.motor.moverVarios(tx, remito.renglones.filter((r) => r.articuloId && conStock.has(r.articuloId)).map((r) => {
        const salida = salidas.find((m) => m.origenRenglonId === r.remitoRenglonOrigenId);
        return { fecha: d.fecha, articuloId: r.articuloId!, depositoId, cantidad: new D(r.cantidad), ...(salida ? { costoUnitario: new D(salida.costoUnitario) } : {}), tipo: 'DEVOLUCION_VENTA' as const, origenTipo: ORIGEN_REMITO, origenId: remito.id, origenRenglonId: r.id };
      }));
      let asientoId: string | null = null;
      if (res.length) {
        const [merc, cmv] = await Promise.all([this.conceptos.cuenta(tx, 'MERCADERIAS'), this.conceptos.cuenta(tx, 'COSTO_MERCADERIAS_VENDIDAS')]);
        const p = new Partida();
        for (const x of res) {
          p.agregar(merc, x.importe);
          p.agregar(cmv, x.importe.neg());
        }
        const rs = p.renglones();
        if (rs.length) asientoId = (await this.asientos.generar(tx, { fecha: d.fecha, descripcion: `Devolución de mercadería - ${numeroRemito(pv.numero, numero)} - ${tercero.razonSocial}`, origenTipo: ORIGEN_COSTO_REMITO, origenId: remito.id, renglones: rs })).id;
      }
      if (asientoId) await tx.remito.update({ where: { id: remito.id }, data: { asientoId } });
      await this.auditoria.registrar(tx, { entidad: 'Remito', entidadId: remito.id, accion: 'CREAR', datos: { devolucion: numeroRemito(pv.numero, numero) } });
      return { ...(await this.obtener(remito.id, tx)), advertencias: res.map((x) => x.advertencia).filter((x): x is string => !!x) };
    });
  }

  /** E54: anular un remito de devolución (sin notas de crédito): revierte el stock, el asiento y lo devuelto en los orígenes. */
  private async anularDevolucion(tx: TxEmpresa, r: Awaited<ReturnType<RemitosService['obtener']>>, motivo: string) {
    if (r.renglones.some((x) => new D(x.cantidadAcreditada).gt(0))) throw new BadRequestException('La devolución ya tiene notas de crédito: anúlelas primero');
    const enNc = await tx.comprobanteVenta.count({ where: { estado: { not: 'AUTORIZADO' }, renglones: { some: { devolucionRenglonId: { in: r.renglones.map((x) => x.id) } } } } });
    if (enNc) throw new BadRequestException('La devolución ya tiene notas de crédito: anúlelas primero');
    const origenIds = r.renglones.map((x) => x.remitoRenglonOrigenId).filter((x): x is string => !!x);
    await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, origenIds);
    const origenes = await tx.remitoRenglon.findMany({ where: { id: { in: origenIds } } });
    const hoy = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
    const res = await revertirOrigen(tx, this.motor, ORIGEN_REMITO, r.id, hoy);
    const contra = r.asientoId ? await this.asientos.contraasiento(tx, r.asientoId, hoy, `Anulación de la devolución ${r.numeroTexto}: ${motivo}`) : null;
    await contabilizarRegularizacion(tx, this.asientos, this.conceptos, res, { fecha: hoy, descripcion: `Regularización de stock - anulación de la devolución ${r.numeroTexto}`, origenTipo: ORIGEN_COSTO_REMITO, origenId: r.id });
    for (const x of r.renglones) {
      const o = origenes.find((y) => y.id === x.remitoRenglonOrigenId);
      if (!o) continue;
      await tx.remitoRenglon.update({ where: { id: o.id }, data: { cantidadDevuelta: { decrement: x.cantidad } } });
      const sinFacturar = new D(x.cantidad).minus(x.cantidadAAcreditar);
      if (o.pedidoRenglonId && sinFacturar.gt(0)) await tx.pedidoVentaRenglon.update({ where: { id: o.pedidoRenglonId }, data: { cantidadDevuelta: { decrement: sinFacturar } } });
    }
    await tx.remito.update({ where: { id: r.id }, data: { estado: 'ANULADO', motivoAnulacion: motivo, asientoAnulacionId: contra?.id ?? null } });
    await this.auditoria.registrar(tx, { entidad: 'Remito', entidadId: r.id, accion: 'ANULAR', datos: { motivo, devolucion: true } });
    return this.obtener(r.id, tx);
  }

  /** E54: renglones de remitos de entrega del cliente con lo que queda por devolver. */
  async devolvibles(terceroId: string) {
    const rs = await this.tenant.db.remitoRenglon.findMany({ where: { remito: { terceroId, tipo: 'ENTREGA', estado: 'CONFIRMADO' } }, include: { remito: true }, orderBy: [{ remito: { numero: 'asc' } }, { orden: 'asc' }] });
    return rs.filter((r) => new D(r.cantidad).gt(r.cantidadDevuelta)).map((r) => ({
      remitoRenglonId: r.id, remitoId: r.remitoId, numero: numeroRemito(r.remito.puntoVenta, r.remito.numero), fecha: r.remito.fecha, depositoId: r.remito.depositoId,
      articuloId: r.articuloId, descripcion: r.descripcion, entregado: new D(r.cantidad).toString(), devuelto: new D(r.cantidadDevuelta).toString(), quedan: new D(r.cantidad).minus(r.cantidadDevuelta).toString(),
    }));
  }

  /** E54: renglones de devoluciones con lo pendiente de acreditar, con la factura propuesta (la que facturó el renglón de origen) y su precio. */
  async pendientesAcreditar(terceroId: string) {
    const db = this.tenant.db;
    const rs = await db.remitoRenglon.findMany({ where: { remito: { terceroId, tipo: 'DEVOLUCION', estado: 'CONFIRMADO' } }, include: { remito: true }, orderBy: [{ remito: { numero: 'asc' } }, { orden: 'asc' }] });
    const pend = rs.filter((r) => new D(r.cantidadAAcreditar).gt(r.cantidadAcreditada));
    const facturados = await db.comprobanteVentaRenglon.findMany({
      where: { remitoRenglonId: { in: pend.map((r) => r.remitoRenglonOrigenId).filter((x): x is string => !!x) }, comprobante: { tipo: 'FACTURA', estado: 'AUTORIZADO' } },
      include: { comprobante: true }, orderBy: { comprobante: { fecha: 'desc' } },
    });
    return pend.map((r) => {
      const f = facturados.find((x) => x.remitoRenglonId === r.remitoRenglonOrigenId);
      return {
        devolucionRenglonId: r.id, remitoId: r.remitoId, numero: numeroRemito(r.remito.puntoVenta, r.remito.numero), fecha: r.remito.fecha, articuloId: r.articuloId, descripcion: r.descripcion,
        pendiente: new D(r.cantidadAAcreditar).minus(r.cantidadAcreditada).toString(),
        facturaId: f?.comprobanteId ?? null, factura: f ? `${f.comprobante.letra} ${String(f.comprobante.puntoVenta).padStart(4, '0')}-${String(f.comprobante.numero ?? 0).padStart(8, '0')}` : null,
        precioUnitario: f ? new D(f.precioUnitario).toString() : null, bonificacionPct: f ? new D(f.bonificacionPct).toString() : '0', alicuota: f?.alicuota ?? null, monedaCodigo: f?.comprobante.monedaCodigo ?? null,
      };
    });
  }

  /** Renglones de remitos confirmados con cantidad pendiente de facturar. */
  async pendientesFacturar(terceroId?: string) {
    const rs = await this.tenant.db.remitoRenglon.findMany({ where: { remito: { estado: 'CONFIRMADO', tipo: 'ENTREGA', terceroId: terceroId || undefined } }, include: { remito: true }, orderBy: [{ remito: { numero: 'asc' } }, { orden: 'asc' }] });
    const prs = new Map((await this.tenant.db.pedidoVentaRenglon.findMany({ where: { id: { in: rs.map((r) => r.pedidoRenglonId).filter((x): x is string => !!x) } }, include: { pedido: true } })).map((p) => [p.id, p]));
    return rs.filter((r) => new D(r.cantidad).minus(r.cantidadDevuelta).gt(r.cantidadFacturada)).map((r) => ({
      ...(r.pedidoRenglonId && prs.get(r.pedidoRenglonId) ? (() => {
        const p = prs.get(r.pedidoRenglonId!)!;
        return { precioPedido: new D(p.precioUnitario).toString(), alicuotaPedido: p.alicuota, bonificacionPedido: new D(p.bonificacionPct).toString(), monedaPedido: p.pedido.monedaCodigo, cotizacionPedido: new D(p.pedido.cotizacion).toString() };
      })() : { precioPedido: null, alicuotaPedido: null, bonificacionPedido: null, monedaPedido: null, cotizacionPedido: null }),
      remitoRenglonId: r.id, remitoId: r.remitoId, numero: numeroRemito(r.remito.puntoVenta, r.remito.numero), fecha: r.remito.fecha, pedidoRenglonId: r.pedidoRenglonId,
      articuloId: r.articuloId, descripcion: r.descripcion, cantidad: new D(r.cantidad).toString(), pendiente: new D(r.cantidad).minus(r.cantidadFacturada).minus(r.cantidadDevuelta).toString(),
    }));
  }

  async pdf(id: string) {
    const db = this.tenant.db;
    const r = await this.obtener(id);
    const [empresa, cliente] = await Promise.all([db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), db.tercero.findUniqueOrThrow({ where: { id: r.terceroId } })]);
    // E54: el remito de devolución dice qué remitos devuelve
    let observaciones = r.observaciones;
    if (r.tipo === 'DEVOLUCION') {
      const origenes = await db.remitoRenglon.findMany({ where: { id: { in: r.renglones.map((x) => x.remitoRenglonOrigenId).filter((x): x is string => !!x) } }, include: { remito: true } });
      const nums = [...new Set(origenes.map((o) => numeroRemito(o.remito.puntoVenta, o.remito.numero)))].join(', ');
      observaciones = `Devuelve los remitos ${nums}${r.observaciones ? ` · ${r.observaciones}` : ''}`;
    }
    const contenido = await pdfDocumento({
      titulo: r.tipo === 'DEVOLUCION' ? 'Remito de devolución' : 'Remito', numero: r.numeroTexto.slice(2), empresa: { razonSocial: empresa.razonSocial, cuit: formatearCuit(empresa.cuit), domicilio: empresa.domicilio },
      cliente: { razonSocial: cliente.razonSocial, cuit: cliente.cuit }, fecha: fAR(r.fecha), moneda: '',
      renglones: r.renglones.map((x) => ({ descripcion: x.descripcion, cantidad: new D(x.cantidad).toString() })), observaciones, copias: ['Original', 'Duplicado'],
    });
    return { nombre: `remito-${r.puntoVenta}-${r.numero}.pdf`, contenido };
  }
}
