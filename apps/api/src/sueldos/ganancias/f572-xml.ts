import { XMLParser } from 'fast-xml-parser';
import { NOMBRE_DEDUCCION, TipoDeduccion } from './calculo';

/** Contenido del F.572 web que usa el cálculo (spec E31 §4). Importes como texto con 2 decimales. */
export interface DatosF572 {
  cargas: { parentesco: string; documento: string; nombre: string; mesDesde: number; mesHasta: number; porcentaje: number }[];
  otrosEmpleadores: { cuit: string; nombre: string; meses: { mes: number; bruta: string; aportes: string; retenido: string }[] }[];
  deducciones: { tipo: TipoDeduccion; codigo: string; prestador: string; meses: { mes: number; importe: string }[] }[];
}

/**
 * Mapeo declarativo del XML del SiRADIG (Sección A). PROVISIONAL (spec E31 §11): armado con la estructura conocida del formulario;
 * se verifica con un XML real descargado del SiRADIG y se corrige acá, sin tocar la lógica.
 */
export const XML_F572 = {
  raiz: 'presentacion', periodo: 'periodo', nroPresentacion: 'nroPresentacion', fecha: 'fechaPresentacion',
  empleado: 'empleado', agente: 'agenteRetencion', cuit: 'cuit',
  cargas: ['cargasFamilia', 'cargaFamilia'], carga: { nroDoc: 'nroDoc', apellido: 'apellido', nombre: 'nombre', mesDesde: 'mesDesde', mesHasta: 'mesHasta', parentesco: 'parentesco', porcentaje: 'porcentajeDeduccion' },
  otros: ['ganLiqOtrosEmpEnt', 'empEnt'], otro: { cuit: 'cuit', nombre: 'denominacion', meses: ['ingresosAportes', 'ingAp'], mes: '@_mes', bruta: 'ganBrut', obraSocial: 'obraSoc', seguridadSocial: 'segSoc', sindicato: 'sind', retenido: 'retGan' },
  deducciones: ['deducciones', 'deduccion'], deduccion: { tipo: '@_tipo', prestador: 'denominacion', periodos: ['periodos', 'periodo'], desde: '@_mesDesde', hasta: '@_mesHasta', monto: '@_montoMensual' },
} as const;

/** Códigos de parentesco del SiRADIG (PROVISIONAL, §11). */
export const PARENTESCOS: Record<string, string> = { 1: 'CONYUGE', 51: 'CONYUGE', 3: 'HIJO', 31: 'HIJO_INCAPACITADO' };
/** Códigos de tipo de deducción del SiRADIG (PROVISIONAL, §11). */
export const TIPOS_DEDUCCION: Record<string, TipoDeduccion> = {
  1: 'CUOTAS_MEDICAS', 2: 'SEGURO_MUERTE', 3: 'DONACIONES', 4: 'INTERESES_HIPOTECARIOS', 5: 'SEPELIO', 7: 'GASTOS_MEDICOS', 8: 'SERVICIO_DOMESTICO',
  9: 'SGR', 10: 'VEHICULOS_CORREDORES', 11: 'INTERESES_CORREDORES', 21: 'CAJAS_JUBILACION', 22: 'ALQUILER', 23: 'SEGURO_MIXTO', 24: 'SEGURO_RETIRO', 32: 'EDUCACION', 33: 'INDUMENTARIA',
};

export class ErrorF572 extends Error {}

type Nodo = Record<string, unknown>;
const lista = (n: unknown, ruta: readonly string[]): Nodo[] => {
  let actual: unknown = n;
  for (const k of ruta.slice(0, -1)) actual = (actual as Nodo | undefined)?.[k];
  const v = (actual as Nodo | undefined)?.[ruta[ruta.length - 1]];
  return v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? (v as Nodo[]) : [v as Nodo];
};
const texto = (n: Nodo | undefined, k: string) => (n?.[k] === undefined || n?.[k] === null ? '' : String(n[k]).trim());
const entero = (n: Nodo | undefined, k: string) => Number.parseInt(texto(n, k), 10);
const importe = (v: string | number) => {
  const x = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(x) || x < 0) throw new ErrorF572('Importe inválido');
  return x.toFixed(2);
};
const mesValido = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;

