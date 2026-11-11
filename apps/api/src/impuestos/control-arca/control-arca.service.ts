import { Injectable } from '@nestjs/common';
import { cbteTipo, normalizarCuit, type LetraVenta } from '@gestion/shared';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { codigoCompra } from '../codigos';
import { ventasDelAmbiente } from '../libros-iva/libro-ventas.service';
import { leerMisComprobantes } from './lector-mis-comprobantes';

interface Importes { total: string; neto: string | null; iva: string | null }
interface Registro { clave: string; fecha: string; tipo: number; puntoVenta: number; numero: number; documento: string; importes: Importes }

const f2 = (d: Dec) => d.toFixed(2);
const distinto = (a: string | null, b: string | null) => a !== null && b !== null && new D(a).minus(b).abs().gt('0.01');
/** Campos que difieren. Neto e IVA solo se comparan si el sistema los tiene discriminados (letras A y M; ventas B). */
const camposDistintos = (a: Importes, s: Importes) => [
  ...(distinto(a.total, s.total) ? ['Total'] : []), ...(distinto(a.neto, s.neto) ? ['Neto gravado'] : []), ...(distinto(a.iva, s.iva) ? ['IVA'] : []),
];

@Injectable()
export class ControlArcaService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Compara el CSV de "Mis Comprobantes" con lo cargado. Importes en pesos. No guarda nada. */
  async controlar(d: { sentido: 'RECIBIDOS' | 'EMITIDOS'; desde: string; hasta: string; archivo: Buffer }) {
    const desde = fechaQuery(d.desde, true)!, hasta = fechaQuery(d.hasta, true)!;
    const enRango = (f: string) => f >= d.desde && f <= d.hasta;
    const arca: Registro[] = leerMisComprobantes(d.archivo).filas.filter((f) => enRango(f.fecha)).map((f) => {
      const tc = f.tipoCambio && new D(f.tipoCambio).gt(0) ? new D(f.tipoCambio) : new D(1);
      const p = (x: string | null) => (x === null ? null : f2(new D(x).mul(tc)));
      return {
        clave: d.sentido === 'RECIBIDOS' ? `${f.documento}|${f.tipo}|${f.puntoVenta}|${f.numero}` : `${f.tipo}|${f.puntoVenta}|${f.numero}`,
        fecha: f.fecha, tipo: f.tipo, puntoVenta: f.puntoVenta, numero: f.numero, documento: f.documento, importes: { total: p(f.total)!, neto: p(f.netoGravado), iva: p(f.iva) },
      };
    });
    const db = this.tenant.db;
    const sistema: Registro[] = [];
    if (d.sentido === 'RECIBIDOS') {
      for (const c of await db.comprobanteCompra.findMany({ where: { estado: 'CONFIRMADO', fechaEmision: { gte: desde, lte: hasta } }, include: { tercero: true } })) {
        const tipo = codigoCompra(c.tipo, c.letra), doc = normalizarCuit(c.tercero.cuit);
        sistema.push({
          clave: `${doc}|${tipo}|${c.puntoVenta}|${c.numero}`, fecha: c.fechaEmision.toISOString().slice(0, 10), tipo, puntoVenta: c.puntoVenta, numero: c.numero, documento: doc,
          importes: c.letra === 'A' || c.letra === 'M'
            ? { total: f2(c.totalPesos), neto: f2(c.netoGravado.mul(c.cotizacion)), iva: f2(c.iva.mul(c.cotizacion)) }
            : { total: f2(c.totalPesos), neto: null, iva: null },
        });
      }
    } else {
      const { ambiente } = await ventasDelAmbiente(db, desde, hasta);
      for (const c of await db.comprobanteVenta.findMany({ where: { estado: 'AUTORIZADO', ambiente, fecha: { gte: desde, lte: hasta } }, include: { tercero: true } })) {
        const tipo = cbteTipo(c.tipo, c.letra as LetraVenta);
        sistema.push({
          clave: `${tipo}|${c.puntoVenta}|${c.numero}`, fecha: c.fecha.toISOString().slice(0, 10), tipo, puntoVenta: c.puntoVenta, numero: c.numero!, documento: c.tercero.cuit,
          importes: c.letra === 'C'
            ? { total: f2(c.totalPesos), neto: null, iva: null }
            : { total: f2(c.totalPesos), neto: f2(c.netoGravado.mul(c.cotizacion)), iva: f2(c.iva.mul(c.cotizacion)) },
        });
      }
    }
    const porClave = new Map(sistema.map((s) => [s.clave, s]));
    const vistos = new Set<string>();
    const soloArca = [], diferencias = [];
    let coinciden = 0;
    for (const a of arca) {
      const s = porClave.get(a.clave);
      if (!s) { soloArca.push({ fecha: a.fecha, tipo: a.tipo, puntoVenta: a.puntoVenta, numero: a.numero, documento: a.documento, total: a.importes.total }); continue; }
      vistos.add(a.clave);
      const campos = camposDistintos(a.importes, s.importes);
      if (campos.length) diferencias.push({ fecha: a.fecha, tipo: a.tipo, puntoVenta: a.puntoVenta, numero: a.numero, documento: a.documento, campos, arca: a.importes, sistema: s.importes });
      else coinciden++;
    }
    const soloSistema = sistema.filter((s) => !vistos.has(s.clave)).map((s) => ({ fecha: s.fecha, tipo: s.tipo, puntoVenta: s.puntoVenta, numero: s.numero, documento: s.documento, total: s.importes.total }));
    return { coinciden, diferencias, soloArca, soloSistema };
  }
}
