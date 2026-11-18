import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GestionCobranza } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { DatosGestion } from './dto';

const fecha = (s: string) => new Date(`${s}T00:00:00Z`);
/** Día (AAAA-MM-DD) de un instante en la hora argentina. */
export const diaArgentina = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Gestión para la API: fechas AAAA-MM-DD e importe con dos decimales. */
export const gestionSalida = (g: GestionCobranza) => ({
  ...g, fecha: iso(g.fecha)!, proximaAccion: iso(g.proximaAccion), promesaFecha: iso(g.promesaFecha), promesaImporte: g.promesaImporte?.toFixed(2) ?? null,
});

/** Gestiones de cobranza (spec E25 §5): no se modifican y solo se eliminan el mismo día. */
@Injectable()
export class GestionesService {
  constructor(private readonly tenant: TenantPrisma, private readonly cls: ClsService) {}

  /** Gestiones del cliente, de la más nueva a la más vieja. */
  deCliente(tx: TxEmpresa, terceroId: string) {
    return tx.gestionCobranza.findMany({ where: { terceroId }, orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }] });
  }

  async crear(terceroId: string, d: DatosGestion) {
    const t = await this.tenant.db.tercero.findUnique({ where: { id: terceroId } });
    if (!t) throw new NotFoundException('Cliente inexistente');
    if (!t.esCliente) throw new BadRequestException('El tercero no es cliente');
    if (!d.nota.trim()) throw new BadRequestException('Indique una nota');
    const f = d.fecha ? fecha(d.fecha) : hoy();
    if (f > hoy()) throw new BadRequestException('La fecha de la gestión no puede ser futura');
    const proxima = d.proximaAccion ? fecha(d.proximaAccion) : null;
    if (proxima && proxima < f) throw new BadRequestException('La próxima acción no puede ser anterior a la gestión');
    const conPromesa = !!d.promesaFecha || d.promesaImporte != null;
    if (conPromesa && (!d.promesaFecha || !d.promesaImporte || d.promesaImporte <= 0)) throw new BadRequestException('La promesa necesita fecha e importe mayor a cero');
    const promesa = d.promesaFecha ? fecha(d.promesaFecha) : null;
    if (promesa && promesa < f) throw new BadRequestException('La fecha de la promesa no puede ser anterior a la gestión');
    const g = await this.tenant.db.gestionCobranza.create({
      data: {
        empresaId: this.tenant.empresaId, terceroId, fecha: f, medio: d.medio, nota: d.nota.trim(), proximaAccion: proxima,
        promesaFecha: promesa, promesaImporte: conPromesa ? d.promesaImporte : null, creadoEn: new Date(), creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
      },
    });
    return gestionSalida(g);
  }

  async eliminar(id: string) {
    const g = await this.tenant.db.gestionCobranza.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Gestión inexistente');
    if (diaArgentina(g.creadoEn) !== iso(hoy())) throw new BadRequestException('Solo se eliminan gestiones del día');
    await this.tenant.db.gestionCobranza.delete({ where: { id } });
    return { ok: true };
  }
}
