import { randomBytes } from 'node:crypto';
import { cifrar, descifrar } from './cifrado';

describe('cifrado de certificados', () => {
  const previa = process.env.ARCA_CLAVE_MAESTRA;
  afterEach(() => { process.env.ARCA_CLAVE_MAESTRA = previa; });

  it('ida y vuelta', () => {
    process.env.ARCA_CLAVE_MAESTRA = randomBytes(32).toString('base64');
    const c = cifrar('-----BEGIN PRIVATE KEY-----\nabc');
    expect(c).not.toContain('BEGIN');
    expect(descifrar(c)).toBe('-----BEGIN PRIVATE KEY-----\nabc');
  });
  it('sin clave maestra', () => {
    delete process.env.ARCA_CLAVE_MAESTRA;
    expect(() => cifrar('x')).toThrow('El servidor no tiene configurada la clave para guardar certificados');
  });
  it('un texto alterado no se descifra', () => {
    process.env.ARCA_CLAVE_MAESTRA = randomBytes(32).toString('base64');
    const partes = cifrar('secreto').split(':');
    partes[3] = Buffer.from('otro').toString('base64');
    expect(() => descifrar(partes.join(':'))).toThrow();
  });
});
