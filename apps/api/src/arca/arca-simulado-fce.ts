import { TxEmpresa } from '../prisma/tenant-prisma.service';
import { ErrorConexionArca } from './cliente-arca';
import { ClaveFce, ClienteFce, EstadoFce, FceArca, ObligacionFce } from './cliente-fce';

/** Estado del registro simulado por empresa (en memoria; solo las pruebas lo cargan). */
interface Registro {
  obligados: Map<string, string | null>;
  recibidas: FceArca[];
  estados: Map<string, { estado: EstadoFce; motivos: string[] }>;
  sinConexion: boolean;
  consultas: number;
}
const registros = new Map<string, Registro>();
const reg = (empresaId: string): Registro => {
  let r = registros.get(empresaId);
  if (!r) registros.set(empresaId, (r = { obligados: new Map(), recibidas: [], estados: new Map(), sinConexion: false, consultas: 0 }));
  return r;
};
const soloPruebas = () => { if (process.env.NODE_ENV !== 'test') throw new Error('Solo disponible en pruebas'); };
export const claveFce = (f: ClaveFce) => `${f.cuitEmisor.replace(/\D/g, '')}-${f.cbteTipo}-${f.ptoVta}-${f.numero}`;
const MOTIVOS = [{ codigo: '1', descripcion: 'Mercadería no entregada' }, { codigo: '2', descripcion: 'Diferencias de precio o cantidad' }, { codigo: '3', descripcion: 'Mercadería dañada' }];
const iso = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const mas30 = (f: string) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); };

/**
 * Registro de FCE simulado (E50). Emitidas: las FCE (201/206/211) que autorizó el ARCA simulado, pendientes con 30 días de plazo
 * salvo el estado fijado. Recibidas y obligados: solo los que cargan las pruebas; fuera de pruebas nadie está obligado.
 */
export class ArcaSimuladoFce implements ClienteFce {
  constructor(private readonly db: TxEmpresa, private readonly empresaId: string, private readonly cuit: string) {}

  static obligar(empresaId: string, cuit: string, montoMinimo: string | null) { soloPruebas(); reg(empresaId).obligados.set(cuit.replace(/\D/g, ''), montoMinimo); }
  static recibir(empresaId: string, f: FceArca) { soloPruebas(); reg(empresaId).recibidas.push({ ...f }); }
  static fijarEstado(empresaId: string, f: ClaveFce, estado: EstadoFce, motivos: string[] = []) { soloPruebas(); reg(empresaId).estados.set(claveFce(f), { estado, motivos }); }
  static forzarSinConexion(empresaId: string, si: boolean) { soloPruebas(); reg(empresaId).sinConexion = si; }
  static consultasObligacion(empresaId: string) { soloPruebas(); return reg(empresaId).consultas; }
  static limpiar(empresaId?: string) { if (empresaId) registros.delete(empresaId); else registros.clear(); }

  private conectar() {
    if (reg(this.empresaId).sinConexion) throw new ErrorConexionArca('No se pudo conectar con ARCA: tiempo de espera agotado (simulado)');
  }

  private aplicar(f: FceArca): FceArca {
    const e = reg(this.empresaId).estados.get(claveFce(f));
    return e ? { ...f, estado: e.estado, motivosRechazo: e.motivos } : f;
  }

  async consultarObligacion(cuit: string, _fecha?: string): Promise<ObligacionFce> {
    this.conectar();
    const r = reg(this.empresaId);
    r.consultas++;
    const n = cuit.replace(/\D/g, '');
    return r.obligados.has(n) ? { obligado: true, montoMinimo: r.obligados.get(n) ?? null } : { obligado: false, montoMinimo: null };
  }

  async consultarComprobantes(rol: 'EMISOR' | 'RECEPTOR', desde: string, hasta: string): Promise<FceArca[]> {
    this.conectar();
    const [d, h] = [iso(desde), iso(hasta)];
    if (rol === 'RECEPTOR') return reg(this.empresaId).recibidas.filter((f) => f.fecha >= d && f.fecha <= h).map((f) => this.aplicar(f));
    const emitidas = await this.db.arcaSimuladoComprobante.findMany({ where: { cbteTipo: { in: [201, 206, 211] }, fecha: { gte: new Date(`${d}T00:00:00Z`), lte: new Date(`${h}T00:00:00Z`) } } });
    return emitidas.map((c) => {
      const fecha = c.fecha.toISOString().slice(0, 10);
      return this.aplicar({
        cuitEmisor: this.cuit, cuitReceptor: c.docNro.replace(/\D/g, ''), cbteTipo: c.cbteTipo, ptoVta: c.ptoVta, numero: c.numero, fecha, importe: c.total.toFixed(2),
        moneda: c.moneda, fechaVencimientoPago: null, estado: 'PENDIENTE', fechaRecepcion: fecha, fechaLimite: mas30(fecha), motivosRechazo: [],
      });
    });
  }

  private cambiar(f: ClaveFce, estado: EstadoFce, motivos: string[]) {
    const r = reg(this.empresaId);
    const i = r.recibidas.findIndex((x) => claveFce(x) === claveFce(f));
    if (i >= 0) r.recibidas[i] = { ...r.recibidas[i], estado, motivosRechazo: motivos };
    r.estados.set(claveFce(f), { estado, motivos });
  }

  async aceptar(f: ClaveFce & { importe: string }): Promise<void> {
    this.conectar();
    this.cambiar(f, 'ACEPTADA', []);
  }

  async rechazar(f: ClaveFce, motivos: string[], _texto?: string): Promise<void> {
    this.conectar();
    this.cambiar(f, 'RECHAZADA', motivos.map((m) => MOTIVOS.find((x) => x.codigo === m)?.descripcion ?? m));
  }

  async motivosRechazo() {
    this.conectar();
    return MOTIVOS;
  }
}
