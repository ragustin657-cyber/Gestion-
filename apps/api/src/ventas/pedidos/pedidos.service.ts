import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type EstadoPedido } from '@prisma/client';
import { calcularVenta, formatearCuit, letraVenta, type AlicuotaVenta, type LetraVenta } from '@gestion/shared';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cotizacion, D } from '../../tesoreria/operaciones/tesoreria-comun';
import type { DatosPedido } from './dto';
import { pdfDocumento, renglonesPdf } from './pdf-pedido';

const MODIFICADO = 'El pedido fue modificado por otro usuario: actualice la pantalla';
const fAR = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : null);
const conPendientes = <T extends { cantidad: Prisma.Decimal; cantidadEntregada: Prisma.Decimal; cantidadFacturada: Prisma.Decimal }>(r: T) => ({
  ...r, pendienteEntregar: new D(r.cantidad).minus(r.cantidadEntregada).toString(), pendienteFacturar: new D(r.cantidad).minus(r.cantidadFacturada).toString(),
});

@Injectable()
export class PedidosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly numeracion: NumeracionService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const p = await tx.pedidoVenta.findUnique({ where: { id }, include: { renglones: { orderBy: { orden: 'asc' } } } });
    if (!p) throw new NotFoundException('Pedido no encontrado');
    return { ...p, renglones: p.renglones.map(conPendientes) };
  }

  async listar(q: { terceroId?: string; estado?: string; pendientes?: string }) {
    const estados: EstadoPedido[] = ['PRESUPUESTO', 'CONFIRMADO', 'PARCIALMENTE_ENTREGADO', 'ENTREGADO', 'CERRADO', 'ANULADO'];
    const estado = estados.includes(q.estado as EstadoPedido) ? (q.estado as EstadoPedido) : undefined;
    const ps = await this.tenant.db.pedidoVenta.findMany({
      where: { terceroId: q.terceroId || undefined, estado, ...(q.pendientes ? { estado: { in: q.pendientes === 'facturar' ? ['CONFIRMADO', 'PARCIALMENTE_ENTREGADO', 'ENTREGADO'] : ['CONFIRMADO', 'PARCIALMENTE_ENTREGADO'] } } : {}) },
      include: { renglones: { orderBy: { orden: 'asc' } } }, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], take: q.pendientes ? undefined : 300,
    });
    const terceros = new Map((await this.tenant.db.tercero.findMany({ where: { id: { in: ps.map((p) => p.terceroId) } } })).map((t) => [t.id, t.razonSocial]));
    return ps.map((p) => ({ ...p, cliente: terceros.get(p.terceroId) ?? '', renglones: p.renglones.map(conPendientes) }))
      .filter((p) => !q.pendientes || p.renglones.some((r) => new D(q.pendientes === 'facturar' ? r.pendienteFacturar : r.pendienteEntregar).gt(0)));
  }

  /** Cliente, letra, totales y renglones a guardar. */
  private async preparar(tx: TxEmpresa, d: DatosPedido) {
    const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!tercero || !tercero.esCliente || !tercero.activo) throw new BadRequestException('Cliente inexistente o inactivo');
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    let letra: LetraVenta;
    try {
      letra = letraVenta(empresa.condicionIva, tercero.condicionIva);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (d.depositoId && !(await tx.deposito.findUnique({ where: { id: d.depositoId } }))) throw new BadRequestException('Depósito inexistente');
    if (d.listaPreciosId && !(await tx.listaPrecios.findUnique({ where: { id: d.listaPreciosId } }))) throw new BadRequestException('Lista de precios inexistente');
    const ids = d.renglones.map((r) => r.articuloId).filter((x): x is string => !!x);
    if (ids.length && (await tx.articulo.count({ where: { id: { in: ids } } })) !== new Set(ids).size) throw new BadRequestException('Artículo inexistente');
    const calc = calcularVenta(d.renglones.map((r) => ({ cantidad: String(r.cantidad), precioUnitario: String(r.precioUnitario), alicuota: r.alicuota as AlicuotaVenta })), letra);
    const cot = d.monedaCodigo === 'ARS' ? new D(1) : d.cotizacion ? new D(d.cotizacion) : await cotizacion(tx, 'USD', d.fecha);
    return {
      datos: {
        terceroId: d.terceroId, fecha: d.fecha, validoHasta: d.validoHasta ?? null, monedaCodigo: d.monedaCodigo, cotizacion: cot, listaPreciosId: d.listaPreciosId ?? tercero.listaPreciosId ?? null,
        depositoId: d.depositoId ?? null, observaciones: d.observaciones ?? null, letra,
        netoGravado: calc.netoGravado, noGravado: calc.noGravado, exento: calc.exento, iva: calc.iva, total: calc.total,
      },
      renglones: d.renglones.map((r, i) => ({
        empresaId: this.tenant.empresaId, orden: i, articuloId: r.articuloId ?? null, descripcion: r.descripcion, cantidad: r.cantidad, precioUnitario: r.precioUnitario,
        alicuota: String(r.alicuota), neto: calc.renglones[i].neto, iva: calc.renglones[i].iva,
      })),
    };
  }

  crear(d: DatosPedido) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.preparar(tx, d);
      const numero = await this.numeracion.siguiente(tx, 'PEDIDO', 0);
      const ped = await tx.pedidoVenta.create({
        data: { ...p.datos, empresaId: this.tenant.empresaId, numero, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId, renglones: { create: p.renglones } },
      });
      await this.auditoria.registrar(tx, { entidad: 'PedidoVenta', entidadId: ped.id, accion: 'CREAR', datos: { numero } });
      if (d.confirmar) return this.confirmarEn(tx, ped.id);
      return { ...(await this.obtener(ped.id, tx)), advertencias: [] as string[] };
    });
  }

  private async bloqueado(tx: TxEmpresa, id: string) {
    await this.obtener(id, tx);
    await bloquear(tx, 'PedidoVenta', this.tenant.empresaId, [id]);
    return tx.pedidoVenta.findUniqueOrThrow({ where: { id }, include: { renglones: true } });
  }

  modificar(id: string, version: number, d: DatosPedido) {
    return this.tenant.transaccion(async (tx) => {
      const actual = await this.bloqueado(tx, id);
      if (actual.version !== version) throw new ConflictException(MODIFICADO);
      if (actual.estado !== 'PRESUPUESTO') throw new BadRequestException('Solo se modifica un presupuesto');
      const p = await this.preparar(tx, d);
      await tx.pedidoVentaRenglon.deleteMany({ where: { pedidoId: id } });
      await tx.pedidoVenta.update({ where: { id }, data: { ...p.datos, version: { increment: 1 }, renglones: { create: p.renglones } } });
      await this.auditoria.registrar(tx, { entidad: 'PedidoVenta', entidadId: id, accion: 'MODIFICAR', datos: { total: p.datos.total } });
      if (d.confirmar) return this.confirmarEn(tx, id);
      return { ...(await this.obtener(id, tx)), advertencias: [] as string[] };
    });
  }

  confirmar(id: string) {
    return this.tenant.transaccion((tx) => this.confirmarEn(tx, id));
  }

  /** PRESUPUESTO → CONFIRMADO, con avisos de stock (sin reservar). */
  private async confirmarEn(tx: TxEmpresa, id: string) {
    const p = await this.bloqueado(tx, id);
    if (p.estado !== 'PRESUPUESTO') throw new BadRequestException('Solo se confirma un presupuesto');
    await tx.pedidoVenta.update({ where: { id }, data: { estado: 'CONFIRMADO', version: { increment: 1 } } });
    const advertencias: string[] = [];
    // Sin depósito en el pedido, el del primer punto de venta que tenga uno
    const depositoId = p.depositoId ?? (await tx.puntoVenta.findFirst({ where: { depositoId: { not: null } }, orderBy: { numero: 'asc' } }))?.depositoId ?? null;
    if (depositoId) {
      const deposito = await tx.deposito.findUniqueOrThrow({ where: { id: depositoId } });
      const cant = new Map<string, Prisma.Decimal>();
      for (const r of p.renglones) if (r.articuloId) cant.set(r.articuloId, (cant.get(r.articuloId) ?? new D(0)).plus(r.cantidad));
      const arts = await tx.articulo.findMany({ where: { id: { in: [...cant.keys()] }, controlaStock: true }, orderBy: { codigo: 'asc' } });
      for (const a of arts) {
        const saldo = new D((await tx.saldoStock.findFirst({ where: { articuloId: a.id, depositoId } }))?.cantidad ?? 0);
        if (saldo.lt(cant.get(a.id)!)) advertencias.push(`Stock disponible de ${a.codigo} en ${deposito.nombre}: ${saldo.toString()}, el pedido pide ${cant.get(a.id)!.toString()}`);
      }
    }
    await this.auditoria.registrar(tx, { entidad: 'PedidoVenta', entidadId: id, accion: 'MODIFICAR', datos: { estado: 'CONFIRMADO' } });
    return { ...(await this.obtener(id, tx)), advertencias };
  }

  cerrar(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.bloqueado(tx, id);
      if (!['PRESUPUESTO', 'CONFIRMADO', 'PARCIALMENTE_ENTREGADO'].includes(p.estado)) throw new BadRequestException('El pedido no se puede cerrar en su estado actual');
      await tx.pedidoVenta.update({ where: { id }, data: { estado: 'CERRADO', motivoCierre: motivo, version: { increment: 1 } } });
      await this.auditoria.registrar(tx, { entidad: 'PedidoVenta', entidadId: id, accion: 'MODIFICAR', datos: { estado: 'CERRADO', motivo } });
      return this.obtener(id, tx);
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.bloqueado(tx, id);
      if (p.estado === 'ANULADO') throw new ConflictException('El pedido ya está anulado');
      if (p.renglones.some((r) => new D(r.cantidadEntregada).gt(0) || new D(r.cantidadFacturada).gt(0)))
        throw new BadRequestException('El pedido tiene entregas o facturas: ciérrelo en vez de anularlo');
      await tx.pedidoVenta.update({ where: { id }, data: { estado: 'ANULADO', motivoCierre: motivo, version: { increment: 1 } } });
      await this.auditoria.registrar(tx, { entidad: 'PedidoVenta', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }

  async articulosConStock(ids: (string | null)[]): Promise<string[]> {
    const lista = ids.filter((x): x is string => !!x);
    if (!lista.length) return [];
    return (await this.tenant.db.articulo.findMany({ where: { id: { in: lista }, controlaStock: true }, select: { id: true } })).map((a) => a.id);
  }

  /** Estado de entrega según lo entregado (no toca pedidos cerrados, anulados ni presupuestos). */
  async recalcularEstado(tx: TxEmpresa, pedidoId: string) {
    const p = await tx.pedidoVenta.findUniqueOrThrow({ where: { id: pedidoId }, include: { renglones: true } });
    if (!['CONFIRMADO', 'PARCIALMENTE_ENTREGADO', 'ENTREGADO'].includes(p.estado)) return;
    const todo = p.renglones.every((r) => new D(r.cantidadEntregada).gte(r.cantidad));
    const algo = p.renglones.some((r) => new D(r.cantidadEntregada).gt(0));
    const estado: EstadoPedido = todo ? 'ENTREGADO' : algo ? 'PARCIALMENTE_ENTREGADO' : 'CONFIRMADO';
    if (estado !== p.estado) await tx.pedidoVenta.update({ where: { id: pedidoId }, data: { estado, version: { increment: 1 } } });
  }

  async pdf(id: string) {
    const db = this.tenant.db;
    const p = await this.obtener(id);
    const [empresa, cliente] = await Promise.all([db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), db.tercero.findUniqueOrThrow({ where: { id: p.terceroId } })]);
    const titulo = p.estado === 'PRESUPUESTO' ? 'Presupuesto' : 'Pedido de venta';
    const contenido = await pdfDocumento({
      titulo, numero: String(p.numero).padStart(8, '0'), empresa: { razonSocial: empresa.razonSocial, cuit: formatearCuit(empresa.cuit), domicilio: empresa.domicilio },
      cliente: { razonSocial: cliente.razonSocial, cuit: cliente.cuit }, fecha: fAR(p.fecha)!, validoHasta: fAR(p.validoHasta), moneda: p.monedaCodigo,
      renglones: renglonesPdf(p.letra, p.renglones.map((r) => ({ descripcion: r.descripcion, cantidad: new D(r.cantidad).toString(), precioUnitario: new D(r.precioUnitario).toString(), neto: new D(r.neto).toString(), iva: new D(r.iva).toString() }))),
      totales: { neto: new D(p.netoGravado).plus(p.noGravado).plus(p.exento).toString(), iva: p.iva.toString(), total: p.total.toString() }, observaciones: p.observaciones,
    });
    return { nombre: `${titulo.toLowerCase().replace(/ /g, '-')}-${p.numero}.pdf`, contenido };
  }
}
