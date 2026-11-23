import { ClaveFce, EstadoFce, FceArca, ObligacionFce } from './cliente-fce';
import { ErrorConexionArca, ErrorServicioArca } from './cliente-arca';
import { escaparXml, leerXml, lista } from './xml';

/** SOAP del registro de FCE (E50). Operaciones, campos y estados según el manual de `wsfecred`: a verificar en homologación. */
export const NS_WSFECRED = 'http://ar.gob.afip.wsfecred/FECredService/';
export interface AuthFce { token: string; sign: string; cuit: string }

const sobre = (op: string, cuerpo: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fec="${NS_WSFECRED}"><soapenv:Header/><soapenv:Body><fec:${op}>${cuerpo}</fec:${op}></soapenv:Body></soapenv:Envelope>`;
const auth = (a: AuthFce) => `<authRequest><token>${a.token}</token><sign>${a.sign}</sign><cuitRepresentada>${a.cuit}</cuitRepresentada></authRequest>`;
const t = (tag: string, v: string | number) => `<${tag}>${v}</${tag}>`;
const fecha = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const idCtaCte = (f: ClaveFce) => `<idCtaCte>${t('cuitEmisor', f.cuitEmisor)}${t('codTipoCmp', f.cbteTipo)}${t('ptoVta', f.ptoVta)}${t('nroCmp', f.numero)}</idCtaCte>`;
const ESTADOS: Record<string, EstadoFce> = {
  PendienteRecepcion: 'PENDIENTE', Recepcionado: 'PENDIENTE', Pendiente: 'PENDIENTE',
  Aceptado: 'ACEPTADA', Rechazado: 'RECHAZADA', AceptadoTacitamente: 'ACEPTADA_TACITA',
};

export const xmlObligacion = (a: AuthFce, cuit: string, f: string) =>
  sobre('consultarMontoObligadoRecepcion', auth(a) + t('cuitConsultada', cuit.replace(/\D/g, '')) + t('fechaEmision', fecha(f)));
export const xmlConsultarComprobantes = (a: AuthFce, rol: 'EMISOR' | 'RECEPTOR', desde: string, hasta: string) =>
  sobre('consultarComprobantes', auth(a) + t('rolCUITRepresentada', rol === 'EMISOR' ? 'Emisor' : 'Receptor') + `<fecha><tipo>Emision</tipo>${t('desde', fecha(desde))}${t('hasta', fecha(hasta))}</fecha>`);
export const xmlAceptar = (a: AuthFce, f: ClaveFce & { importe: string }) =>
  sobre('aceptarFECred', auth(a) + idCtaCte(f) + t('saldoAceptado', f.importe) + t('codMoneda', 'PES') + t('cotizacionMonedaUlt', '1'));
export const xmlRechazar = (a: AuthFce, f: ClaveFce, motivos: string[], texto: string) =>
  sobre('rechazarFECred', auth(a) + idCtaCte(f) + `<arrayMotivosRechazo>${motivos.map((m) => `<motivoRechazo>${t('codMotivo', m)}${t('justificacion', escaparXml(texto))}</motivoRechazo>`).join('')}</arrayMotivosRechazo>`);
export const xmlMotivos = (a: AuthFce) => sobre('consultarTiposMotivosRechazo', auth(a));

/** Cuerpo de la respuesta de la operación; errores del servicio como `ErrorServicioArca`. */
function respuesta(xml: string, op: string): Record<string, any> {
  let doc: Record<string, any>;
  try {
    doc = leerXml(xml);
  } catch {
    throw new ErrorConexionArca('No se pudo conectar con ARCA: respuesta ilegible');
  }
  const body = doc?.Envelope?.Body;
  if (body?.Fault) throw new ErrorConexionArca(`No se pudo conectar con ARCA: ${body.Fault.faultstring ?? 'error del servicio'}`, { tokenInvalido: /token|sign|ticket/i.test(String(body.Fault.faultstring ?? '')) });
  const r = body?.[`${op}Response`];
  if (r === undefined) throw new ErrorConexionArca('No se pudo conectar con ARCA: respuesta ilegible');
  const ret = (Object.values(r ?? {})[0] ?? {}) as Record<string, any>;
  const errs = lista(ret.arrayErrores?.codigoDescripcion as Record<string, string>[]);
  if (errs.length) throw new ErrorServicioArca(`ARCA rechazó la operación: ${errs.map((e) => `(${e.codigo}) ${e.descripcion}`).join('; ')}`);
  return ret;
}

export function leerObligacion(xml: string): ObligacionFce {
  const r = respuesta(xml, 'consultarMontoObligadoRecepcion');
  return { obligado: r.obligado === 'S', montoMinimo: r.montoDesde ? String(r.montoDesde) : null };
}

export function leerComprobantesFce(xml: string): FceArca[] {
  const r = respuesta(xml, 'consultarComprobantes');
  return lista(r.arrayComprobantes?.comprobante as Record<string, any>[]).map((c) => ({
    cuitEmisor: String(c.cuitEmisor), cuitReceptor: String(c.cuitReceptor), cbteTipo: Number(c.codTipoCmp), ptoVta: Number(c.ptoVta), numero: Number(c.nroCmp),
    fecha: String(c.fechaEmision), importe: String(c.importeTotal), moneda: String(c.codMoneda ?? 'PES'), fechaVencimientoPago: c.fechaVenPago ? String(c.fechaVenPago) : null,
    estado: ESTADOS[String(c.estado?.estado ?? c.estado)] ?? 'PENDIENTE', fechaRecepcion: c.fechaPuestaDispo ? String(c.fechaPuestaDispo) : null,
    fechaLimite: c.fechaVenAcep ? String(c.fechaVenAcep) : null,
    motivosRechazo: lista(c.arrayMotivosRechazo?.motivoRechazo as Record<string, string>[]).map((m) => String(m.descMotivo ?? m.codMotivo)),
  }));
}

export const leerSinDatos = (op: string) => (xml: string): void => { respuesta(xml, op); };

export function leerMotivos(xml: string): { codigo: string; descripcion: string }[] {
  const r = respuesta(xml, 'consultarTiposMotivosRechazo');
  return lista(r.arrayTiposMotivosRechazo?.codigoDescripcion as Record<string, string>[]).map((m) => ({ codigo: String(m.codigo), descripcion: String(m.descripcion) }));
}
