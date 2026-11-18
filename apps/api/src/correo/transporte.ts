import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createTransport } from 'nodemailer';

export interface MailSaliente { de: { nombre: string; email: string } | string; para: string; asunto: string; texto: string; adjuntos: { nombre: string; contenido: Buffer }[] }
export interface ServidorCorreo { servidor: string; puerto: number; seguro: boolean; usuario: string; clave: string }

/** Puertos de correo permitidos (no se deja apuntar a otros servicios del servidor). */
export const PUERTOS_CORREO = [25, 465, 587, 2525];
export const SERVIDOR_NO_PERMITIDO = 'Servidor de correo no permitido: use un servidor público';
export const SIN_CONEXION = 'No se pudo conectar con el servidor de correo';

/** Direcciones de la red interna, loopback, link-local (incluye metadatos de la nube) y reservadas. */
export function esDireccionInterna(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? esDireccionInterna(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Rechaza servidores de la red interna: literal, 'localhost' o un nombre que resuelve a una dirección interna. */
export async function validarServidorPublico(servidor: string): Promise<string | null> {
  const s = servidor.trim().toLowerCase();
  if (s === 'localhost' || s.endsWith('.localhost')) throw new BadRequestException(SERVIDOR_NO_PERMITIDO);
  if (isIP(s)) {
    if (esDireccionInterna(s)) throw new BadRequestException(SERVIDOR_NO_PERMITIDO);
    return s;
  }
  try {
    const dirs = await lookup(s, { all: true });
    if (dirs.some((d) => esDireccionInterna(d.address))) throw new BadRequestException(SERVIDOR_NO_PERMITIDO);
    return dirs[0]?.address ?? null;
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    return null; // no resuelve: se podrá guardar, pero el envío fallará
  }
}

/** Un error de red (no una respuesta del servidor SMTP): no se muestra su texto para no exponer la red. */
export function esErrorDeConexion(e: unknown) {
  const code = (e as { code?: string })?.code ?? '';
  return ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'EAUTH_CONEXION'].includes(code);
}

/** Envío de mails (spec E28 §6): SMTP en producción, en memoria en pruebas (TRANSPORTE_CORREO=prueba). */
export abstract class TransporteCorreo {
  abstract enviar(servidor: ServidorCorreo, mail: MailSaliente): Promise<void>;
}

@Injectable()
export class TransporteSmtp extends TransporteCorreo {
  async enviar(s: ServidorCorreo, m: MailSaliente) {
    // Se resuelve y valida al conectar (el nombre pudo cambiar de dirección después de guardarlo)
    const ip = await validarServidorPublico(s.servidor);
    const t = createTransport({
      host: ip ?? s.servidor, port: s.puerto, secure: s.seguro, auth: { user: s.usuario, pass: s.clave },
      tls: { servername: s.servidor }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    });
    try {
      const from = typeof m.de === 'string' ? m.de : { name: m.de.nombre, address: m.de.email };
      await t.sendMail({ from, to: m.para, subject: m.asunto, text: m.texto, attachments: m.adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido })) });
    } finally {
      t.close();
    }
  }
}

/** Guarda los mails en vez de mandarlos; `fallarPara` simula un rechazo del servidor y `fallaConexion` una caída. */
@Injectable()
export class TransporteMemoria extends TransporteCorreo {
  readonly enviados: MailSaliente[] = [];
  readonly fallarPara = new Set<string>();
  fallaConexion = false;
  intentos = 0;
  async enviar(_s: ServidorCorreo, m: MailSaliente) {
    this.intentos++;
    if (this.fallaConexion) throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:587'), { code: 'ECONNECTION' });
    if (this.fallarPara.has(m.para)) throw new Error('550 Destinatario rechazado');
    this.enviados.push(m);
  }
}

/** El transporte se elige al crear el proveedor (no al importar el módulo): el .env se carga en bootstrap. */
export function crearTransporte(): TransporteCorreo {
  return process.env.TRANSPORTE_CORREO === 'prueba' ? new TransporteMemoria() : new TransporteSmtp();
}
