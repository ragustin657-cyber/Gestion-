import {
  BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  calcularTotales, CondicionIva, discriminaIva, importeRenglon, Letra, letrasValidas, lineasEnPesos, LineaMoneda,
} from '@gestion/shared';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { paginacion } from '../../comun/paginado';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { PlanCuentasService } from '../../contabilidad/plan-cuentas/plan-cuentas.service';
import { MonedasService } from '../../monedas/monedas.service';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { bloquear } from '../comun';
import { ConceptoCuenta } from '../config/conceptos';
import { ConfigComprasService } from '../config/config-compras.service';
import { DatosComprobante } from './dto';
import { detectarDiferencias, LineaTresVias } from './tres-vias';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

const DUPLICADO = 'Este comprobante ya fue cargado';
const DIFERENCIAS = 'Hay diferencias con la orden de compra';
const ETIQUETA_TIPO = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito', TICKET: 'Ticket' } as const;

/** Formato de importe argentino: 1234.5 → "1.234,50". */
export function formatoPesos(d: Dec): string {
  const [ent, dec] = d.abs().toFixed(2).split('.');
  return `${d.isNegative() ? '-' : ''}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

const sumarDias = (f: Date, dias: number) => new Date(f.getTime() + dias * 86400000);

export interface FiltroComprobantes {
  terceroId?: string;
  tipo?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  pagina?: string;
  porPagina?: string;
}

@Injectable()
export class ComprobantesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly numeracion: NumeracionService,
    private readonly monedas: MonedasService,
    private readonly config: ConfigComprasService,
    private readonly asientos: AsientosService,
    private readonly plan: PlanCuentasService,
    private readonly cls: ClsService,
  ) {}

  async listar(f: FiltroComprobantes) {
    const where: Prisma.ComprobanteCompraWhereInput = {
      terceroId: f.terceroId || undefined,
      tipo: f.tipo ? (f.tipo as Prisma.ComprobanteCompraWhereInput['tipo']) : undefined,
      estado: f.estado ? (f.estado as Prisma.ComprobanteCompraWhereInput['estado']) : undefined,
      fechaContable: { gte: f.desde ? new Date(`${f.desde}T00:00:00Z`) : undefined, lte: f.hasta ? new Date(`${f.hasta}T00:00:00Z`) : undefined },
    };
    const [items, total] = await Promise.all([
      this.tenant.db.comprobanteCompra.findMany({
        where, include: { tercero: { select: { razonSocial: true, cuit: true } } },
        orderBy: [{ fechaContable: 'desc' }, { numeroInterno: 'desc' }], ...paginacion(f),
      }),
      this.tenant.db.comprobanteCompra.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const c = await tx.comprobanteCompra.findUnique({
      where: { id },
      include: {
        tercero: { select: { id: true, razonSocial: true, cuit: true } },
        renglones: { orderBy: { orden: 'asc' } }, ivas: { orderBy: { alicuota: 'asc' } }, percepcionesIibb: true,
      },
    });
    if (!c) throw new NotFoundException('Comprobante no encontrado');
    const asientoDe = async (aid: string | null) => {
      if (!aid) return null;
      const a = await tx.asiento.findUnique({ where: { id: aid }, include: { renglones: true } });
      if (!a) return null;
      const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: a.renglones.map((r) => r.cuentaContableId) } } });
      return {
        ...a,
        renglones: a.renglones.map((r) => {
          const cc = cuentas.find((x) => x.id === r.cuentaContableId);
          return { ...r, cuentaCodigo: cc?.codigo, cuentaNombre: cc?.nombre };
        }),
      };
    };
    const irIds = c.renglones.map((r) => r.informeRecepcionRenglonId).filter((x): x is string => !!x);
    const ocIds = c.renglones.map((r) => r.ordenCompraRenglonId).filter((x): x is string => !!x);
    const recepciones = irIds.length
      ? await tx.informeRecepcion.findMany({ where: { renglones: { some: { id: { in: irIds } } } }, select: { id: true, numero: true, remitoNumero: true } })
      : [];
    const ordenes = ocIds.length
      ? await tx.ordenCompra.findMany({ where: { renglones: { some: { id: { in: ocIds } } } }, select: { id: true, numero: true } })
      : [];
    return { ...c, asiento: await asientoDe(c.asientoId), asientoAnulacion: await asientoDe(c.asientoAnulacionId), recepciones, ordenes };
  }

  crear(d: DatosComprobante) {
    return conUnicidad(DUPLICADO, () => this.tenant.transaccion((tx) => this.confirmar(tx, d), { isolationLevel: 'ReadCommitted' }));
  }

  private async confirmar(tx: TxEmpresa, d: DatosComprobante) {
    const empresaId = this.tenant.empresaId;
    const ctx = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO);
    const esNotaCD = d.tipo === 'NOTA_CREDITO' || d.tipo === 'NOTA_DEBITO';

    // 1. Proveedor y letra
    const prov = await tx.tercero.findUnique({ where: { id: d.terceroId } });
    if (!prov || !prov.esProveedor || !prov.activo) throw new BadRequestException('El tercero no es un proveedor activo');
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: empresaId } });
    const letra = d.tipo === 'TICKET' ? null : (d.letra as Letra);
    if (letra && !letrasValidas(empresa.condicionIva as CondicionIva, prov.condicionIva as CondicionIva).includes(letra))
      throw new BadRequestException(`La letra ${letra} no corresponde para este proveedor`);

    // 2. Duplicado (la restricción única cubre la carrera)
    const dup = await tx.comprobanteCompra.findFirst({
      where: { terceroId: d.terceroId, tipo: d.tipo, letra: letra ?? '', puntoVenta: d.puntoVenta, numero: d.numero },
    });
    if (dup) throw new ConflictException(DUPLICADO);

    // 3. Renglones: vínculos, cuentas y datos para 3 vías
    if (esNotaCD && d.renglones.some((r) => r.origen !== 'DIRECTO'))
      throw new BadRequestException('Las notas de crédito y débito solo admiten renglones directos');
    const irIds = d.renglones.map((r) => r.informeRecepcionRenglonId).filter((x): x is string => !!x);
    await bloquear(tx, 'InformeRecepcionRenglon', empresaId, irIds);
    const irRenglones = await tx.informeRecepcionRenglon.findMany({ where: { id: { in: irIds } }, include: { informeRecepcion: true } });
    const ocIds = [
      ...d.renglones.map((r) => r.ordenCompraRenglonId).filter((x): x is string => !!x),
      ...irRenglones.map((r) => r.ordenCompraRenglonId),
    ];
    await bloquear(tx, 'OrdenCompraRenglon', empresaId, ocIds);
    const ocRenglones = await tx.ordenCompraRenglon.findMany({ where: { id: { in: ocIds } }, include: { ordenCompra: true } });
    const articulos = await tx.articulo.findMany({
      where: { id: { in: [...d.renglones.map((r) => r.articuloId), ...ocRenglones.map((r) => r.articuloId)].filter((x): x is string => !!x) } },
    });
    const gastoDefecto = await this.config.cuenta(tx, 'GASTO_POR_DEFECTO');
    const cuentaArticulo = (articuloId: string | null | undefined) => articulos.find((a) => a.id === articuloId)?.cuentaCompraId ?? gastoDefecto;

    const lineas3v: LineaTresVias[] = [];
    const renglones: (Omit<Prisma.ComprobanteCompraRenglonCreateManyInput, 'empresaId' | 'comprobanteId'>)[] = [];
    for (const [i, r] of d.renglones.entries()) {
      let importe: string;
      try {
        importe = importeRenglon(r);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      let articuloId = r.articuloId ?? null;
      let ordenCompraRenglonId: string | null = null;
      let cuentaContableId: string;
      if (r.origen === 'RECEPCION') {
        const ir = irRenglones.find((x) => x.id === r.informeRecepcionRenglonId);
        if (!ir) throw new NotFoundException('Renglón de recepción no encontrado');
        if (ir.informeRecepcion.terceroId !== d.terceroId) throw new BadRequestException('Todos los renglones deben ser del proveedor indicado');
        if (ir.informeRecepcion.estado !== 'CONFIRMADO') throw new BadRequestException('La recepción está anulada');
        const oc = ocRenglones.find((x) => x.id === ir.ordenCompraRenglonId)!;
        articuloId = oc.articuloId;
        ordenCompraRenglonId = oc.id;
        cuentaContableId = cuentaArticulo(articuloId);
        lineas3v.push({ indice: i, precioFacturado: String(r.precioUnitario), precioOc: oc.precioUnitario.toString(), cantidadFacturada: String(r.cantidad), pendienteFacturar: ir.cantidad.minus(ir.cantidadFacturada).toString() });
      } else if (r.origen === 'ORDEN_COMPRA') {
        const oc = ocRenglones.find((x) => x.id === r.ordenCompraRenglonId);
        if (!oc) throw new NotFoundException('Renglón de orden de compra no encontrado');
        if (oc.ordenCompra.terceroId !== d.terceroId) throw new BadRequestException('Todos los renglones deben ser del proveedor indicado');
        if (!['APROBADA', 'PARCIALMENTE_RECIBIDA', 'CUMPLIDA'].includes(oc.ordenCompra.estado)) throw new BadRequestException('La orden de compra no está aprobada');
        articuloId = oc.articuloId;
        ordenCompraRenglonId = oc.id;
        cuentaContableId = cuentaArticulo(articuloId);
        lineas3v.push({ indice: i, precioFacturado: String(r.precioUnitario), precioOc: oc.precioUnitario.toString(), cantidadFacturada: String(r.cantidad), pendienteFacturar: oc.cantidad.minus(oc.cantidadFacturada).toString() });
      } else {
        cuentaContableId = r.cuentaContableId ?? cuentaArticulo(articuloId);
        if (r.cuentaContableId) await this.plan.verificarImputable(tx, r.cuentaContableId, `renglones.${i}.cuentaContableId`);
      }
      renglones.push({
        orden: i + 1, origen: r.origen, informeRecepcionRenglonId: r.informeRecepcionRenglonId ?? null, ordenCompraRenglonId,
        articuloId, descripcion: r.descripcion, cantidad: r.cantidad, precioUnitario: r.precioUnitario, bonificacionPct: r.bonificacionPct,
        alicuotaIva: r.alicuotaIva, cuentaContableId, centroCostoId: r.centroCostoId ?? null, importe,
      });
    }

    // 4. Totales y control contra el total del papel
    const discrimina = discriminaIva(letra);
    const tot = calcularTotales({
      discriminaIva: discrimina,
      renglones: renglones.map((r) => ({ importe: String(r.importe), alicuotaIva: Number(r.alicuotaIva) })),
      percepcionIva: String(d.percepcionIva), percepcionesIibb: d.percepcionesIibb.map((p) => String(p.importe)),
      impuestosInternos: String(d.impuestosInternos), noGravado: String(d.noGravado), exento: String(d.exento),
    });
    const total = new D(tot.total);
    const declarado = new D(d.totalDeclarado);
    if (total.minus(declarado).abs().gt('0.05'))
      throw new BadRequestException(`El total calculado ($${formatoPesos(total)}) no coincide con el total del comprobante ($${formatoPesos(declarado)})`);

    // 5. Control de 3 vías
    const p = await this.config.parametros(tx);
    const diferencias = detectarDiferencias(lineas3v, { precioPct: p.toleranciaPrecioPct.toString(), cantidadPct: p.toleranciaCantidadPct.toString() });
    if (diferencias.length) {
      if (p.modoTresVias === 'BLOQUEAR') throw new BadRequestException({ statusCode: 400, message: DIFERENCIAS, diferencias });
      if (!d.aceptoDiferencias) throw new UnprocessableEntityException({ statusCode: 422, message: DIFERENCIAS, diferencias });
    }

    // 6. Cotización
    const cotizacion = d.monedaCodigo === 'ARS' ? new D(1) : d.cotizacion ? new D(d.cotizacion) : await this.monedas.cotizacion('USD', d.fechaEmision);
    const totalPesos = total.mul(cotizacion).toDecimalPlaces(2);

    // 7. Comprobante
    const numeroInterno = await this.numeracion.siguiente(tx, 'FC', 1);
    const fechaVencimiento = d.fechaVencimiento ?? sumarDias(d.fechaEmision, prov.diasPago);
    const comp = await tx.comprobanteCompra.create({
      data: {
        empresaId, numeroInterno, terceroId: d.terceroId, tipo: d.tipo, letra: letra ?? '', puntoVenta: d.puntoVenta, numero: d.numero,
        fechaEmision: d.fechaEmision, fechaContable: d.fechaContable, fechaVencimiento, monedaCodigo: d.monedaCodigo, cotizacion,
        netoGravado: tot.netoGravado, iva: tot.iva, percepcionIva: d.percepcionIva, impuestosInternos: d.impuestosInternos,
        noGravado: d.noGravado, exento: d.exento, total, totalPesos, comprobanteAsociadoId: d.comprobanteAsociadoId ?? null,
        aceptoDiferencias: diferencias.length > 0, creadoPor: ctx.usuarioId,
        renglones: { create: renglones.map((r) => ({ ...r, empresaId })) },
        ivas: { create: tot.ivaPorAlicuota.map((x) => ({ empresaId, alicuota: x.alicuota, base: x.base, importe: x.importe })) },
        percepcionesIibb: { create: d.percepcionesIibb.map((x) => ({ empresaId, jurisdiccion: x.jurisdiccion, importe: x.importe })) },
      },
    });

    // 8. Cantidades facturadas
    for (const r of renglones) {
      if (r.informeRecepcionRenglonId)
        await tx.informeRecepcionRenglon.update({ where: { id: r.informeRecepcionRenglonId }, data: { cantidadFacturada: { increment: r.cantidad as number } } });
      if (r.ordenCompraRenglonId)
        await tx.ordenCompraRenglon.update({ where: { id: r.ordenCompraRenglonId }, data: { cantidadFacturada: { increment: r.cantidad as number } } });
    }

    // 9. Cuenta corriente (la NC resta)
    const signo = d.tipo === 'NOTA_CREDITO' ? -1 : 1;
    await tx.movimientoCuentaCorriente.create({
      data: {
        empresaId, terceroId: d.terceroId, origenTipo: 'COMPRA', origenId: comp.id, fecha: d.fechaEmision, fechaVencimiento,
        monedaCodigo: d.monedaCodigo, importe: total.mul(signo), importePesos: totalPesos.mul(signo), saldo: total.mul(signo), saldoPesos: totalPesos.mul(signo),
      },
    });

    // 10. Asiento en pesos
    const asiento = await this.generarAsiento(tx, {
      id: comp.id, tipo: d.tipo, letra, puntoVenta: d.puntoVenta, numero: d.numero, razonSocial: prov.razonSocial, fecha: d.fechaContable,
      renglones, iva: tot.iva, percepcionIva: String(d.percepcionIva),
      percepcionIibb: d.percepcionesIibb.reduce((s, x) => s.plus(x.importe), new D(0)).toString(),
      impuestosInternos: String(d.impuestosInternos), noGravadoExento: new D(d.noGravado).plus(d.exento).toString(),
      total: tot.total, cotizacion: cotizacion.toString(),
    });
    await tx.comprobanteCompra.update({ where: { id: comp.id }, data: { asientoId: asiento.id } });

    await this.auditoria.registrar(tx, {
      entidad: 'ComprobanteCompra', entidadId: comp.id, accion: 'CREAR',
      datos: { numeroInterno, comprobante: `${d.tipo} ${letra ?? ''} ${d.puntoVenta}-${d.numero}`, ...(diferencias.length ? { diferencias } : {}) },
    });
    return this.obtener(comp.id, tx);
  }

  /** Anula: contraasiento, cuenta corriente en 0 y libera cantidades facturadas. */
  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const c = await tx.comprobanteCompra.findUnique({ where: { id }, include: { renglones: true } });
      if (!c) throw new NotFoundException('Comprobante no encontrado');
      if (c.estado === 'ANULADO') throw new ConflictException('El comprobante ya está anulado');
      const mov = await tx.movimientoCuentaCorriente.findFirst({ where: { origenTipo: 'COMPRA', origenId: id } });
      if (mov && !mov.saldo.eq(mov.importe)) throw new BadRequestException('El comprobante tiene pagos aplicados');

      const marcado = await tx.comprobanteCompra.updateMany({ where: { id, estado: 'CONFIRMADO' }, data: { estado: 'ANULADO', motivoAnulacion: motivo } });
      if (!marcado.count) throw new ConflictException('El comprobante ya está anulado');

      const hoy = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      const contra = c.asientoId ? await this.asientos.contraasiento(tx, c.asientoId, hoy, `Anulación: ${motivo}`) : null;
      await tx.comprobanteCompra.update({ where: { id }, data: { asientoAnulacionId: contra?.id ?? null } });
      if (mov) await tx.movimientoCuentaCorriente.update({ where: { id: mov.id }, data: { anulado: true, saldo: 0, saldoPesos: 0 } });

      await bloquear(tx, 'InformeRecepcionRenglon', this.tenant.empresaId, c.renglones.map((r) => r.informeRecepcionRenglonId).filter((x): x is string => !!x));
      await bloquear(tx, 'OrdenCompraRenglon', this.tenant.empresaId, c.renglones.map((r) => r.ordenCompraRenglonId).filter((x): x is string => !!x));
      for (const r of c.renglones) {
        if (r.informeRecepcionRenglonId)
          await tx.informeRecepcionRenglon.update({ where: { id: r.informeRecepcionRenglonId }, data: { cantidadFacturada: { decrement: r.cantidad } } });
        if (r.ordenCompraRenglonId)
          await tx.ordenCompraRenglon.update({ where: { id: r.ordenCompraRenglonId }, data: { cantidadFacturada: { decrement: r.cantidad } } });
      }
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteCompra', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }

  private async generarAsiento(
    tx: TxEmpresa,
    c: {
      id: string; tipo: DatosComprobante['tipo']; letra: Letra | null; puntoVenta: number; numero: number; razonSocial: string; fecha: Date;
      renglones: { cuentaContableId: string; centroCostoId?: string | null; importe: unknown }[];
      iva: string; percepcionIva: string; percepcionIibb: string; impuestosInternos: string; noGravadoExento: string; total: string; cotizacion: string;
    },
  ) {
    const esNC = c.tipo === 'NOTA_CREDITO';
    const debe: 'DEBE' | 'HABER' = esNC ? 'HABER' : 'DEBE';
    const haber: 'DEBE' | 'HABER' = esNC ? 'DEBE' : 'HABER';
    const cuentas = new Map<string, { cuentaContableId: string; centroCostoId: string | null }>();
    const lineas: LineaMoneda[] = [];
    const agregar = (clave: string, cuentaContableId: string, centroCostoId: string | null, lado: 'DEBE' | 'HABER', importe: string) => {
      if (new D(importe).isZero()) return;
      cuentas.set(clave, { cuentaContableId, centroCostoId });
      lineas.push({ clave, lado, importe });
    };
    c.renglones.forEach((r, i) => agregar(`r${i}`, r.cuentaContableId, r.centroCostoId ?? null, debe, String(r.importe)));
    const conceptos: [ConceptoCuenta, string][] = [
      ['IVA_CREDITO_FISCAL', c.iva], ['PERCEPCION_IVA', c.percepcionIva], ['PERCEPCION_IIBB', c.percepcionIibb],
      ['IMPUESTOS_INTERNOS', c.impuestosInternos], ['GASTO_POR_DEFECTO', c.noGravadoExento],
    ];
    for (const [concepto, importe] of conceptos)
      if (!new D(importe).isZero()) agregar(concepto, await this.config.cuenta(tx, concepto), null, debe, importe);
    agregar('PROVEEDORES', await this.config.cuenta(tx, 'PROVEEDORES'), null, haber, c.total);

    const enPesos = lineasEnPesos(lineas, c.cotizacion);
    const renglones: RenglonAsiento[] = enPesos.map((l) => ({
      ...cuentas.get(l.clave)!,
      debe: l.lado === 'DEBE' ? l.importe : undefined,
      haber: l.lado === 'HABER' ? l.importe : undefined,
    }));
    const numero = `${String(c.puntoVenta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;
    return this.asientos.generar(tx, {
      fecha: c.fecha, descripcion: `${ETIQUETA_TIPO[c.tipo]} ${c.letra ?? ''} ${numero} - ${c.razonSocial}`.replace(/\s+/g, ' '),
      origenTipo: 'COMPRA', origenId: c.id, renglones,
    });
  }
}
