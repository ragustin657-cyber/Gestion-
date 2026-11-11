import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as forge from 'node-forge';
import { certificadoDePrueba } from './certificado-prueba';
import { armarTra, firmarTra, leerLoginResponse } from './wsaa';

describe('WSAA', () => {
  const ahora = new Date('2026-11-08T12:00:00Z');
  it('TRA con el servicio y la ventana de ±10 minutos', () => {
    const tra = armarTra('wsfe', ahora);
    expect(tra).toContain('<service>wsfe</service>');
    expect(tra).toMatch(/<uniqueId>\d+<\/uniqueId>/);
    expect(tra).toContain('<generationTime>2026-11-08T11:50:00.000Z</generationTime>');
    expect(tra).toContain('<expirationTime>2026-11-08T12:10:00.000Z</expirationTime>');
  });
  it('firma CMS con el contenido adjunto y la firma verificable', () => {
    const { crt, key } = certificadoDePrueba('30712345671');
    const tra = armarTra('wsfe', ahora);
    const cms = firmarTra(tra, crt, key);
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as forge.pkcs7.PkcsSignedData & { rawCapture: { signature: string; authenticatedAttributes: forge.asn1.Asn1[] } };
    const oct = (p7.rawCapture as unknown as { content: forge.asn1.Asn1 }).content.value[0] as forge.asn1.Asn1;
    const bytes = typeof oct.value === 'string' ? oct.value : (oct.value as forge.asn1.Asn1[]).map((v) => v.value).join('');
    expect(forge.util.decodeUtf8(bytes)).toBe(tra);
    const cert = forge.pki.certificateFromPem(crt);
    const attrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, p7.rawCapture.authenticatedAttributes);
    const md = forge.md.sha256.create().update(forge.asn1.toDer(attrs).getBytes());
    expect((cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), p7.rawCapture.signature)).toBe(true);
  });
  it('un ticket vigente que no tenemos explica que se libera solo al vencer', () => {
    expect(() => leerLoginResponse(readFileSync(join(__dirname, 'fixtures/login-ya-autenticado.xml'), 'utf8')))
      .toThrow('ARCA indica que ya hay un acceso vigente para este certificado que el sistema no tiene guardado: se libera solo al vencer (hasta 12 horas). Mientras tanto no se pueden pedir CAE.');
  });
  it('lee token, sign y vencimiento', () => {
    const r = leerLoginResponse(readFileSync(join(__dirname, 'fixtures/login-cms.xml'), 'utf8'));
    expect(r).toEqual({ token: 'PD94bWwgdG9rZW4=', sign: 'c2lnbg==', vence: new Date('2026-11-09T00:00:00.000-03:00') });
  });
});
