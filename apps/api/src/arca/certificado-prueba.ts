import { generateKeyPairSync } from 'node:crypto';
import * as forge from 'node-forge';

/** Certificado autofirmado para pruebas, con el serialNumber "CUIT nnnnnnnnnnn" como los de ARCA. */
export function certificadoDePrueba(cuit: string, venceEnDias = 365): { crt: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + venceEnDias * 86400000);
  const attrs = [{ name: 'commonName', value: 'gestion-test' }, { name: 'organizationName', value: 'Empresa de prueba' }, { type: '2.5.4.5', value: `CUIT ${cuit}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const clave = forge.pki.privateKeyFromPem(privateKey);
  cert.sign(clave, forge.md.sha256.create());
  return { crt: forge.pki.certificateToPem(cert), key: privateKey };
}
