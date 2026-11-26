/** E57: cliente del web service del COT de ARBA (presentación de remitos). */

export interface RespuestaCot { remitos: { codigoUnico: string; cot: string | null; errores: string[] }[]; errores: string[] }
export interface ClienteCot {
  presentar(empresaId: string, usuario: string, clave: string, nombre: string, contenido: string): Promise<RespuestaCot>;
}
export class ErrorConexionCot extends Error {}

const URLS = {
  PRUEBA: 'https://cot.test.arba.gov.ar/TransporteBienes/SeguridadCliente/presentarRemitos.do',
  PRODUCCION: 'https://cot.arba.gov.ar/TransporteBienes/SeguridadCliente/presentarRemitos.do',
} as const;

const etiqueta = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1].trim());

/** Respuesta XML de ARBA: `<validacionesRemitos><remito><numeroUnico/><procesado/><cot/><errores><error><descripcion/>…` o `<TBError>`. */
export function parsearRespuestaCot(xml: string): RespuestaCot {
  const errores = etiqueta(xml, 'TBError').flatMap((e) => etiqueta(e, 'mensajeError'));
  const remitos = etiqueta(xml, 'remito').map((r) => ({
    codigoUnico: etiqueta(r, 'numeroUnico')[0] ?? '',
    cot: etiqueta(r, 'procesado')[0] === 'SI' ? (etiqueta(r, 'cot')[0] ?? null) : null,
    errores: etiqueta(r, 'error').flatMap((e) => etiqueta(e, 'descripcion')),
  }));
  return { remitos, errores };
}

export class ArbaCotReal implements ClienteCot {
  constructor(private readonly ambiente: 'PRUEBA' | 'PRODUCCION') {}
  async presentar(_empresaId: string, usuario: string, clave: string, nombre: string, contenido: string): Promise<RespuestaCot> {
    const form = new FormData();
    form.append('user', usuario);
    form.append('password', clave);
    form.append('file', new Blob([contenido], { type: 'text/plain' }), nombre);
    let r: Response;
    try {
      r = await fetch(URLS[this.ambiente], { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw new ErrorConexionCot(e instanceof Error ? e.message : String(e));
    }
    if (r.status >= 500) throw new ErrorConexionCot(`ARBA respondió ${r.status}`);
    return parsearRespuestaCot(await r.text());
  }
}

type FallaCot = 'RECHAZO' | 'SIN_CONEXION';
const fallas = new Map<string, FallaCot>();
const archivos = new Map<string, { nombre: string; contenido: string }>();
let contador = 0;

/** Ambiente SIMULADO: otorga un COT de 16 dígitos por remito del archivo; fallas forzables solo en pruebas. */
export class ArbaCotSimulado implements ClienteCot {
  static forzarFalla(empresaId: string, falla: FallaCot | null) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Solo disponible en pruebas');
    if (falla) fallas.set(empresaId, falla);
    else fallas.delete(empresaId);
  }
  static ultimoArchivo(empresaId: string) { return archivos.get(empresaId) ?? null; }
  static limpiar() { fallas.clear(); archivos.clear(); }

  async presentar(empresaId: string, _usuario: string, _clave: string, nombre: string, contenido: string): Promise<RespuestaCot> {
    archivos.set(empresaId, { nombre, contenido });
    const falla = fallas.get(empresaId);
    if (falla === 'SIN_CONEXION') throw new ErrorConexionCot('Sin conexión simulada');
    const codigos = contenido.split('\r\n').filter((l) => l.startsWith('02|')).map((l) => l.split('|')[2]);
    return {
      errores: [],
      remitos: codigos.map((codigoUnico) => falla === 'RECHAZO'
        ? { codigoUnico, cot: null, errores: ['Rechazo simulado para pruebas'] }
        : { codigoUnico, cot: String(1000000000000000 + Date.now() % 1000000000 * 1000 + (++contador % 1000)).slice(0, 16), errores: [] }),
    };
  }
}
