import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ConfigCorreo, Empresa } from '@prisma/client';
import { ConfigCorreoService, ErrorConexionCorreo } from '../../correo/config-correo.service';
import { SIN_CONEXION } from '../../correo/transporte';
import { reemplazar } from '../../correo/plantilla';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { importeAR } from '../pdf/pdf-venta';
import { AgendaCobranzasService } from './agenda.service';

const MAX_MASIVO = 50;
const pesos = (s: string) => `$ ${importeAR(s)}`;

/** Envío del resumen de cuenta por mail, individual y masivo (spec E28 §5). */
@Injectable()
export class MailCobranzasService {
  private readonly log = new Logger(MailCobranzasService.name);
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly agenda: AgendaCobranzasService,
    private readonly correo: ConfigCorreoService,
    private readonly cls: ClsService,
  ) {}

  private empresa() {
    return this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
  }

  private valores(f: { cliente: { razonSocial: string }; vencido: string; porVencer: string; dias: number }, empresa: { razonSocial: string }) {
    return { cliente: f.cliente.razonSocial, vencido: pesos(f.vencido), porVencer: pesos(f.porVencer), diasAtraso: String(f.dias), empresa: empresa.razonSocial };
  }

  async previsualizar(terceroId: string) {
    const cfg = await this.correo.requerida();
    const f = await this.agenda.ficha(terceroId);
    const v = this.valores(f, await this.empresa());
    return { destinatario: f.cliente.email || null, asunto: reemplazar(cfg.asunto, v), cuerpo: reemplazar(cfg.cuerpo, v) };
  }

  /** Arma y manda el mail con el PDF; si sale, lo registra como gestión MAIL. */
  private async enviarA(
    cfg: ConfigCorreo & { clave: string }, terceroId: string, d: { asunto?: string | null; cuerpo?: string | null; destinatario?: string | null },
    ya: { ficha?: Awaited<ReturnType<AgendaCobranzasService['ficha']>>; empresa: Empresa },
  ) {
    const { nombre, contenido, ficha } = await this.agenda.resumenPdf(terceroId, ya);
    const para = d.destinatario?.trim() || ficha.cliente.email?.trim();
    if (!para) throw new BadRequestException('El cliente no tiene email');
    const v = this.valores(ficha, ya.empresa);
    // Las variables se reemplazan siempre, también en un texto retocado
    await this.correo.enviar(cfg, { para, asunto: reemplazar(d.asunto || cfg.asunto, v), texto: reemplazar(d.cuerpo || cfg.cuerpo, v), adjuntos: [{ nombre, contenido }] });
    // El mail ya salió: si el registro falla, se informa como enviado con un aviso (no se reintenta y duplica)
    let aviso: string | undefined;
    try {
      await this.tenant.db.gestionCobranza.create({
        data: { empresaId: this.tenant.empresaId, terceroId, fecha: hoy(), medio: 'MAIL', nota: `Resumen de cuenta enviado a ${para}`, creadoEn: new Date(), creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId },
      });
    } catch (e) {
      this.log.error(`Mail enviado a ${para} sin gestión registrada: ${e instanceof Error ? e.message : String(e)}`);
      aviso = 'El mail se envió, pero no se pudo registrar la gestión';
    }
    return { destinatario: para, cliente: ficha.cliente.razonSocial, ...(aviso ? { aviso } : {}) };
  }

  async enviar(terceroId: string, d: { asunto?: string | null; cuerpo?: string | null; destinatario?: string | null }) {
    const cfg = await this.correo.requerida();
    const r = await this.enviarA(cfg, terceroId, d, { empresa: await this.empresa() });
    return { destinatario: r.destinatario, ...(r.aviso ? { aviso: r.aviso } : {}) };
  }

  async masivo(terceroIds: string[]) {
    const ids = [...new Set(terceroIds)];
    if (ids.length > MAX_MASIVO) throw new BadRequestException(`Se envían hasta ${MAX_MASIVO} clientes por vez`);
    const cfg = await this.correo.requerida();
    const empresa = await this.empresa();
    const enviados: { terceroId: string; cliente: string; destinatario: string; aviso?: string }[] = [];
    const omitidos: { terceroId: string; cliente: string; motivo: string }[] = [];
    let sinConexion = false;
    for (const terceroId of ids) {
      let cliente = '';
      // Con el servidor caído, el resto fallaría igual: no se sigue intentando
      if (sinConexion) { omitidos.push({ terceroId, cliente, motivo: SIN_CONEXION }); continue; }
      try {
        const f = await this.agenda.ficha(terceroId);
        cliente = f.cliente.razonSocial;
        if (!f.cliente.email?.trim()) { omitidos.push({ terceroId, cliente, motivo: 'Sin email' }); continue; }
        if (Number(f.vencido) <= 0 && Number(f.porVencer) <= 0) { omitidos.push({ terceroId, cliente, motivo: 'Sin saldo pendiente' }); continue; }
        const r = await this.enviarA(cfg, terceroId, {}, { ficha: f, empresa });
        enviados.push({ terceroId, cliente: r.cliente, destinatario: r.destinatario, ...(r.aviso ? { aviso: r.aviso } : {}) });
      } catch (e) {
        // Un cliente con problemas no corta el envío de los demás (salvo una caída del servidor de correo)
        if (e instanceof ErrorConexionCorreo) sinConexion = true;
        const motivo = e instanceof NotFoundException ? 'Cliente inexistente' : e instanceof HttpException ? e.message : 'Error interno al preparar el mail';
        if (!(e instanceof HttpException)) this.log.error(`Envío masivo, cliente ${terceroId}: ${e instanceof Error ? e.message : String(e)}`);
        omitidos.push({ terceroId, cliente, motivo });
      }
    }
    return { enviados, omitidos };
  }
}
