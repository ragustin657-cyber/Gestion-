import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { ComprobantesVentaService } from '../comprobantes/comprobantes.service';
import { esquemaComprobanteVenta } from '../comprobantes/dto';
import { EmisionService } from '../emision/emision.service';
import { InteresesCalculoService, nombreComprobante, RenglonInteres } from './calculo.service';

const D = Prisma.Decimal;
const mm = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Liquidación mensual de intereses por mora: notas de débito por cliente y moneda (spec E27 §5). */
@Injectable()
export class LiquidacionesInteresesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly calculo: InteresesCalculoService,
    private readonly comprobantes: ComprobantesVentaService,
    private readonly emision: EmisionService,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly cls: ClsService,
  ) {}

  async confirmar(anio: number, mes: number, excluir: string[]) {
    const creadas = await this.tenant.transaccion(async (tx) => {
      // Serializa las confirmaciones de la empresa: la segunda ya no encuentra las facturas liquidadas
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `intereses:${this.tenant.empresaId}`);
      const { tasa, renglones } = await this.calculo.calcular(tx, anio, mes);
      const elegidos = renglones.filter((r) => !excluir.includes(r.comprobanteId));
      if (!elegidos.length) throw new BadRequestException(`No hay intereses para liquidar en ${mm(anio, mes)}`);
      const cfg = await tx.configIntereses.findFirstOrThrow();
      const cuenta = await this.cuentas.cuenta(tx, 'INTERESES_GANADOS');
      const liq = await tx.liquidacionIntereses.create({
        data: { empresaId: this.tenant.empresaId, numero: await this.numeracion.siguiente(tx, 'LIQUIDACION_INTERESES', 0), anio, mes, tasa, fecha: hoy(), creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId },
      });
      const grupos = new Map<string, RenglonInteres[]>();
      for (const r of elegidos) grupos.set(`${r.terceroId}|${r.monedaCodigo}`, [...(grupos.get(`${r.terceroId}|${r.monedaCodigo}`) ?? []), r]);
      const notas: { id: string; terceroId: string; monedaCodigo: string }[] = [];
      const fecha = iso(hoy());
      for (const rs of grupos.values()) {
        // Asociada a la factura vencida más vieja del grupo (ARCA exige un comprobante asociado)
        const asociado = [...rs].sort((a, b) => a.fechaComprobante.getTime() - b.fechaComprobante.getTime() || a.numeroComprobante - b.numeroComprobante)[0];
        const a = await tx.comprobanteVenta.findUniqueOrThrow({ where: { id: asociado.comprobanteId } });
        // Mismo esquema que la API: valida y transforma (fechas, importes) como un alta normal
        const nd = await this.comprobantes.crearEnTx(tx, esquemaComprobanteVenta.parse({
          terceroId: a.terceroId, puntoVentaId: a.puntoVentaId, tipo: 'NOTA_DEBITO', concepto: 'SERVICIOS', fecha, fechaVencimiento: fecha,
          fechaServicioDesde: iso(new Date(Date.UTC(anio, mes - 1, 1))), fechaServicioHasta: iso(new Date(Date.UTC(anio, mes, 0))), fechaVencimientoPago: fecha,
          monedaCodigo: a.monedaCodigo, cotizacion: a.monedaCodigo === 'ARS' ? null : Number(a.cotizacion), comprobanteAsociadoId: a.id, aplicarAAsociado: false, devuelveMercaderia: false,
          renglones: rs.map((r) => ({ origen: 'DIRECTO' as const, descripcion: `${cfg.descripcion} ${r.comprobante} (${r.dias} días)`, cantidad: 1, precioUnitario: Number(r.interes), alicuota: r.alicuota === 'EXENTO' ? 'EXENTO' : Number(r.alicuota) })),
        }), { cuentaContableId: cuenta, sinVendedor: true });
        await tx.liquidacionInteresesRenglon.createMany({
          data: rs.map((r) => ({ empresaId: this.tenant.empresaId, liquidacionId: liq.id, comprobanteId: r.comprobanteId, terceroId: r.terceroId, monedaCodigo: r.monedaCodigo, saldo: r.saldo, dias: r.dias, interes: r.interes, alicuota: r.alicuota, notaDebitoId: nd.id })),
        });
        notas.push({ id: nd.id, terceroId: a.terceroId, monedaCodigo: a.monedaCodigo });
      }
      return { liq, notas };
    }, { timeout: 60000 });
    // Emisión fuera de la transacción, nota por nota: un error de ARCA deja la nota pendiente y se informa
    const resultado = [];
    for (const n of creadas.notas) {
      let mensaje: string | undefined;
      try {
        await this.emision.emitir(n.id);
      } catch (e) {
        mensaje = e instanceof Error ? e.message : 'Error al emitir';
      }
      const c = await this.tenant.db.comprobanteVenta.findUniqueOrThrow({ where: { id: n.id } });
      resultado.push({ ...n, total: c.total.toFixed(2), estado: c.estado, ...(mensaje || c.ultimoError ? { mensaje: mensaje ?? c.ultimoError } : {}) });
    }
    return { id: creadas.liq.id, numero: creadas.liq.numero, notas: resultado };
  }

  async listar() {
    const db = this.tenant.db;
    const ls = await db.liquidacionIntereses.findMany({ include: { renglones: true }, orderBy: { numero: 'desc' } });
    const notaIds = [...new Set(ls.flatMap((l) => l.renglones.map((r) => r.notaDebitoId).filter((x): x is string => !!x)))];
    const notas = new Map((notaIds.length ? await db.comprobanteVenta.findMany({ where: { id: { in: notaIds } }, include: { tercero: { select: { razonSocial: true } } } }) : []).map((n) => [n.id, n]));
    return ls.map((l) => {
      const totales: Record<string, string> = {};
      for (const r of l.renglones) totales[r.monedaCodigo] = new D(totales[r.monedaCodigo] ?? 0).plus(r.interes).toFixed(2);
      const ids = [...new Set(l.renglones.map((r) => r.notaDebitoId).filter((x): x is string => !!x))];
      return {
        id: l.id, numero: l.numero, anio: l.anio, mes: l.mes, tasa: l.tasa.toFixed(2), fecha: iso(l.fecha), totales,
        notas: ids.map((id) => {
          const n = notas.get(id);
          const rs = l.renglones.filter((r) => r.notaDebitoId === id);
          return n
            ? { id, cliente: n.tercero.razonSocial, monedaCodigo: n.monedaCodigo, total: n.total.toFixed(2), estado: n.estado, numero: n.numero ? nombreComprobante(n) : null }
            : { id, cliente: '', monedaCodigo: rs[0].monedaCodigo, total: rs.reduce((s, r) => s.plus(r.interes), new D(0)).toFixed(2), estado: 'ELIMINADA', numero: null };
        }),
      };
    });
  }
}
