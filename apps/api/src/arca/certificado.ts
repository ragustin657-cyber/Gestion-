import { createPrivateKey, X509Certificate } from 'node:crypto';

export interface DatosCertificado { sujeto: string; cuit: string | null; vence: Date }

/** Sujeto, CUIT (del serialNumber "CUIT nnnnnnnnnnn") y vencimiento de un certificado PEM. */
export function leerCertificado(pem: string): DatosCertificado {
  let x: X509Certificate;
  try {
    x = new X509Certificate(pem);
  } catch {
    throw new Error('El archivo no es un certificado válido');
  }
  const campos = x.subject.split('\n');
  const serial = campos.find((c) => c.startsWith('serialNumber='))?.slice('serialNumber='.length) ?? '';
  const cuit = /CUIT\s*(\d{11})/.exec(serial)?.[1] ?? null;
  const cn = campos.find((c) => c.startsWith('CN='))?.slice(3);
  const o = campos.find((c) => c.startsWith('O='))?.slice(2);
  return { sujeto: [cn, o].filter(Boolean).join(' - ') || x.subject, cuit, vence: new Date(x.validTo) };
}

/** Verifica que la clave privada corresponda al certificado. */
export function verificarPar(crt: string, key: string): void {
  let ok = false;
  try {
    ok = new X509Certificate(crt).checkPrivateKey(createPrivateKey(key));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('El certificado no corresponde a la clave privada');
}
