import * as forge from 'node-forge';
import { ErrorConexionArca } from './cliente-arca';
import { escaparXml, leerXml } from './xml';

/** Ticket de requerimiento de acceso: válido de 10 minutos antes a 10 minutos después de `ahora`. */
export function armarTra(servicio: string, ahora: Date): string {
  const desde = new Date(ahora.getTime() - 10 * 60000).toISOString();
  const hasta = new Date(ahora.getTime() + 10 * 60000).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId><generationTime>${desde}</generationTime><expirationTime>${hasta}</expirationTime></header><service>${servicio}</service></loginTicketRequest>`;
}

/** Firma CMS (PKCS#7 SignedData con el contenido adjunto, SHA-256), en base64, como lo pide LoginCms. */
export function firmarTra(tra: string, crt: string, key: string): string {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  const cert = forge.pki.certificateFromPem(crt);
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(key),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export const xmlLoginCms = (cms: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${escaparXml(cms)}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;

/** Token, sign y vencimiento de la respuesta de LoginCms. Un SOAP Fault es un error de acceso. */
export function leerLoginResponse(xml: string): { token: string; sign: string; vence: Date } {
  const body = leerXml(xml)?.Envelope?.Body;
  if (body?.Fault) throw new ErrorConexionArca(`ARCA rechazó el acceso: ${body.Fault.faultstring ?? 'error desconocido'}`);
  const ret = body?.loginCmsResponse?.loginCmsReturn;
  if (typeof ret !== 'string') throw new ErrorConexionArca('No se pudo conectar con ARCA: respuesta de acceso ilegible');
  const t = leerXml(ret)?.loginTicketResponse;
  const token = t?.credentials?.token, sign = t?.credentials?.sign, vence = t?.header?.expirationTime;
  if (!token || !sign || !vence) throw new ErrorConexionArca('No se pudo conectar con ARCA: respuesta de acceso incompleta');
  return { token, sign, vence: new Date(vence) };
}
