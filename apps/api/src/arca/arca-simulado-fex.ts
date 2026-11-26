import { TxEmpresa } from '../prisma/tenant-prisma.service';
import { ComprobanteArca, ErrorConexionArca, ResultadoCae } from './cliente-arca';
import type { ClienteFex, DatosFex } from './wsfex';

export type FallaFex = 'RECHAZO' | 'SIN_CONEXION';
const fallas = new Map<string, FallaFex>();
const solicitudes = new Map<string, DatosFex>();
const ids = new Map<string, number>();
const fechaDb = (f: string) => new Date(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}T00:00:00Z`);

/** E58: WSFEX simulado (pruebas y demo): numeración correlativa por punto de venta y tipo, CAE determinista. */
export class ArcaSimuladoFex implements ClienteFex {
  constructor(private readonly db: TxEmpresa, private readonly empresaId: string) {}

  /** Solo en pruebas: la próxima autorización falla de esa forma (se consume una vez). */
  static forzarFalla(empresaId: string, falla: FallaFex | null) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Solo disponible en pruebas');
    if (falla) fallas.set(empresaId, falla);
    else fallas.delete(empresaId);
  }
  /** Solo en pruebas: lo último que se pidió autorizar. */
  static ultimaSolicitud(empresaId: string): DatosFex | undefined {
    return solicitudes.get(empresaId);
  }

  async ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number> {
    const r = await this.db.arcaSimuladoComprobante.aggregate({ where: { ptoVta, cbteTipo }, _max: { numero: true } });
    return r._max.numero ?? 0;
  }
  async ultimoId(): Promise<number> {
    return ids.get(this.empresaId) ?? 0;
  }
  async consultar(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteArca | null> {
    const c = await this.db.arcaSimuladoComprobante.findFirst({ where: { ptoVta, cbteTipo, numero } });
    if (!c) return null;
    return { numero: c.numero, docNro: c.docNro, fecha: c.fecha.toISOString().slice(0, 10), impTotal: c.total.toFixed(2), monId: c.moneda, cae: c.cae, caeVencimiento: c.caeVencimiento.toISOString().slice(0, 10) };
  }
  async autorizar(d: DatosFex): Promise<ResultadoCae> {
    const falla = fallas.get(this.empresaId);
    fallas.delete(this.empresaId);
    if (falla === 'SIN_CONEXION') throw new ErrorConexionArca('No se pudo conectar con ARCA: tiempo de espera agotado (simulado)');
    if (falla === 'RECHAZO') return { resultado: 'R', errores: ['(1000) Rechazo simulado de WSFEX'] };
    if (process.env.NODE_ENV === 'test') solicitudes.set(this.empresaId, d);
    const errores: string[] = [];
    if (d.numero !== (await this.ultimoAutorizado(d.ptoVta, d.cbteTipo)) + 1) errores.push('(1530) El número de comprobante no es el próximo a autorizar');
    if (d.id <= (await this.ultimoId())) errores.push('(1520) El Id ya fue utilizado');
    if (d.cbteTipo !== 19 && !d.asociados.length) errores.push('(1540) Las notas de débito y crédito deben informar el comprobante asociado');
    if (errores.length) return { resultado: 'R', errores };
    ids.set(this.empresaId, d.id);
    const cae = `8${String(d.ptoVta).padStart(4, '0')}${String(d.cbteTipo).padStart(2, '0')}${String(d.numero).padStart(7, '0')}`;
    const vence = fechaDb(d.fecha);
    vence.setUTCDate(vence.getUTCDate() + 10);
    await this.db.arcaSimuladoComprobante.create({
      data: { empresaId: this.empresaId, ptoVta: d.ptoVta, cbteTipo: d.cbteTipo, numero: d.numero, cae, caeVencimiento: vence, docNro: d.cuitPaisCliente, fecha: fechaDb(d.fecha), total: d.impTotal, moneda: d.monedaId },
    });
    return { resultado: 'A', cae, caeVencimiento: vence.toISOString().slice(0, 10), observaciones: [] };
  }
  async probar() {
    return { ok: true, detalle: 'Modo simulado: no se conecta con ARCA' };
  }
}