/** Lee un XML del F.572 web (Sección A). Lanza ErrorF572 si el archivo no se puede interpretar. */
export function leerF572(xml: string): { cuil: string; cuitAgente: string; anio: number; nroPresentacion: number; fecha: string | null; datos: DatosF572; avisos: string[] } {
  let doc: Nodo;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false }).parse(xml, true) as Nodo;
  } catch {
    throw new ErrorF572('XML inválido');
  }
  const m = XML_F572;
  const p = doc[m.raiz] as Nodo | undefined;
  if (!p || typeof p !== 'object') throw new ErrorF572('XML inválido');
  const anio = entero(p, m.periodo);
  const cuil = texto(p[m.empleado] as Nodo, m.cuit).replace(/\D/g, '');
  const cuitAgente = texto(p[m.agente] as Nodo, m.cuit).replace(/\D/g, '');
  if (!Number.isInteger(anio) || cuil.length !== 11) throw new ErrorF572('XML inválido');
  const avisos: string[] = [];
  const cargas = lista(p, m.cargas).map((c) => ({
    parentesco: PARENTESCOS[texto(c, m.carga.parentesco)] ?? 'OTRO', documento: texto(c, m.carga.nroDoc), nombre: `${texto(c, m.carga.apellido)} ${texto(c, m.carga.nombre)}`.trim(),
    mesDesde: entero(c, m.carga.mesDesde) || 1, mesHasta: entero(c, m.carga.mesHasta) || 12, porcentaje: entero(c, m.carga.porcentaje) === 50 ? 50 : 100,
  }));
  const otrosEmpleadores = lista(p, m.otros).map((o) => ({
    cuit: texto(o, m.otro.cuit).replace(/\D/g, ''), nombre: texto(o, m.otro.nombre),
    meses: lista(o, m.otro.meses).map((x) => ({
      mes: entero(x, m.otro.mes), bruta: importe(texto(x, m.otro.bruta) || 0),
      aportes: importe(['obraSocial', 'seguridadSocial', 'sindicato'].reduce((s, k) => s + Number(texto(x, m.otro[k as 'obraSocial']) || 0), 0)),
      retenido: importe(texto(x, m.otro.retenido) || 0),
    })).filter((x) => mesValido(x.mes)),
  }));
  const deducciones = lista(p, m.deducciones).map((d) => {
    const codigo = texto(d, m.deduccion.tipo);
    const prestador = texto(d, m.deduccion.prestador);
    const tipo = TIPOS_DEDUCCION[codigo] ?? 'OTRA';
    if (tipo === 'OTRA') avisos.push(`Deducción con código ${codigo} (${prestador || 'sin prestador'}) sin equivalente: se guarda y no se deduce`);
    const meses: { mes: number; importe: string }[] = [];
    for (const per of lista(d, m.deduccion.periodos)) {
      const desde = entero(per, m.deduccion.desde);
      const hasta = entero(per, m.deduccion.hasta) || desde;
      const monto = importe(texto(per, m.deduccion.monto) || 0);
      for (let mes = desde; mes <= hasta; mes++) if (mesValido(mes)) meses.push({ mes, importe: monto });
    }
    return { tipo, codigo, prestador, meses };
  });
  const fecha = texto(p, m.fecha);
  return { cuil, cuitAgente, anio, nroPresentacion: entero(p, m.nroPresentacion) || 0, fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null, datos: { cargas, otrosEmpleadores, deducciones }, avisos };
}

export const TIPOS_DEDUCCION_VALIDOS = Object.keys(NOMBRE_DEDUCCION) as TipoDeduccion[];
