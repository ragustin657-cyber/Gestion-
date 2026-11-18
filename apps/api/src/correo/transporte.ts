import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

export interface MailSaliente { de: string; para: string; asunto: string; texto: string; adjuntos: { nombre: string; contenido: Buffer }[] }
export interface ServidorCorreo { servidor: string; puerto: number; seguro: boolean; usuario: string; clave: string }

/** Envío de mails (spec E28 §6): SMTP en producción, en memoria en pruebas (TRANSPORTE_CORREO=prueba). */
export abstract class TransporteCorreo {
  abstract enviar(servidor: ServidorCorreo, mail: MailSaliente): Promise<void>;
}

@Injectable()
export class TransporteSmtp extends TransporteCorreo {
  async enviar(s: ServidorCorreo, m: MailSaliente) {
    const t = createTransport({ host: s.servidor, port: s.puerto, secure: s.seguro, auth: { user: s.usuario, pass: s.clave }, connectionTimeout: 15000 });
    await t.sendMail({ from: m.de, to: m.para, subject: m.asunto, text: m.texto, attachments: m.adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido })) });
  }
}

/** Guarda los mails en vez de mandarlos; `fallarPara` simula un rechazo del servidor. */
@Injectable()
export class TransporteMemoria extends TransporteCorreo {
  readonly enviados: MailSaliente[] = [];
  readonly fallarPara = new Set<string>();
  async enviar(_s: ServidorCorreo, m: MailSaliente) {
    if (this.fallarPara.has(m.para)) throw new Error('550 Destinatario rechazado');
    this.enviados.push(m);
  }
}
