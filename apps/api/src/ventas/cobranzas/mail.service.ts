import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ConfigCorreo } from '@prisma/client';
import { ConfigCorreoService } from '../../correo/config-correo.service';
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
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly agenda: AgendaCobranzasService,
    private readonly correo: ConfigCorreoService,
    private readonly cls: ClsService,
  ) {}

  private async valores(f: { cliente: { razonSocial: string }; vencido: string; porVencer: string; dias: number }) {
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return { cliente: f.cliente.razonSocial, vencido: pesos(f.vencido), porVencer: pesos(f.porVencer), diasAtraso: String(f.dias), empresa: empresa.razonSocial };
  }

  async previsualizar(terceroId: string) {
    const cfg = await this.correo.requerida();
    const f = await this.agenda.ficha(terceroId);
    const v = await this.valores(f);
    return { destinatario: f.cliente.email || null, asunto: reemplazar(cfg.asunto, v), cuerpo: reemplazar(cfg.cuerpo, v) };
  }

  /** Arma y manda el mail con el PDF; si sale, lo registra como gestión MAIL. */
  private async enviarA(cfg: ConfigCorreo & { clave: string }, terceroId: string, d: { asunto?: string | null; cuerpo?: string | null; destinatario?: string | null }) {
    const { nombre, contenido, ficha } = await this.agenda.resumenPdf(terceroId);
    const para = d.destinatario?.trim() || ficha.cliente.email?.trim();
    if (!para) throw new BadRequestException('El cliente no tiene email');
    const v = await this.valores(ficha);
    // Las variables se reemplazan siempre, también en un texto retocado
    await this.correo.enviar(cfg, { para, asunto: reemplazar(d.asunto || cfg.asunto, v), texto: reemplazar(d.cuerpo || cfg.cuerpo, v), adjuntos: [{ nombre, contenido }] });
    await this.tenant.db.gestionCobranza.create({
      data: { empresaId: this.tenant.empresaId, terceroId, fecha: hoy(), medio: 'MAIL', nota: `Resumen de cuenta enviado a ${para}`, creadoEn: new Date(), creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId },
    });
    return { destinatario: para, cliente: ficha.cliente.razonSocial };
  }

  async enviar(terceroId: string, d: { asunto?: string | null; cuerpo?: string | null; destinatario?: string | null }) {
    const cfg = await this.correo.requerida();
    const r = await this.enviarA(cfg, terceroId, d);
    return { destinatario: r.destinatario };
  }

  async masivo(terceroIds: string[]) {
    const ids = [...new Set(terceroIds)];
    if (ids.length > MAX_MASIVO) throw new BadRequestException(`Se envían hasta ${MAX_MASIVO} clientes por vez`);
    const cfg = await this.correo.requerida();
    const enviados: { terceroId: string; cliente: string; destinatario: string }[] = [];
    const omitidos: { terceroId: string; cliente: string; motivo: string }[] = [];
    for (const terceroId of ids) {
      let cliente = '';
      try {
        const f = await this.agenda.ficha(terceroId);
        cliente = f.cliente.razonSocial;
        if (!f.cliente.email?.trim()) { omitidos.push({ terceroId, cliente, motivo: 'Sin email' }); continue; }
        if (Number(f.vencido) <= 0 && Number(f.porVencer) <= 0) { omitidos.push({ terceroId, cliente, motivo: 'Sin saldo pendiente' }); continue; }
        const r = await this.enviarA(cfg, terceroId, {});
        enviados.push({ terceroId, cliente: r.cliente, destinatario: r.destinatario });
      } catch (e) {
        // Un cliente con problemas no corta el envío de los demás
        const motivo = e instanceof NotFoundException ? 'Cliente inexistente' : e instanceof Error ? e.message : String(e);
        omitidos.push({ terceroId, cliente, motivo });
      }
    }
    return { enviados, omitidos };
  }
}
