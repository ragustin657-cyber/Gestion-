import { validarSecretoJwt } from './secreto-jwt';

describe('validarSecretoJwt', () => {
  it('falla si falta', () => expect(() => validarSecretoJwt(undefined, 'development')).toThrow('JWT_SECRET'));
  it('en producción rechaza el valor de ejemplo', () =>
    expect(() => validarSecretoJwt('cambiar-este-secreto', 'production')).toThrow());
  it('en producción rechaza secretos cortos', () => expect(() => validarSecretoJwt('corto', 'production')).toThrow());
  it('en producción acepta uno largo', () =>
    expect(validarSecretoJwt('x'.repeat(40), 'production')).toBe('x'.repeat(40)));
  it('en desarrollo acepta cualquiera', () => expect(validarSecretoJwt('dev', 'development')).toBe('dev'));
});
