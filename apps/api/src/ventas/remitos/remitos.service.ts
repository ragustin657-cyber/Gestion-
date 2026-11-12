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
import type { DatosRemito } from './dto';

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

  async listar(q: { terceroId?: string; pendientes?: string }) {
    const rs = await this.tenant.db.remito.findMany({ where: { terceroId: q.terceroId || undefined }, include: { renglones: { orderBy: { orden: 'asc' } } }, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], take: 300 });
    const terceros = new Map((await this.tenant.db.tercero.findMany({ where: { id: { in: rs.map((r) => r.terceroId) } } })).map((t) => [t.id, t.razonSocial]));
    return rs.map((r) => ({
      ...r, numeroTexto: numeroRemito(r.puntoVenta, r.numero), cliente: terceros.get(r.terceroId) ?? '',
      pendienteFacturar: r.estado === 'CONFIRMADO' ? r.renglones.reduce((s, x) => s.plus(new D(x.cantidad).minus(x.cantidadFacturada)), new D(0)).toString() : '0',
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
      return { ...(await this.obtener(remito.id, tx)), advertencias: res.map((x) => x.advertencia).filter((x): x is string => !!x) };
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.obtener(id, tx);
      await bloquear(tx, 'Remito', this.tenant.empresaId, [id]);
      await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, (await tx.remitoRenglon.findMany({ where: { remitoId: id }, select: { id: true } })).map((x) => x.id));
      const r = await this.obtener(id, tx);
      if (r.estado === 'ANULADO') throw new ConflictException('El remito ya está anulado');
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

  /** Renglones de remitos confirmados con cantidad pendiente de facturar. */
  async pendientesFacturar(terceroId?: string) {
    const rs = await this.tenant.db.remitoRenglon.findMany({ where: { remito: { estado: 'CONFIRMADO', terceroId: terceroId || undefined } }, include: { remito: true }, orderBy: [{ remito: { numero: 'asc' } }, { orden: 'asc' }] });
    const prs = new Map((await this.tenant.db.pedidoVentaRenglon.findMany({ where: { id: { in: rs.map((r) => r.pedidoRenglonId).filter((x): x is string => !!x) } }, include: { pedido: true } })).map((p) => [p.id, p]));
    return rs.filter((r) => new D(r.cantidad).gt(r.cantidadFacturada)).map((r) => ({
      ...(r.pedidoRenglonId && prs.get(r.pedidoRenglonId) ? (() => {
        const p = prs.get(r.pedidoRenglonId!)!;
        return { precioPedido: new D(p.precioUnitario).toString(), alicuotaPedido: p.alicuota, monedaPedido: p.pedido.monedaCodigo, cotizacionPedido: new D(p.pedido.cotizacion).toString() };
      })() : { precioPedido: null, alicuotaPedido: null, monedaPedido: null, cotizacionPedido: null }),
      remitoRenglonId: r.id, remitoId: r.remitoId, numero: numeroRemito(r.remito.puntoVenta, r.remito.numero), fecha: r.remito.fecha, pedidoRenglonId: r.pedidoRenglonId,
      articuloId: r.articuloId, descripcion: r.descripcion, cantidad: new D(r.cantidad).toString(), pendiente: new D(r.cantidad).minus(r.cantidadFacturada).toString(),
    }));
  }

  async pdf(id: string) {
    const db = this.tenant.db;
    const r = await this.obtener(id);
    const [empresa, cliente] = await Promise.all([db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), db.tercero.findUniqueOrThrow({ where: { id: r.terceroId } })]);
    const contenido = await pdfDocumento({
      titulo: 'Remito', numero: r.numeroTexto.slice(2), empresa: { razonSocial: empresa.razonSocial, cuit: formatearCuit(empresa.cuit), domicilio: empresa.domicilio },
      cliente: { razonSocial: cliente.razonSocial, cuit: cliente.cuit }, fecha: fAR(r.fecha), moneda: '',
      renglones: r.renglones.map((x) => ({ descripcion: x.descripcion, cantidad: new D(x.cantidad).toString() })), observaciones: r.observaciones, copias: ['Original', 'Duplicado'],
    });
    return { nombre: `remito-${r.puntoVenta}-${r.numero}.pdf`, contenido };
  }
}
