import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fechaQuery } from '../compras/consultas/consultas.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { anioAnterior, coeficientes, periodoAnterior, rotacion, TRAMOS } from './calculo';
import { antiguedad } from './fuentes/cuentas';
import { valorStock } from './fuentes/stock';
import { RenglonVendido, renglonesVendidos } from './fuentes/ventas';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const cero = new D(0);
export type Agrupar = 'cliente' | 'articulo' | 'mes';

export interface FilaVentas { clave: string; nombre: string; ventas: string; costo: string; margen: string; margenPct: string | null; sinCosto: string }

/** Totales de un grupo de renglones: ventas, costo y margen sobre lo que tiene costo. */
export function resumir(rs: RenglonVendido[]) {
  let ventas = cero, conCosto = cero, costo = cero, sinCosto = cero;
  for (const r of rs) {
    ventas = ventas.plus(r.ventas);
    if (r.costo === null) sinCosto = sinCosto.plus(r.ventas);
    else { conCosto = conCosto.plus(r.ventas); costo = costo.plus(r.costo); }
  }
  const margen = conCosto.minus(costo);
  return {
    ventas: ventas.toFixed(2), costo: costo.toFixed(2), margen: margen.toFixed(2), sinCosto: sinCosto.toFixed(2),
    margenPct: conCosto.isZero() ? null : margen.div(conCosto).times(100).toFixed(2),
    cobertura: ventas.isZero() ? null : conCosto.div(ventas).times(100).toFixed(2),
    _ventas: ventas, _margen: margen, _costo: costo,
  };
}

