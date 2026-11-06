import { Prisma } from '@prisma/client';
import { TxEmpresa } from '../prisma/tenant-prisma.service';
import { ClienteArca, ComprobanteArca, DatosCae, ErrorConexionArca, ResultadoCae } from './cliente-arca';

export type FallaSimulada = 'RECHAZO' | 'SIN_CONEXION' | 'AUTORIZA_SIN_RESPONDER';
const NC_ND = new Set([2, 3, 7, 8, 12, 13]);
const fallas = new Map<string, FallaSimulada>();
const iso = (f: string) => `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
const fechaDb = (f: string) => new Date(`${iso(f)}T00:00:00Z`);

/**
 * ARCA simulado para pruebas y demo: numera correlativo por punto de venta y tipo, devuelve CAE determinista
 * con vencimiento a 10 días y aplica algunas validaciones reales. Escribe fuera de la transacción del llamador,
 * como un servicio externo.
 */
export class ArcaSimulado implements ClienteArca {
  constructor(private readonly db: TxEmpresa, private readonly empresaId: string) {}

  /** Solo en pruebas: la próxima solicitud de CAE de la empresa falla de esa forma (se consume una vez). */
  static forzarFalla(empresaId: string, falla: FallaSimulada | null) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Solo disponible en pruebas');
    if (falla) fallas.set(empresaId, falla);
    else fallas.delete(empresaId);
  }

  async ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number> {
    const r = await this.db.arcaSimuladoComprobante.aggregate({ where: { ptoVta, cbteTipo }, _max: { numero: true } });
    return r._max.numero ?? 0;
  }

  async consultar(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteArca | null> {
    const c = await this.db.arcaSimuladoComprobante.findFirst({ where: { ptoVta, cbteTipo, numero } });
    if (!c) return null;
    return {
      numero: c.numero, docNro: c.docNro, fecha: c.fecha.toISOString().slice(0, 10), impTotal: c.total.toFixed(2), monId: c.moneda,
      cae: c.cae, caeVencimiento: c.caeVencimiento.toISOString().slice(0, 10),
    };
  }

  async solicitarCae(d: DatosCae): Promise<ResultadoCae> {
    const falla = fallas.get(this.empresaId);
    fallas.delete(this.empresaId);
    if (falla === 'SIN_CONEXION') throw new ErrorConexionArca('No se pudo conectar con ARCA: tiempo de espera agotado (simulado)');
    if (falla === 'RECHAZO') return { resultado: 'R', errores: ['(10015) Rechazo simulado para pruebas'] };
    const errores: string[] = [];
    if (d.numero !== (await this.ultimoAutorizado(d.ptoVta, d.cbteTipo)) + 1) errores.push('(10016) El numero de comprobante no es el proximo a autorizar');
    const D = Prisma.Decimal;
    const suma = new D(d.impTotConc).plus(d.impNeto).plus(d.impOpEx).plus(d.impIva);
    if (!suma.eq(d.impTotal)) errores.push('(10048) El campo ImpTotal no coincide con la suma de los importes');
    if (NC_ND.has(d.cbteTipo) && !d.asociados.length) errores.push('(10197) Debe informar comprobantes asociados');
    if (!d.iva.reduce((s, x) => s.plus(x.importe), new D(0)).eq(d.impIva)) errores.push('(10018) La suma del IVA no coincide con ImpIVA');
    if (errores.length) return { resultado: 'R', errores };
    const cae = `7${String(d.ptoVta).padStart(4, '0')}${String(d.cbteTipo).padStart(2, '0')}${String(d.numero).padStart(7, '0')}`;
    const vence = fechaDb(d.fecha);
    vence.setUTCDate(vence.getUTCDate() + 10);
    await this.db.arcaSimuladoComprobante.create({
      data: { empresaId: this.empresaId, ptoVta: d.ptoVta, cbteTipo: d.cbteTipo, numero: d.numero, cae, caeVencimiento: vence, docNro: d.docNro, fecha: fechaDb(d.fecha), total: d.impTotal, moneda: d.monId },
    });
    if (falla === 'AUTORIZA_SIN_RESPONDER') throw new ErrorConexionArca('No se pudo conectar con ARCA: la conexión se cortó (simulado)');
    return { resultado: 'A', cae, caeVencimiento: vence.toISOString().slice(0, 10), observaciones: [] };
  }

  async probar() {
    return { ok: true, detalle: 'Modo simulado: no se conecta con ARCA' };
  }
}
