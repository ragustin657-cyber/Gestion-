import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { ResultadoLoteFacturacion } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { ComprobantesVentaService } from '../comprobantes/comprobantes.service';
import type { DatosComprobanteVenta } from '../comprobantes/dto';
import { EmisionService } from '../emision/emision.service';
import { ObligacionFceService } from '../fce/obligacion.service';
import { pdfVentas } from '../pdf/pdf-venta';
import { PreciosService } from '../precios/precios.service';
import { armarLote, type GrupoLote } from './armado';
import type { DatosGenerar, FiltroVistaPrevia } from './dto';

const QUINCE_MINUTOS = 15 * 60 * 1000;
const numeroFactura = (c: { letra: string; puntoVenta: number; numero: number | null }) =>
  c.numero === null ? null : `${c.letra} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;
const mensajeDe = (e: unknown) => {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    const m = typeof r === 'string' ? r : (r as { message?: unknown }).message;
    return Array.isArray(m) ? m.join('; ') : String(m ?? e.message);
  }
  return e instanceof Error ? e.message : String(e);
};
/** Señal interna: la factura armada sin FCE corresponde FCE por su total; se rehace dentro de otra transacción. */
class RehacerComoFce extends Error {}

/** E55: facturación por lotes de los remitos pendientes (spec §5-§6). */
@Injectable()
export class LotesFacturacionService {
  /** Máximo de facturas por lote (spec §5); modificable solo en las pruebas. */
  static tope = 200;

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly precios: PreciosService,
    private readonly comprobantes: ComprobantesVentaService,
    private readonly emision: EmisionService,
    private readonly obligacion: ObligacionFceService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  vistaPrevia(q: FiltroVistaPrevia) {
    return armarLote(this.tenant.db, this.precios, { ...q, empresaId: this.tenant.empresaId });
  }

  /** Los lotes en curso sin avanzar hace más de 15 minutos se cortaron (caída o tiempo de espera). */
  private interrumpir(tx: TxEmpresa) {
    return tx.loteFacturacion.updateMany({ where: { estado: 'EN_CURSO', actualizadoEn: { lt: new Date(Date.now() - QUINCE_MINUTOS) } }, data: { estado: 'INTERRUMPIDO' } });
  }

  async generar(d: DatosGenerar) {
    const empresaId = this.tenant.empresaId;
    // 1. Registro del lote, con un solo lote en curso por empresa
    // Los cortados se marcan aparte: queda registrado aunque el lote nuevo no se pueda crear
    await this.interrumpir(this.tenant.db);
    if (await this.tenant.db.loteFacturacion.count({ where: { estado: 'EN_CURSO' } })) throw new ConflictException('Ya hay un lote de facturación en curso');
    if (!(await this.tenant.db.puntoVenta.findUnique({ where: { id: d.puntoVentaId } }))) throw new BadRequestException('Punto de venta inexistente');
    // Los grupos se arman antes del bloqueo (puede llevar tiempo con muchos renglones); cada factura se vuelve a armar en su transacción
    const elegidos = new Set(d.grupos.map((g) => `${g.terceroId}|${g.monedaCodigo}`));
    const terceroIds = [...new Set(d.grupos.map((g) => g.terceroId))];
    const armados = (await armarLote(this.tenant.db, this.precios, { empresaId, hasta: d.hasta, fecha: d.fecha, terceroIds })).filter((g) => g.renglones.length && elegidos.has(`${g.terceroId}|${g.monedaCodigo}`));
    const { loteId, grupos } = await this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "Empresa" WHERE id = $1::uuid FOR UPDATE', empresaId);
      if (await tx.loteFacturacion.count({ where: { estado: 'EN_CURSO' } })) throw new ConflictException('Ya hay un lote de facturación en curso');
      const grupos = armados;
      if (!grupos.length) throw new BadRequestException('No hay remitos pendientes de facturar');
      const tope = LotesFacturacionService.tope;
      if (grupos.filter((g) => !g.problemas.length).length > tope) throw new BadRequestException(`El lote supera las ${tope} facturas: acote los clientes o la fecha`);
      const numero = ((await tx.loteFacturacion.aggregate({ _max: { numero: true } }))._max.numero ?? 0) + 1;
      const lote = await tx.loteFacturacion.create({
        data: {
          empresaId, numero, fecha: d.fecha, hasta: d.hasta, puntoVentaId: d.puntoVentaId, usuarioId: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
          omitidas: grupos.filter((g) => g.problemas.length).length,
          items: { create: grupos.map((g, orden) => ({ empresaId, orden, terceroId: g.terceroId, monedaCodigo: g.monedaCodigo, total: g.total, ...(g.problemas.length ? { resultado: 'OMITIDO' as const, mensaje: g.problemas[0] } : {}) })) },
        },
        include: { items: { orderBy: { orden: 'asc' } } },
      });
      await this.auditoria.registrar(tx, { entidad: 'LoteFacturacion', entidadId: lote.id, accion: 'CREAR', datos: { numero, facturas: grupos.length } });
      return { loteId: lote.id, grupos: lote.items.map((i) => ({ item: i, grupo: grupos[i.orden] })) };
    });

    // 2. Una factura por ítem pendiente: cada una en su transacción y luego su emisión
    try {
      for (const { item, grupo } of grupos) {
        if (item.resultado !== 'PENDIENTE') continue;
        const r = await this.facturar(d, grupo);
        const contador = { EMITIDA: 'emitidas', SIN_CAE: 'sinCae', ERROR: 'errores', OMITIDO: 'omitidas' } as const;
        await this.tenant.db.loteFacturacionItem.update({ where: { id: item.id }, data: { resultado: r.resultado, mensaje: r.mensaje, comprobanteId: r.comprobanteId, fce: r.fce, ...(r.total ? { total: r.total } : {}) } });
        // También toca actualizadoEn: el lote sigue vivo
        await this.tenant.db.loteFacturacion.update({ where: { id: loteId }, data: { [contador[r.resultado as keyof typeof contador]]: { increment: 1 } } });
      }
    } catch (e) {
      // Un error fuera de la factura (p. ej. de la base) corta el lote: queda interrumpido, no en curso
      await this.tenant.db.loteFacturacion.update({ where: { id: loteId }, data: { estado: 'INTERRUMPIDO', terminadoEn: new Date() } }).catch(() => undefined);
      throw e;
    }

    // 3. Cierre
    await this.tenant.db.loteFacturacion.update({ where: { id: loteId }, data: { estado: 'TERMINADO', terminadoEn: new Date() } });
    return this.obtener(loteId);
  }

  /** Una factura del lote (público para poder simular fallas en las pruebas). */
  async facturar(d: DatosGenerar, g: GrupoLote): Promise<{ resultado: ResultadoLoteFacturacion; mensaje: string | null; comprobanteId: string | null; fce: boolean; total: string | null }> {
    const fecha = d.fecha.toISOString().slice(0, 10);
    let obligacion;
    try {
      obligacion = await this.obligacion.obligacion(g.terceroId, fecha);
    } catch (e) {
      return { resultado: 'ERROR', mensaje: mensajeDe(e), comprobanteId: null, fce: false, total: null };
    }
    const crear = (fce: boolean) => this.tenant.transaccion(async (tx) => {
      // Se vuelve a armar dentro de la transacción: lo pendiente puede haber cambiado desde la vista previa
      const filtro = { empresaId: this.tenant.empresaId, hasta: d.hasta, fecha: d.fecha, terceroIds: [g.terceroId] };
      // Bloqueo de los renglones del cliente antes de releer lo pendiente: una factura de a una simultánea no factura dos veces
      const previo = (await armarLote(tx, this.precios, filtro)).find((x) => x.monedaCodigo === g.monedaCodigo);
      await bloquear(tx, 'RemitoRenglon', this.tenant.empresaId, previo?.renglones.map((r) => r.remitoRenglonId) ?? []);
      const actual = (await armarLote(tx, this.precios, filtro)).find((x) => x.monedaCodigo === g.monedaCodigo);
      if (!actual?.renglones.length) return null;
      if (actual.problemas.length) throw new BadRequestException(actual.problemas[0]);
      const t = await tx.tercero.findUniqueOrThrow({ where: { id: g.terceroId } });
      const conf = fce ? await tx.configArca.findFirst() : null;
      const vence = new Date(d.fecha.getTime() + t.diasPago * 86400000);
      const datos: DatosComprobanteVenta = {
        terceroId: g.terceroId, puntoVentaId: d.puntoVentaId, tipo: 'FACTURA', concepto: 'PRODUCTOS', fecha: d.fecha, fechaVencimiento: vence,
        fechaVencimientoPago: fce ? vence : null, monedaCodigo: actual.monedaCodigo, cotizacion: actual.cotizacion ? Number(actual.cotizacion) : null,
        aplicarAAsociado: true, devuelveMercaderia: false, emitir: false,
        ...(fce ? { fce: true, transferenciaFce: (conf?.transferenciaFce ?? 'SCA') as 'SCA' | 'ADC' } : {}),
        renglones: actual.renglones.map((r) => ({
          origen: 'REMITO' as const, remitoRenglonId: r.remitoRenglonId, articuloId: r.articuloId, descripcion: r.descripcion, cantidad: Number(r.cantidad),
          precioUnitario: Number(r.precioUnitario), alicuota: (r.alicuota === 'NO_GRAVADO' || r.alicuota === 'EXENTO' ? r.alicuota : Number(r.alicuota)) as DatosComprobanteVenta['renglones'][number]['alicuota'],
          ...(Number(r.bonificacionPct) ? { bonificacionPct: Number(r.bonificacionPct) } : {}),
        })),
      };
      const c = await this.comprobantes.crearEnTx(tx, datos);
      if (!fce && ObligacionFceService.corresponde(obligacion, new D(c.total).times(c.cotizacion))) throw new RehacerComoFce();
      return c;
    });
    let c;
    let fce = false;
    try {
      try {
        c = await crear(false);
      } catch (e) {
        if (!(e instanceof RehacerComoFce)) throw e;
        fce = true;
        c = await crear(true);
      }
    } catch (e) {
      return { resultado: 'ERROR', mensaje: mensajeDe(e), comprobanteId: null, fce, total: null };
    }
    if (!c) return { resultado: 'OMITIDO', mensaje: 'Sin pendientes', comprobanteId: null, fce: false, total: null };
    try {
      const e = await this.emision.emitir(c.id);
      if (e.estado === 'AUTORIZADO') return { resultado: 'EMITIDA', mensaje: null, comprobanteId: c.id, fce, total: new D(c.total).toString() };
      return { resultado: 'SIN_CAE', mensaje: e.ultimoError ?? null, comprobanteId: c.id, fce, total: new D(c.total).toString() };
    } catch (e) {
      return { resultado: 'SIN_CAE', mensaje: mensajeDe(e), comprobanteId: c.id, fce, total: new D(c.total).toString() };
    }
  }

  async listar() {
    await this.interrumpir(this.tenant.db);
    return this.tenant.db.loteFacturacion.findMany({ orderBy: { numero: 'desc' }, take: 100 });
  }

  async obtener(id: string) {
    const db = this.tenant.db;
    await this.interrumpir(db);
    const l = await db.loteFacturacion.findUnique({ where: { id }, include: { items: { orderBy: { orden: 'asc' } } } });
    if (!l) throw new NotFoundException('Lote inexistente');
    const terceros = new Map((await db.tercero.findMany({ where: { id: { in: l.items.map((i) => i.terceroId) } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
    const comps = new Map((await db.comprobanteVenta.findMany({ where: { id: { in: l.items.map((i) => i.comprobanteId).filter((x): x is string => !!x) } }, select: { id: true, letra: true, puntoVenta: true, numero: true, estado: true } })).map((c) => [c.id, c]));
    return {
      ...l,
      items: l.items.map((i) => {
        const c = i.comprobanteId ? comps.get(i.comprobanteId) : undefined;
        return { ...i, total: new D(i.total).toString(), razonSocial: terceros.get(i.terceroId) ?? '', factura: c ? numeroFactura(c) : null, estadoComprobante: c?.estado ?? null };
      }),
    };
  }

  async pdf(id: string): Promise<{ nombre: string; contenido: Buffer }> {
    const l = await this.obtener(id);
    const ids = l.items.filter((i) => i.comprobanteId && i.estadoComprobante === 'AUTORIZADO').map((i) => i.comprobanteId!);
    if (!ids.length) throw new BadRequestException('El lote no tiene facturas autorizadas');
    const datos = [];
    for (const c of ids) datos.push((await this.comprobantes.datosPdf(c)).datos);
    return { nombre: `lote-facturacion-${l.numero}.pdf`, contenido: await pdfVentas(datos) };
  }
}
