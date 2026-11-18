import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigCorreo } from '@prisma/client';
import { cifrar, descifrar } from '../arca/cifrado';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { DatosConfigCorreo } from './dto';
import { ASUNTO_POR_DEFECTO, CUERPO_POR_DEFECTO } from './plantilla';
import { TransporteCorreo } from './transporte';

const SIN_CLAVE_MAESTRA = 'El servidor no tiene configurada la clave de cifrado (ARCA_CLAVE_MAESTRA): no se puede guardar la clave del correo';

/** Correo saliente de la empresa (spec E28 §3): la clave se guarda cifrada y nunca se devuelve. */
@Injectable()
export class ConfigCorreoService {
  constructor(private readonly tenant: TenantPrisma, private readonly transporte: TransporteCorreo) {}

  async ver() {
    const c = await this.tenant.db.configCorreo.findFirst();
    if (!c) return { servidor: null, puerto: 587, seguro: false, usuario: null, remitenteNombre: null, remitenteEmail: null, asunto: ASUNTO_POR_DEFECTO, cuerpo: CUERPO_POR_DEFECTO, claveCargada: false };
    const { claveCifrada, id: _i, empresaId: _e, ...resto } = c;
    return { ...resto, claveCargada: !!claveCifrada };
  }

  async guardar(d: DatosConfigCorreo) {
    const actual = await this.tenant.db.configCorreo.findFirst();
    let claveCifrada = actual?.claveCifrada;
    if (d.clave) {
      try {
        claveCifrada = cifrar(d.clave);
      } catch {
        throw new BadRequestException(SIN_CLAVE_MAESTRA);
      }
    }
    if (!claveCifrada) throw new BadRequestException('Indique la clave del correo');
    const { clave: _c, ...datos } = d;
    if (actual) await this.tenant.db.configCorreo.update({ where: { id: actual.id }, data: { ...datos, claveCifrada } });
    else await this.tenant.db.configCorreo.create({ data: { ...datos, claveCifrada, empresaId: this.tenant.empresaId } });
    return this.ver();
  }

  /** Configuración con la clave descifrada, para enviar; sin configuración, 400. */
  async requerida(tx: TxEmpresa = this.tenant.db): Promise<ConfigCorreo & { clave: string }> {
    const c = await tx.configCorreo.findFirst();
    if (!c) throw new BadRequestException('Configure el correo de la empresa');
    try {
      return { ...c, clave: descifrar(c.claveCifrada) };
    } catch {
      throw new BadRequestException('No se pudo leer la clave del correo: vuelva a cargarla');
    }
  }

  remitente(c: { remitenteNombre: string; remitenteEmail: string }) {
    return `"${c.remitenteNombre.replace(/"/g, '')}" <${c.remitenteEmail}>`;
  }

  /** Envía con la configuración de la empresa; un error del servidor de correo se devuelve como 400 con su mensaje. */
  async enviar(c: ConfigCorreo & { clave: string }, mail: { para: string; asunto: string; texto: string; adjuntos?: { nombre: string; contenido: Buffer }[] }) {
    try {
      await this.transporte.enviar({ servidor: c.servidor, puerto: c.puerto, seguro: c.seguro, usuario: c.usuario, clave: c.clave }, { de: this.remitente(c), adjuntos: [], ...mail });
    } catch (e) {
      throw new BadRequestException(`No se pudo enviar el mail: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async prueba(destinatario: string) {
    const c = await this.requerida();
    await this.enviar(c, { para: destinatario, asunto: 'Prueba de correo', texto: 'Este es un mail de prueba de la configuración de correo.' });
    return { ok: true };
  }
}
