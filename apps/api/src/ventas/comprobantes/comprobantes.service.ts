import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ComprobanteVenta } from '@prisma/client';
import { calcularVenta, letraVenta, type AlicuotaVenta, type LetraVenta } from '@gestion/shared';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear, MODIFICADO } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cotizacion, D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { DatosComprobanteVenta } from './dto';

export const AUTORIZADO_NO_SE_ANULA = 'Un comprobante autorizado no se anula: emita una nota de crédito';
export const EMISION_SIN_CONFIRMAR = 'El comprobante tiene una emisión sin confirmar: reintente para resolverla';
export const EN_CURSO_MS = 2 * 60000;
export const INCLUIR_VENTA = { renglones: { orderBy: { orden: 'asc' } }, ivas: true, tercero: true } satisfies Prisma.ComprobanteVentaInclude;

/** "0001-00000012" */
export const numeroVenta = (puntoVenta: number, numero: number | null) => `${String(puntoVenta).padStart(4, '0')}-${String(numero ?? 0).padStart(8, '0')}`;
export const emisionEnCurso = (c: Pick<ComprobanteVenta, 'emisionEnCurso'>) => !!c.emisionEnCurso && Date.now() - c.emisionEnCurso.getTime() < EN_CURSO_MS;

@Injectable()
export class ComprobantesVentaService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    return tx.comprobanteVenta.findUnique({ where: { id }, include: INCLUIR_VENTA }).then((c) => {
      if (!c) throw new NotFoundException('Comprobante no encontrado');
      return c;
    });
  }

  /**
   * Lo que todavía se puede acreditar a un comprobante: su saldo en la cuenta corriente (en su moneda)
   * menos las NC autorizadas que lo referencian y todavía no se aplicaron.
   */
  async saldoDisponibleNc(tx: TxEmpresa, asociadoId: string, excluirId?: string): Promise<Dec> {
    const mov = await tx.movimientoCuentaCorriente.findFirst({ where: { origenTipo: 'VENTA', origenId: asociadoId, anulado: false } });
    const ncs = await tx.comprobanteVenta.findMany({ where: { comprobanteAsociadoId: asociadoId, tipo: 'NOTA_CREDITO', estado: 'AUTORIZADO', id: excluirId ? { not: excluirId } : undefined }, select: { id: true } });
    const movsNc = ncs.length ? await tx.movimientoCuentaCorriente.findMany({ where: { origenTipo: 'VENTA', origenId: { in: ncs.map((n) => n.id) }, anulado: false } }) : [];
    return movsNc.reduce((s: Dec, m) => s.plus(m.saldo), new D(mov?.saldo ?? 0));
  }

  /** Valida y calcula: letra, cuenta de cada renglón, importes y cotización. Lanza 400 con los mensajes de la spec. */
  async preparar(tx: TxEmpresa, d: DatosComprobanteVenta, id?: string) {
    const tercero = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!tercero || !tercero.esCliente || !tercero.activo) throw new BadRequestException('Cliente inexistente o inactivo');
    const pv = await tx.puntoVenta.findUnique({ where: { id: d.puntoVentaId } });
    if (!pv) throw new BadRequestException('Punto de venta inexistente');
    if (!pv.electronico) throw new BadRequestException('El punto de venta no es electrónico');
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    let letra: LetraVenta;
    try {
      letra = letraVenta(empresa.condicionIva, tercero.condicionIva);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (d.tipo !== 'FACTURA') {
      const asoc = await tx.comprobanteVenta.findUnique({ where: { id: d.comprobanteAsociadoId! } });
      if (!asoc || asoc.estado !== 'AUTORIZADO' || asoc.tipo === 'NOTA_CREDITO') throw new BadRequestException('El comprobante asociado debe ser una factura o nota de débito autorizada');
      if (asoc.terceroId !== d.terceroId) throw new BadRequestException('El comprobante asociado es de otro cliente');
      if (asoc.monedaCodigo !== d.monedaCodigo) throw new BadRequestException('El comprobante asociado está en otra moneda');
      letra = asoc.letra as LetraVenta;
    }
    if (letra === 'A' && tercero.tipoDocumento !== 'CUIT') throw new BadRequestException('El cliente no tiene CUIT válido para una factura A');
    const calc = calcularVenta(d.renglones.map((r) => ({ cantidad: String(r.cantidad), precioUnitario: String(r.precioUnitario), alicuota: r.alicuota as AlicuotaVenta })), letra);
    if (d.tipo === 'NOTA_CREDITO') {
      const disponible = await this.saldoDisponibleNc(tx, d.comprobanteAsociadoId!, id);
      if (new D(calc.total).gt(disponible)) {
        const asoc = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id: d.comprobanteAsociadoId! } });
        throw new BadRequestException(`La nota de crédito supera el saldo de la factura ${numeroVenta(asoc.puntoVenta, asoc.numero)}`);
      }
    }
    const cot = d.monedaCodigo === 'ARS' ? new D(1) : d.cotizacion ? new D(d.cotizacion) : await cotizacion(tx, 'USD', d.fecha);
    const articulos = await tx.articulo.findMany({ where: { id: { in: d.renglones.map((r) => r.articuloId).filter((x): x is string => !!x) } } });
    const ventas = await this.cuentas.cuenta(tx, 'VENTAS');
    const renglones = d.renglones.map((r, i) => {
      if (r.articuloId && !articulos.some((a) => a.id === r.articuloId)) throw new BadRequestException('Artículo inexistente');
      return {
        empresaId: this.tenant.empresaId, orden: i, articuloId: r.articuloId ?? null, descripcion: r.descripcion, cantidad: r.cantidad, precioUnitario: r.precioUnitario, alicuota: String(r.alicuota),
        neto: calc.renglones[i].neto, iva: calc.renglones[i].iva, cuentaContableId: articulos.find((a) => a.id === r.articuloId)?.cuentaVentaId ?? ventas,
      };
    });
    return {
      datos: {
        tipo: d.tipo, letra, puntoVentaId: pv.id, puntoVenta: pv.numero, terceroId: d.terceroId, fecha: d.fecha, fechaVencimiento: d.fechaVencimiento, concepto: d.concepto,
        fechaServicioDesde: d.concepto === 'PRODUCTOS' ? null : d.fechaServicioDesde, fechaServicioHasta: d.concepto === 'PRODUCTOS' ? null : d.fechaServicioHasta,
        fechaVencimientoPago: d.concepto === 'PRODUCTOS' ? null : d.fechaVencimientoPago,
        monedaCodigo: d.monedaCodigo, cotizacion: cot, netoGravado: calc.netoGravado, noGravado: calc.noGravado, exento: calc.exento, iva: calc.iva, total: calc.total,
        totalPesos: new D(calc.total).mul(cot).toDecimalPlaces(2), comprobanteAsociadoId: d.tipo === 'FACTURA' ? null : d.comprobanteAsociadoId, aplicarAAsociado: d.aplicarAAsociado,
      },
      renglones,
      ivas: calc.ivas.map((x) => ({ empresaId: this.tenant.empresaId, alicuota: x.alicuota, base: x.base, importe: x.importe })),
    };
  }

  crear(d: DatosComprobanteVenta) {
    return this.tenant.transaccion(async (tx) => {
      const p = await this.preparar(tx, d);
      const numeroInterno = await this.numeracion.siguiente(tx, 'VENTA-INTERNO', 0);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const c = await tx.comprobanteVenta.create({
        data: { ...p.datos, numeroInterno, creadoPor: usuario, renglones: { create: p.renglones }, ivas: { create: p.ivas } } as Prisma.ComprobanteVentaUncheckedCreateInput,
      });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: c.id, accion: 'CREAR', datos: { numeroInterno, tipo: c.tipo, letra: c.letra, total: c.total } });
      return this.obtener(c.id, tx);
    });
  }

  /** Bloquea un comprobante que todavía se puede editar o eliminar. */
  private async editable(tx: TxEmpresa, id: string) {
    await this.obtener(id, tx);
    await bloquear(tx, 'ComprobanteVenta', this.tenant.empresaId, [id]);
    const c = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id } });
    if (c.estado === 'AUTORIZADO') throw new BadRequestException(AUTORIZADO_NO_SE_ANULA);
    if (emisionEnCurso(c)) throw new ConflictException('Hay una emisión en curso para este comprobante');
    if (c.numeroReservado !== null) throw new BadRequestException(EMISION_SIN_CONFIRMAR);
    return c;
  }

  modificar(id: string, version: number, d: DatosComprobanteVenta) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.editable(tx, id);
      if (c.version !== version) throw new ConflictException(MODIFICADO);
      const p = await this.preparar(tx, d, id);
      await tx.comprobanteVentaRenglon.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVentaIva.deleteMany({ where: { comprobanteId: id } });
      await tx.comprobanteVenta.update({
        where: { id },
        data: { ...p.datos, version: { increment: 1 }, renglones: { create: p.renglones }, ivas: { create: p.ivas } } as Prisma.ComprobanteVentaUncheckedUpdateInput,
      });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'MODIFICAR', datos: { total: p.datos.total } });
      return this.obtener(id, tx);
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.editable(tx, id);
      await tx.comprobanteVenta.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteVenta', entidadId: id, accion: 'ELIMINAR', datos: { numeroInterno: c.numeroInterno, total: c.total } });
      return { ok: true };
    });
  }
}