@Injectable()
export class InformesService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Período validado (spec §4). */
  periodo(q: { desde?: string; hasta?: string }) {
    const desde = fechaQuery(q.desde, true)!;
    const hasta = fechaQuery(q.hasta, true)!;
    if (desde > hasta) throw new BadRequestException('La fecha desde no puede ser posterior a la fecha hasta');
    const limite = new Date(Date.UTC(desde.getUTCFullYear() + 3, desde.getUTCMonth(), desde.getUTCDate()));
    if (hasta >= limite) throw new BadRequestException('El período no puede superar los 3 años');
    return { desde, hasta };
  }

  /** Renglones vendidos, reexpresados por mes si se pide y hay índices (si no, aviso y nominal). */
  async vendidos(tx: TxEmpresa, desde: Date, hasta: Date, reexpresar: boolean): Promise<{ rs: RenglonVendido[]; aviso?: string }> {
    const rs = await renglonesVendidos(tx, desde, hasta);
    const r = await this.reexpresar(tx, [rs], hasta.toISOString().slice(0, 7), reexpresar);
    return { rs: r.listas[0], ...(r.aviso ? { aviso: r.aviso } : {}) };
  }

  /** Reexpresa todas las listas a la moneda del mes base con un único juego de coeficientes; si falta algún índice, ninguna (spec §3). */
  async reexpresar(tx: TxEmpresa, listas: RenglonVendido[][], mesHasta: string, reexpresar: boolean): Promise<{ listas: RenglonVendido[][]; aviso?: string }> {
    const meses = [...new Set(listas.flat().map((r) => r.mes))];
    if (!reexpresar || !meses.length) return { listas };
    const filas = await tx.indiceInflacion.findMany();
    const indices = new Map(filas.map((f) => [`${f.anio}-${String(f.mes).padStart(2, '0')}`, new D(f.valor)]));
    const c = coeficientes(meses, indices, mesHasta);
    if ('faltan' in c) return { listas, aviso: `Faltan los índices de: ${c.faltan.join(', ')}: se muestran importes nominales` };
    return {
      listas: listas.map((rs) => rs.map((r) => {
        const k = c.coef.get(r.mes)!;
        return { ...r, ventas: r.ventas.times(k).toDecimalPlaces(2), costo: r.costo === null ? null : r.costo.times(k).toDecimalPlaces(2) };
      })),
    };
  }

  /** Tablero de dirección (spec §4). */
  async tablero(q: { desde?: string; hasta?: string; reexpresar?: string }) {
    const db = this.tenant.db;
    const { desde, hasta } = this.periodo(q);
    const ant = periodoAnterior(desde, hasta), anio = anioAnterior(desde, hasta);
    const inicioSerie = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth() - 11, 1));
    const [act, rAnt, rAnio, serie, clientes, proveedores, stock] = await Promise.all([
      renglonesVendidos(db, desde, hasta), renglonesVendidos(db, ant.desde, ant.hasta), renglonesVendidos(db, anio.desde, anio.hasta),
      renglonesVendidos(db, inicioSerie, hasta), antiguedad(db, 'clientes', hasta), antiguedad(db, 'proveedores', hasta), valorStock(db, hasta),
    ]);
    const { listas: [p, pa, py, s], aviso } = await this.reexpresar(db, [act, rAnt, rAnio, serie], hasta.toISOString().slice(0, 7), q.reexpresar === 'true');
    const [rp, ra, ry] = [p, pa, py].map((x) => resumir(x));
    const vencido = (t: Record<string, string>) => TRAMOS.filter((k) => k !== 'aVencer').reduce((acc, k) => acc.plus(t[k]), cero).toFixed(2);
    const meses = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(inicioSerie.getUTCFullYear(), inicioSerie.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
    const porMes = new Map(this.agrupar(s, 'mes').map((f) => [f.clave, f]));
    return {
      periodo: { desde: q.desde, hasta: q.hasta },
      ...(aviso ? { aviso } : {}),
      indicadores: {
        ventas: { valor: rp.ventas, anterior: ra.ventas, anioAnterior: ry.ventas },
        margenPct: { valor: rp.margenPct, anterior: ra.margenPct, anioAnterior: ry.margenPct },
        cobranzasVencidas: { valor: vencido(clientes.totales) },
        deudaVencida: { valor: vencido(proveedores.totales) },
        stock: { valor: [...stock.values()].reduce((acc, v) => acc.plus(v), cero).toFixed(2) },
      },
      ventasPorMes: meses.map((mes) => {
        const f = porMes.get(mes);
        return { mes, ventas: f?.ventas ?? '0.00', costo: f?.costo ?? '0.00', margen: f?.margen ?? '0.00' };
      }),
      topClientes: this.agrupar(p, 'cliente').slice(0, 10).map((f) => ({ id: f.clave, nombre: f.nombre, ventas: f.ventas })),
      topArticulos: this.agrupar(p.filter((r) => r.articuloId), 'articulo').slice(0, 10).map((f) => {
        const r = p.find((x) => x.articuloId === f.clave)!;
        return { id: f.clave, codigo: r.codigo, descripcion: r.descripcion, ventas: f.ventas, margen: f.margen };
      }),
    };
  }

  agrupar(rs: RenglonVendido[], por: Agrupar): FilaVentas[] {
    const grupos = new Map<string, { nombre: string; rs: RenglonVendido[] }>();
    for (const r of rs) {
      const [clave, nombre] = por === 'cliente' ? [r.terceroId, r.cliente] : por === 'mes' ? [r.mes, r.mes] : [r.articuloId ?? 'sin-articulo', r.articuloId ? `${r.codigo} ${r.descripcion}` : 'Sin artículo'];
      const g = grupos.get(clave) ?? { nombre, rs: [] };
      g.rs.push(r);
      grupos.set(clave, g);
    }
    const filas = [...grupos].map(([clave, g]) => ({ clave, nombre: g.nombre, ...resumir(g.rs) }));
    filas.sort((a, b) => (por === 'mes' ? a.clave.localeCompare(b.clave) : b._ventas.cmp(a._ventas)));
    return filas.map(({ _ventas, _margen, _costo, cobertura, ...f }) => { void _ventas; void _margen; void _costo; void cobertura; return f; });
  }

  async ventas(q: { desde?: string; hasta?: string; agrupar?: string; reexpresar?: string }) {
    const { desde, hasta } = this.periodo(q);
    const por = (['cliente', 'articulo', 'mes'].includes(q.agrupar ?? '') ? q.agrupar : 'cliente') as Agrupar;
    const { rs, aviso } = await this.vendidos(this.tenant.db, desde, hasta, q.reexpresar === 'true');
    const { _ventas, _margen, _costo, ...totales } = resumir(rs);
    void _ventas; void _margen; void _costo;
    return { filas: this.agrupar(rs, por), totales, ...(aviso ? { aviso } : {}) };
  }

  async antiguedad(q: { tipo?: string; fecha?: string }) {
    if (q.tipo !== 'clientes' && q.tipo !== 'proveedores') throw new BadRequestException('Tipo inválido: use clientes o proveedores');
    return antiguedad(this.tenant.db, q.tipo, fechaQuery(q.fecha, true)!);
  }

  async rotacion(q: { desde?: string; hasta?: string }) {
    const db = this.tenant.db;
    const { desde, hasta } = this.periodo(q);
    const dias = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1;
    const [inicial, final, rs] = await Promise.all([valorStock(db, desde, false), valorStock(db, hasta), renglonesVendidos(db, desde, hasta)]);
    const costo = new Map<string, Dec>();
    for (const r of rs) if (r.articuloId && r.costo !== null) costo.set(r.articuloId, (costo.get(r.articuloId) ?? cero).plus(r.costo));
    const ids = [...new Set([...inicial.keys(), ...final.keys(), ...costo.keys()])];
    const arts = await db.articulo.findMany({ where: { id: { in: ids }, controlaStock: true }, orderBy: { codigo: 'asc' } });
    let ti = cero, tf = cero, tc = cero;
    const filas = arts.map((a) => {
      const si = inicial.get(a.id) ?? cero, sf = final.get(a.id) ?? cero, cv = costo.get(a.id) ?? cero;
      ti = ti.plus(si); tf = tf.plus(sf); tc = tc.plus(cv);
      return { articuloId: a.id, codigo: a.codigo, descripcion: a.descripcion, stockInicial: si.toFixed(2), stockFinal: sf.toFixed(2), costoVendido: cv.toFixed(2), ...rotacion(cv, si, sf, dias) };
    }).filter((f) => Number(f.stockInicial) || Number(f.stockFinal) || Number(f.costoVendido));
    return { filas, totales: { stockInicial: ti.toFixed(2), stockFinal: tf.toFixed(2), costoVendido: tc.toFixed(2), ...rotacion(tc, ti, tf, dias) } };
  }

  async margenes(q: { desde?: string; hasta?: string; agrupar?: string; reexpresar?: string }) {
    const r = await this.ventas({ ...q, agrupar: q.agrupar === 'cliente' ? 'cliente' : 'articulo' });
    return { ...r, filas: r.filas.filter((f) => f.margenPct !== null).sort((a, b) => new D(b.margen).cmp(a.margen)) };
  }
}
