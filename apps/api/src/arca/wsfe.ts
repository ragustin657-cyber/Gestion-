import { ComprobanteArca, DatosCae, ErrorConexionArca, ErrorServicioArca, ResultadoCae } from './cliente-arca';
import { leerXml, lista } from './xml';

export const NS_WSFE = 'http://ar.gov.afip.dif.FEV1/';
export interface AuthWsfe { token: string; sign: string; cuit: string }

const sobre = (op: string, cuerpo: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS_WSFE}"><soapenv:Header/><soapenv:Body><ar:${op}>${cuerpo}</ar:${op}></soapenv:Body></soapenv:Envelope>`;
const auth = (a: AuthWsfe) => `<ar:Auth><ar:Token>${a.token}</ar:Token><ar:Sign>${a.sign}</ar:Sign><ar:Cuit>${a.cuit}</ar:Cuit></ar:Auth>`;
const t = (tag: string, v: string | number) => `<ar:${tag}>${v}</ar:${tag}>`;

export const xmlDummy = () => sobre('FEDummy', '');
export const xmlUltimoAutorizado = (a: AuthWsfe, ptoVta: number, cbteTipo: number) => sobre('FECompUltimoAutorizado', auth(a) + t('PtoVta', ptoVta) + t('CbteTipo', cbteTipo));
export const xmlConsultar = (a: AuthWsfe, ptoVta: number, cbteTipo: number, numero: number) =>
  sobre('FECompConsultar', auth(a) + `<ar:FeCompConsReq>${t('CbteTipo', cbteTipo)}${t('CbteNro', numero)}${t('PtoVta', ptoVta)}</ar:FeCompConsReq>`);

export function xmlSolicitarCae(a: AuthWsfe, d: DatosCae): string {
  const servicio = d.concepto !== 1 ? t('FchServDesde', d.fchServDesde!) + t('FchServHasta', d.fchServHasta!) + t('FchVtoPago', d.fchVtoPago!) : '';
  const asoc = d.asociados.length
    ? `<ar:CbtesAsoc>${d.asociados.map((x) => `<ar:CbteAsoc>${t('Tipo', x.tipo)}${t('PtoVta', x.ptoVta)}${t('Nro', x.nro)}${t('Cuit', x.cuit)}${t('CbteFch', x.fecha)}</ar:CbteAsoc>`).join('')}</ar:CbtesAsoc>`
    : '';
  const iva = d.iva.length ? `<ar:Iva>${d.iva.map((x) => `<ar:AlicIva>${t('Id', x.id)}${t('BaseImp', x.baseImp)}${t('Importe', x.importe)}</ar:AlicIva>`).join('')}</ar:Iva>` : '';
  const det =
    t('Concepto', d.concepto) + t('DocTipo', d.docTipo) + t('DocNro', d.docNro) + t('CbteDesde', d.numero) + t('CbteHasta', d.numero) + t('CbteFch', d.fecha) +
    t('ImpTotal', d.impTotal) + t('ImpTotConc', d.impTotConc) + t('ImpNeto', d.impNeto) + t('ImpOpEx', d.impOpEx) + t('ImpTrib', '0.00') + t('ImpIVA', d.impIva) +
    servicio + t('MonId', d.monId) + t('MonCotiz', d.monCotiz) + t('CanMisMonExt', 'N') + t('CondicionIVAReceptorId', d.condicionIvaReceptor) + asoc + iva;
  return sobre('FECAESolicitar', auth(a) + `<ar:FeCAEReq><ar:FeCabReq>${t('CantReg', 1)}${t('PtoVta', d.ptoVta)}${t('CbteTipo', d.cbteTipo)}</ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>${det}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`);
}

const fechaIso = (f: string) => (f && f.length === 8 ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : '');
const textos = (items: unknown) => lista(items as Record<string, string>[]).map((e) => `(${e.Code}) ${e.Msg}`);
/** Códigos de error de autenticación del WSFE: el token se descarta y se reintenta el login. */
const ERRORES_TOKEN = new Set(['600', '601']);
/** Errores internos de ARCA: no se sabe si procesó el pedido, así que se reintenta con recuperación. */
const ERRORES_INTERNOS = new Set(['500', '501', '502']);

/** El resultado de la operación; si el XML no es una respuesta SOAP del WSFE, es un error de conexión. */
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

function errorDeServicio(r: Record<string, any>): ErrorConexionArca | null {
  const errs = lista(r.Errors?.Err as Record<string, string>[]);
  if (!errs.length) return null;
  return new ErrorConexionArca(`ARCA respondió con error: ${textos(errs).join('; ')}`, { tokenInvalido: errs.some((e) => ERRORES_TOKEN.has(String(e.Code))) });
}

export function leerSolicitarCae(xml: string): ResultadoCae {
  const r = resultado(xml, 'FECAESolicitar');
  const det = lista(r.FeDetResp?.FECAEDetResponse as Record<string, any>[])[0];
  if (!det) {
    const e = errorDeServicio(r);
    if (e?.tokenInvalido || !e) throw e ?? new ErrorConexionArca('No se pudo conectar con ARCA: respuesta sin detalle');
    if (lista(r.Errors?.Err as Record<string, string>[]).some((x) => ERRORES_INTERNOS.has(String(x.Code)))) throw e;
    return { resultado: 'R', errores: textos(r.Errors?.Err) };
  }
  const obs = textos(det.Observaciones?.Obs);
  if (det.Resultado === 'A' && det.CAE) return { resultado: 'A', cae: String(det.CAE), caeVencimiento: fechaIso(String(det.CAEFchVto)), observaciones: obs };
  return { resultado: 'R', errores: [...textos(r.Errors?.Err), ...obs] };
}

/** Los errores de token o internos de ARCA son de conexión (se reintenta); los demás, de configuración. */
function errorDeConsulta(r: Record<string, any>): Error | null {
  const e = errorDeServicio(r);
  if (!e) return null;
  const errs = lista(r.Errors?.Err as Record<string, string>[]);
  if (e.tokenInvalido || errs.some((x) => ERRORES_INTERNOS.has(String(x.Code)))) return e;
  return new ErrorServicioArca(`ARCA rechazó la consulta: ${textos(errs).join('; ')}`);
}

export function leerUltimoAutorizado(xml: string): number {
  const r = resultado(xml, 'FECompUltimoAutorizado');
  const e = errorDeConsulta(r);
  if (e) throw e;
  return Number(r.CbteNro ?? 0);
}

export function leerConsultar(xml: string): ComprobanteArca | null {
  const r = resultado(xml, 'FECompConsultar');
  const g = r.ResultGet;
  if (!g) {
    if (lista(r.Errors?.Err as Record<string, string>[]).some((x) => String(x.Code) === '602')) return null;
    const e = errorDeConsulta(r);
    if (e) throw e;
    return null;
  }
  return {
    numero: Number(g.CbteDesde), docNro: String(g.DocNro), fecha: fechaIso(String(g.CbteFch)), impTotal: Number(g.ImpTotal).toFixed(2),
    monId: String(g.MonId), cae: String(g.CodAutorizacion), caeVencimiento: fechaIso(String(g.FchVto)),
  };
}

export function leerDummy(xml: string): { ok: boolean; detalle: string } {
  const r = resultado(xml, 'FEDummy');
  const detalle = `AppServer ${r.AppServer}, DbServer ${r.DbServer}, AuthServer ${r.AuthServer}`;
  return { ok: r.AppServer === 'OK' && r.DbServer === 'OK' && r.AuthServer === 'OK', detalle };
}
