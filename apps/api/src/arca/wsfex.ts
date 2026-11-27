import { ComprobanteArca, ErrorConexionArca, ErrorServicioArca, ResultadoCae } from './cliente-arca';
import type { AuthWsfe } from './wsfe';
import { escaparXml, leerXml } from './xml';

/** E58: web service de factura de exportación de ARCA (WSFEX v1). Estructura según el manual de WSFEX (a verificar). */
export const NS_FEX = 'http://ar.gov.afip.dif.fexv1/';

export interface DatosFex {
  id: number; fecha: string; cbteTipo: 19 | 20 | 21; ptoVta: number; numero: number; tipoExpo: 1 | 2 | 4;
  permisoExistente: 'S' | 'N' | ''; permisos: { id: string; dstMerc: number }[]; dstCmp: number;
  cliente: string; cuitPaisCliente: string; domicilioCliente: string; idImpositivo: string;
  monedaId: 'DOL' | 'PES'; monedaCtz: string; impTotal: string; formaPago: string; incoterms: string; incotermsDs: string; idioma: 1 | 2 | 3;
  asociados: { tipo: number; ptoVta: number; nro: number; cuit: string }[];
  items: { codigo: string; descripcion: string; cantidad: string; umed: number; precio: string; bonificacion: string; total: string }[];
}

