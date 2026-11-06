import { leerCertificado, verificarPar } from './certificado';
import { certificadoDePrueba } from './certificado-prueba';

describe('certificado ARCA', () => {
  const a = certificadoDePrueba('30712345671');
  it('lee el CUIT, el sujeto y el vencimiento', () => {
    const c = leerCertificado(a.crt);
    expect(c.cuit).toBe('30712345671');
    expect(c.sujeto).toContain('gestion-test');
    expect(c.vence.getTime()).toBeGreaterThan(Date.now() + 300 * 86400000);
  });
  it('verifica que certificado y clave formen un par', () => {
    expect(() => verificarPar(a.crt, a.key)).not.toThrow();
    expect(() => verificarPar(a.crt, certificadoDePrueba('30712345671').key)).toThrow('El certificado no corresponde a la clave privada');
  });
  it('un texto que no es certificado', () => {
    expect(() => leerCertificado('hola')).toThrow('El archivo no es un certificado válido');
  });
});
