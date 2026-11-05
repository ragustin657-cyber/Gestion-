const EJEMPLO = 'cambiar-este-secreto';

/** Valida el secreto JWT. En producción exige al menos 32 caracteres y que no sea el valor de ejemplo. */
export function validarSecretoJwt(secreto: string | undefined, entorno = process.env.NODE_ENV): string {
  if (!secreto) throw new Error('Falta la variable de entorno JWT_SECRET');
  if (entorno === 'production' && (secreto === EJEMPLO || secreto.length < 32))
    throw new Error('JWT_SECRET inseguro: en producción debe tener al menos 32 caracteres y no ser el valor de ejemplo');
  return secreto;
}