export interface ClienteFex {
  ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number>;
  ultimoId(): Promise<number>;
  consultar(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteArca | null>;
  autorizar(d: DatosFex): Promise<ResultadoCae>;
  probar(): Promise<{ ok: boolean; detalle: string }>;
}

const sobre = (op: string, cuerpo: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS_FEX}"><soapenv:Header/><soapenv:Body><ar:${op}>${cuerpo}</ar:${op}></soapenv:Body></soapenv:Envelope>`;
const t = (tag: string, v: string | number) => `<ar:${tag}>${typeof v === 'string' ? escaparXml(v) : v}</ar:${tag}>`;
const auth = (a: AuthWsfe, extra = '') => `<ar:Auth>${t('Token', a.token)}${t('Sign', a.sign)}${t('Cuit', a.cuit)}${extra}</ar:Auth>`;

export const xmlFexDummy = () => sobre('FEXDummy', '');
export const xmlFexUltimo = (a: AuthWsfe, ptoVta: number, cbteTipo: number) => sobre('FEXGetLast_CMP', auth(a, t('Pto_venta', ptoVta) + t('Cbte_Tipo', cbteTipo)));
export const xmlFexUltimoId = (a: AuthWsfe) => sobre('FEXGetLast_ID', auth(a));
export const xmlFexConsultar = (a: AuthWsfe, ptoVta: number, cbteTipo: number, numero: number) =>
  sobre('FEXGetCMP', auth(a) + `<ar:Cmp>${t('Cbte_tipo', cbteTipo)}${t('Punto_vta', ptoVta)}${t('Cbte_nro', numero)}</ar:Cmp>`);

export function xmlFexAuthorize(a: AuthWsfe, d: DatosFex): string {
  const permisos = d.permisos.length ? `<ar:Permisos>${d.permisos.map((p) => `<ar:Permiso>${t('Id_permiso', p.id)}${t('Dst_merc', p.dstMerc)}</ar:Permiso>`).join('')}</ar:Permisos>` : '';
  const asoc = d.asociados.length
    ? `<ar:Cmps_asoc>${d.asociados.map((x) => `<ar:Cmp_asoc>${t('Cbte_tipo', x.tipo)}${t('Cbte_punto_vta', x.ptoVta)}${t('Cbte_nro', x.nro)}${t('Cbte_cuit', x.cuit)}</ar:Cmp_asoc>`).join('')}</ar:Cmps_asoc>`
    : '';
  const items = `<ar:Items>${d.items.map((i) => `<ar:Item>${t('Pro_codigo', i.codigo)}${t('Pro_ds', i.descripcion)}${t('Pro_qty', i.cantidad)}${t('Pro_umed', i.umed)}${t('Pro_precio_uni', i.precio)}${t('Pro_bonificacion', i.bonificacion)}${t('Pro_total_item', i.total)}</ar:Item>`).join('')}</ar:Items>`;
  const cmp = t('Id', d.id) + t('Fecha_cbte', d.fecha) + t('Cbte_Tipo', d.cbteTipo) + t('Punto_vta', d.ptoVta) + t('Cbte_nro', d.numero) + t('Tipo_expo', d.tipoExpo)
    + t('Permiso_existente', d.permisoExistente) + permisos + t('Dst_cmp', d.dstCmp) + t('Cliente', d.cliente) + t('Cuit_pais_cliente', d.cuitPaisCliente)
    + t('Domicilio_cliente', d.domicilioCliente) + t('Id_impositivo', d.idImpositivo) + t('Moneda_Id', d.monedaId) + t('Moneda_ctz', d.monedaCtz)
    + t('Obs_comerciales', '') + t('Imp_total', d.impTotal) + t('Obs', '') + asoc + t('Forma_pago', d.formaPago) + t('Incoterms', d.incoterms) + t('Incoterms_Ds', d.incotermsDs)
    + t('Idioma_cbte', d.idioma) + items;
  return sobre('FEXAuthorize', auth(a) + `<ar:Cmp>${cmp}</ar:Cmp>`);
}

const fechaIso = (f: string) => (f && f.length === 8 ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : '');
/** Errores de token de WSFEX (a verificar contra el manual; hoy ninguno conocido): se renovaría el ticket. */
const ERRORES_TOKEN = new Set<string>();

function resultado(xml: string, op: string): Record<string, any> {
  let doc: Record<string, any>;
  try {
    doc = leerXml(xml);
  } catch {
    throw new ErrorConexionArca('No se pudo conectar con ARCA: respuesta ilegible');
  }
  const body = doc?.Envelope?.Body;
  if (body?.Fault) throw new ErrorConexionArca(`No se pudo conectar con ARCA: ${body.Fault.faultstring ?? 'error del servicio'}`);
  const r = body?.[`${op}Response`]?.[`${op}Result`];
  if (r === undefined) throw new ErrorConexionArca('No se pudo conectar con ARCA: respuesta ilegible');
  return r ?? {};
}

const errorFex = (r: Record<string, any>) => {
  const e = r.FEXErr;
  return e && String(e.ErrCode) !== '0' ? `(${e.ErrCode}) ${e.ErrMsg}` : null;
};

export function leerFexAuthorize(xml: string): ResultadoCae {
  const r = resultado(xml, 'FEXAuthorize');
  const a = r.FEXResultAuth;
  const err = errorFex(r);
  const obs = a?.Motivos_Obs ? String(a.Motivos_Obs).split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
  if (a?.Resultado === 'A' && a.Cae) return { resultado: 'A', cae: String(a.Cae), caeVencimiento: fechaIso(String(a.Fch_venc_Cae)), observaciones: obs };
  if (err && ERRORES_TOKEN.has(String(r.FEXErr.ErrCode))) throw new ErrorConexionArca(`ARCA respondió con error: ${err}`, { tokenInvalido: true });
  return { resultado: 'R', errores: [...(err ? [err] : []), ...obs.map((o) => `(obs) ${o}`)] };
}

export function leerFexUltimo(xml: string): number {
  const r = resultado(xml, 'FEXGetLast_CMP');
  const err = errorFex(r);
  if (err) throw new ErrorServicioArca(`ARCA rechazó la consulta: ${err}`);
  return Number(r.FEXResult_LastCMP?.Cbte_nro ?? 0);
}

export function leerFexUltimoId(xml: string): number {
  const r = resultado(xml, 'FEXGetLast_ID');
  const err = errorFex(r);
  if (err) throw new ErrorServicioArca(`ARCA rechazó la consulta: ${err}`);
  return Number(r.FEXResultGet?.Id ?? 0);
}

export function leerFexConsultar(xml: string): ComprobanteArca | null {
  const r = resultado(xml, 'FEXGetCMP');
  const g = r.FEXResultGet;
  if (!g?.Cae) return null;
  return {
    numero: Number(g.Cbte_nro), docNro: String(g.Cuit_pais_cliente ?? ''), fecha: fechaIso(String(g.Fecha_cbte)), impTotal: Number(g.Imp_total).toFixed(2),
    monId: String(g.Moneda_Id), cae: String(g.Cae), caeVencimiento: fechaIso(String(g.Fch_venc_Cae)),
  };
}

export function leerFexDummy(xml: string): { ok: boolean; detalle: string } {
  const r = resultado(xml, 'FEXDummy');
  return { ok: r.AppServer === 'OK' && r.DbServer === 'OK' && r.AuthServer === 'OK', detalle: `AppServer ${r.AppServer}, DbServer ${r.DbServer}, AuthServer ${r.AuthServer}` };
}

