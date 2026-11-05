import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { hoyEn, normalizarCuit, normalizarNumeroComprobante, ZONA_ARGENTINA } from '@gestion/shared';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const f2 = (d: Dec) => d.toFixed(2);
const DIA = 86400000;
const ABREV = { FACTURA: 'FC', NOTA_DEBITO: 'ND', NOTA_CREDITO: 'NC', TICKET: 'TK' } as const;
const numeroFc = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`;

/** Valida 'YYYY-MM-DD'; devuelve Date UTC o undefined si no viene. */
export function fechaQuery(s: string | undefined, obligatoria = false): Date | undefined {
  if (!s) {
    if (obligatoria) throw new BadRequestException('Fecha inválida');
    return undefined;
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new BadRequestException('Fecha inválida');
  return d;
}

export interface FilaLibroIva {
  fechaContable: Date;
  tipo: string;
  letra: string;
  numero: string;
  razonSocial: string;
  cuit: string;
  netoPorAlicuota: Record<string, string>;
  ivaPorAlicuota: Record<string, string>;
  percepcionIva: string;
  percepcionesIibb: string;
  impuestosInternos: string;
  noGravado: string;
  exento: string;
  noComputable: string;
  total: string;
}

@Injectable()
export class ConsultasComprasService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly cls: ClsService,
  ) {}

  async cuentaCorriente(terceroId: string, desde?: string, hasta?: string) {
    const tercero = await this.tenant.db.tercero.findUnique({ where: { id: terceroId }, select: { id: true, razonSocial: true, cuit: true } });
    if (!tercero) throw new NotFoundException('Proveedor no encontrado');
    const movs = await this.tenant.db.movimientoCuentaCorriente.findMany({
      where: { terceroId, anulado: false, fecha: { gte: fechaQuery(desde), lte: fechaQuery(hasta) } },
      orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
    });
    const comps = await this.tenant.db.comprobanteCompra.findMany({ where: { id: { in: movs.map((m) => m.origenId) } } });
    const ops = await this.tenant.db.ordenPago.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'ANTICIPO').map((m) => m.origenId) } } });
    // Pagos (aplicaciones de órdenes de pago) agrupados por OP, en pesos históricos
    const aplicaciones = await this.tenant.db.aplicacionCuentaCorriente.findMany({
      where: { anulada: false, origenTipo: 'OP', movimientoId: { in: movs.map((m) => m.id) }, fecha: { gte: fechaQuery(desde), lte: fechaQuery(hasta) } },
    });
    const opsPago = await this.tenant.db.ordenPago.findMany({ where: { id: { in: [...new Set(aplicaciones.map((a) => a.origenId))] } } });
    type Fila = { id: string; origenId: string; fecha: Date; fechaVencimiento: Date | null; comprobante: string; monedaCodigo: string; importe: Dec; importePesos: Dec; saldo: Dec | null; saldoPesos: Dec | null; orden: number };
    const filas: Fila[] = movs.map((m, i) => {
      const c = comps.find((x) => x.id === m.origenId);
      const o = ops.find((x) => x.id === m.origenId);
      const comprobante = c
        ? `${ABREV[c.tipo]} ${c.letra} ${numeroFc(c.puntoVenta, c.numero)}`.replace(/\s+/g, ' ')
        : o ? `Anticipo OP 0001-${String(o.numero).padStart(8, '0')}` : m.origenTipo;
      return { id: m.id, origenId: m.origenId, fecha: m.fecha, fechaVencimiento: m.fechaVencimiento, comprobante, monedaCodigo: m.monedaCodigo, importe: m.importe, importePesos: m.importePesos, saldo: m.saldo, saldoPesos: m.saldoPesos, orden: i };
    });
    for (const op of opsPago) {
      const propias = aplicaciones.filter((a) => a.origenId === op.id);
      const pesos = propias.reduce((s, a) => s.plus(a.importePesosHistorico), new D(0)).neg();
      filas.push({ id: op.id, origenId: op.id, fecha: propias[0].fecha, fechaVencimiento: null, comprobante: `OP 0001-${String(op.numero).padStart(8, '0')}`, monedaCodigo: 'ARS', importe: pesos, importePesos: pesos, saldo: null, saldoPesos: null, orden: 1e9 });
    }
    filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.orden - b.orden);
    let acumulado = new D(0);
    const saldos = { ARS: new D(0), USD: new D(0), pesos: new D(0) };
    for (const m of movs) {
      if (m.monedaCodigo === 'USD') saldos.USD = saldos.USD.plus(m.saldo);
      else saldos.ARS = saldos.ARS.plus(m.saldo);
      saldos.pesos = saldos.pesos.plus(m.saldoPesos);
    }
    const movimientos = filas.map((m) => {
      acumulado = acumulado.plus(m.importePesos);
      return {
        id: m.id, origenId: m.origenId, fecha: m.fecha, fechaVencimiento: m.fechaVencimiento, comprobante: m.comprobante,
        monedaCodigo: m.monedaCodigo, importe: f2(m.importe), importePesos: f2(m.importePesos), saldo: m.saldo ? f2(m.saldo) : null, saldoPesos: m.saldoPesos ? f2(m.saldoPesos) : null,
        acumuladoPesos: f2(acumulado),
      };
    });
    return { tercero, movimientos, saldos: { ARS: f2(saldos.ARS), USD: f2(saldos.USD), pesos: f2(saldos.pesos) } };
  }

  async antiguedadDeuda(fecha?: string) {
    const corte = fechaQuery(fecha) ?? new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
    const movs = await this.tenant.db.movimientoCuentaCorriente.findMany({ where: { anulado: false, NOT: { saldoPesos: 0 } } });
    const terceros = await this.tenant.db.tercero.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.terceroId))] } }, select: { id: true, razonSocial: true } });
    const filas = new Map<string, { porVencer: Dec; d0a30: Dec; d31a60: Dec; d61a90: Dec; mas90: Dec }>();
    for (const m of movs) {
      const f = filas.get(m.terceroId) ?? { porVencer: new D(0), d0a30: new D(0), d31a60: new D(0), d61a90: new D(0), mas90: new D(0) };
      const dias = Math.round((corte.getTime() - m.fechaVencimiento.getTime()) / DIA);
      const tramo = dias <= 0 ? 'porVencer' : dias <= 30 ? 'd0a30' : dias <= 60 ? 'd31a60' : dias <= 90 ? 'd61a90' : 'mas90';
      f[tramo] = f[tramo].plus(m.saldoPesos);
      filas.set(m.terceroId, f);
    }
    return [...filas.entries()]
      .map(([terceroId, f]) => {
        const total = f.porVencer.plus(f.d0a30).plus(f.d31a60).plus(f.d61a90).plus(f.mas90);
        return {
          terceroId, razonSocial: terceros.find((t) => t.id === terceroId)?.razonSocial ?? '',
          porVencer: f2(f.porVencer), d0a30: f2(f.d0a30), d31a60: f2(f.d31a60), d61a90: f2(f.d61a90), mas90: f2(f.mas90), total: f2(total), _total: total,
        };
      })
      .filter((x) => !x._total.isZero())
      .sort((a, b) => b._total.cmp(a._total))
      .map(({ _total, ...x }) => x);
  }

  async libroIva(desde?: string, hasta?: string): Promise<{ filas: FilaLibroIva[]; totales: Omit<FilaLibroIva, 'fechaContable' | 'tipo' | 'letra' | 'numero' | 'razonSocial' | 'cuit'> }> {
    const comps = await this.tenant.db.comprobanteCompra.findMany({
      where: { estado: 'CONFIRMADO', fechaContable: { gte: fechaQuery(desde, true), lte: fechaQuery(hasta, true) } },
      include: { ivas: true, percepcionesIibb: true, tercero: { select: { razonSocial: true, cuit: true } } },
      orderBy: [{ fechaContable: 'asc' }, { numeroInterno: 'asc' }],
    });
    const sum = { neto: {} as Record<string, Dec>, iva: {} as Record<string, Dec>, percepcionIva: new D(0), percepcionesIibb: new D(0), impuestosInternos: new D(0), noGravado: new D(0), exento: new D(0), noComputable: new D(0), total: new D(0) };
    const filas = comps.map((c) => {
      const s = c.tipo === 'NOTA_CREDITO' ? -1 : 1;
      const p = (x: Dec) => x.mul(c.cotizacion).toDecimalPlaces(2).mul(s);
      const neto: Record<string, string> = {}, iva: Record<string, string> = {};
      for (const i of c.ivas) {
        const k = i.alicuota.toString();
        const b = p(i.base), v = p(i.importe);
        neto[k] = f2(b);
        iva[k] = f2(v);
        sum.neto[k] = (sum.neto[k] ?? new D(0)).plus(b);
        sum.iva[k] = (sum.iva[k] ?? new D(0)).plus(v);
      }
      const campos = {
        percepcionIva: p(c.percepcionIva),
        percepcionesIibb: p(c.percepcionesIibb.reduce((t, x) => t.plus(x.importe), new D(0))),
        impuestosInternos: p(c.impuestosInternos), noGravado: p(c.noGravado), exento: p(c.exento),
        noComputable: c.ivas.length ? new D(0) : p(c.netoGravado),
        total: c.totalPesos.mul(s),
      };
      for (const k of Object.keys(campos) as (keyof typeof campos)[]) sum[k] = sum[k].plus(campos[k]);
      return {
        fechaContable: c.fechaContable, tipo: c.tipo, letra: c.letra, numero: numeroFc(c.puntoVenta, c.numero),
        razonSocial: c.tercero.razonSocial, cuit: c.tercero.cuit, netoPorAlicuota: neto, ivaPorAlicuota: iva,
        ...Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, f2(v)])),
      } as FilaLibroIva;
    });
    const mapa = (m: Record<string, Dec>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, f2(v)]));
    return {
      filas,
      totales: {
        netoPorAlicuota: mapa(sum.neto), ivaPorAlicuota: mapa(sum.iva), percepcionIva: f2(sum.percepcionIva), percepcionesIibb: f2(sum.percepcionesIibb),
        impuestosInternos: f2(sum.impuestosInternos), noGravado: f2(sum.noGravado), exento: f2(sum.exento), noComputable: f2(sum.noComputable), total: f2(sum.total),
      },
    };
  }

  /** Búsqueda unificada de OC, recepciones y comprobantes de compra (incluye anulados). */
  async buscar(q?: string, desde?: string, hasta?: string) {
    const ctx = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO);
    const puede = (p: 'oc.ver' | 'ir.ver' | 'fc.ver') => ctx.superadmin || ctx.permisos.includes(p);
    const texto = (q ?? '').trim();
    const pvNum = texto.includes('-') ? normalizarNumeroComprobante(texto) : null;
    const entero = /^\d{1,9}$/.test(texto) ? Number(texto) : undefined;
    const digitos = normalizarCuit(texto);
    const terceroWhere = texto && !pvNum
      ? { OR: [{ razonSocial: { contains: texto, mode: 'insensitive' as const } }, ...(digitos.length >= 3 ? [{ cuit: { contains: digitos } }] : [])] }
      : undefined;
    const rango = { gte: fechaQuery(desde), lte: fechaQuery(hasta) };
    const r: { tipo: 'OC' | 'IR' | 'FC'; id: string; numero: string; fecha: Date; razonSocial: string; estado: string; total?: string }[] = [];

    if (puede('oc.ver') && !pvNum) {
      const ocs = await this.tenant.db.ordenCompra.findMany({
        where: { fecha: rango, numero: { not: null }, ...(texto ? { OR: [...(entero !== undefined ? [{ numero: entero }] : []), ...(terceroWhere ? [{ tercero: terceroWhere }] : [])] } : {}) },
        include: { tercero: { select: { razonSocial: true } } }, take: 100, orderBy: { fecha: 'desc' },
      });
      r.push(...ocs.map((o) => ({ tipo: 'OC' as const, id: o.id, numero: `0001-${String(o.numero).padStart(8, '0')}`, fecha: o.fecha, razonSocial: o.tercero.razonSocial, estado: o.estado, total: o.total.toFixed(2) })));
    }
    if (puede('ir.ver')) {
      const irs = await this.tenant.db.informeRecepcion.findMany({
        where: {
          fecha: rango,
          ...(pvNum ? { remitoNumero: pvNum } : texto ? { OR: [...(entero !== undefined ? [{ numero: entero }] : []), ...(terceroWhere ? [{ tercero: terceroWhere }] : [])] } : {}),
        },
        include: { tercero: { select: { razonSocial: true } } }, take: 100, orderBy: { fecha: 'desc' },
      });
      r.push(...irs.map((i) => ({ tipo: 'IR' as const, id: i.id, numero: `0001-${String(i.numero).padStart(8, '0')}`, fecha: i.fecha, razonSocial: i.tercero.razonSocial, estado: i.estado })));
    }
    if (puede('fc.ver')) {
      const [pv, num] = pvNum ? pvNum.split('-').map(Number) : [undefined, undefined];
      const fcs = await this.tenant.db.comprobanteCompra.findMany({
        where: {
          fechaContable: rango,
          ...(pvNum ? { puntoVenta: pv, numero: num } : texto ? { OR: [...(entero !== undefined ? [{ numero: entero }] : []), ...(terceroWhere ? [{ tercero: terceroWhere }] : [])] } : {}),
        },
        include: { tercero: { select: { razonSocial: true } } }, take: 100, orderBy: { fechaContable: 'desc' },
      });
      r.push(...fcs.map((c) => ({ tipo: 'FC' as const, id: c.id, numero: `${ABREV[c.tipo]} ${c.letra} ${numeroFc(c.puntoVenta, c.numero)}`.replace(/\s+/g, ' '), fecha: c.fechaContable, razonSocial: c.tercero.razonSocial, estado: c.estado, total: c.total.toFixed(2) })));
    }
    return r.sort((a, b) => b.fecha.getTime() - a.fecha.getTime()).slice(0, 100);
  }
}
