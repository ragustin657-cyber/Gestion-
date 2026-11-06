import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const SIN_CLAVE = 'El servidor no tiene configurada la clave para guardar certificados';

function clave(): Buffer {
  const k = process.env.ARCA_CLAVE_MAESTRA;
  const b = k ? Buffer.from(k, 'base64') : null;
  if (!b || b.length !== 32) throw new Error(SIN_CLAVE);
  return b;
}

/** AES-256-GCM con ARCA_CLAVE_MAESTRA (32 bytes en base64). Formato: v1:iv:tag:datos, en base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

export function descifrar(cifrado: string): string {
  const [v, iv, tag, datos] = cifrado.split(':');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const d = createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}
