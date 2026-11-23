import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Tercero } from '@prisma/client';
import { ConfigArcaService } from '../../arca/config-arca.service';
import { ErrorConexionArca } from '../../arca/cliente-arca';
import { fechaAR } from '../../compras/comun';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { importeAR } from '../pdf/pdf-venta';

export interface Obligacion { obligado: boolean; montoMinimo: string | null; aviso: string | null; consultadoEn: string | null }
export interface ObligacionConTotal extends Obligacion { corresponde: boolean }

/** Pueden recibir FCE los clientes con CUIT responsables inscriptos o exentos (a verificar). */
const puedeRecibir = (t: Tercero) => t.tipoDocumento === 'CUIT' && (t.condicionIva === 'RESPONSABLE_INSCRIPTO' || t.condicionIva === 'EXENTO');
const NO = (aviso: string | null = null): Obligacion => ({ obligado: false, montoMinimo: null, aviso, consultadoEn: null });

/** ¿El cliente está obligado a recibir factura de crédito MiPyME? (spec E50 §4.3) */
@Injectable()
export class ObligacionFceService {
  constructor(private readonly tenant: TenantPrisma, private readonly arca: ConfigArcaService) {}

  /** Consulta a ARCA una vez por cliente, día y ambiente; sin respuesta, la última consulta del ambiente o la marca manual. */
  async obligacion(terceroId: string, fecha: string): Promise<Obligacion> {
    const db = this.tenant.db;
    const conf = await db.configArca.findFirst();
    if (!conf?.mipyme) return NO();
    const t = await db.tercero.findUnique({ where: { id: terceroId } });
    if (!t) throw new NotFoundException('Cliente inexistente');
    if (!puedeRecibir(t)) return NO();
    const ambiente = conf.ambiente;
    const guardada = (aviso: string | null): Obligacion => ({
      obligado: !!t.fceObligado, montoMinimo: t.fceMontoMinimo?.toFixed(2) ?? null, aviso, consultadoEn: t.fceConsultadoEn?.toISOString() ?? null,
    });
    const delAmbiente = t.fceConsultadoEn && t.fceConsultadoAmbiente === ambiente;
    if (delAmbiente && hoyEn(ZONA_ARGENTINA, t.fceConsultadoEn!) === hoyEn(ZONA_ARGENTINA)) return guardada(null);
    try {
      let r = await (await this.arca.clienteFce()).consultarObligacion(t.cuit, fecha.replace(/-/g, ''));
      // En el ambiente SIMULADO nadie está en el registro: la marca manual del cliente hace de obligación (para probar la FCE)
      if (ambiente === 'SIMULADO' && !r.obligado && t.fceObligadoManual) r = { obligado: true, montoMinimo: null };
      const ahora = new Date();
      await db.tercero.update({
        where: { id: t.id },
        data: { fceObligado: r.obligado, fceMontoMinimo: r.montoMinimo, fceConsultadoEn: ahora, fceConsultadoAmbiente: ambiente },
      });
      return { obligado: r.obligado, montoMinimo: r.montoMinimo ? new Prisma.Decimal(r.montoMinimo).toFixed(2) : null, aviso: null, consultadoEn: ahora.toISOString() };
    } catch (e) {
      if (!(e instanceof ErrorConexionArca)) throw e;
      if (delAmbiente) return guardada(`No se pudo consultar ARCA: se usa la consulta del ${fechaAR(new Date(`${hoyEn(ZONA_ARGENTINA, t.fceConsultadoEn!)}T00:00:00Z`))}`);
      return { obligado: t.fceObligadoManual, montoMinimo: null, aviso: 'No se pudo consultar ARCA: se usa la marca manual del cliente', consultadoEn: null };
    }
  }

  /** Corresponde FCE si está obligado y el total en pesos llega al mínimo (sin mínimo conocido, por la marca manual: siempre). */
  static corresponde(o: Obligacion, totalPesos: Prisma.Decimal | string | number): boolean {
    return o.obligado && (o.montoMinimo === null || new Prisma.Decimal(totalPesos).gte(o.montoMinimo));
  }

  /** Error de emisión según la clase elegida (E50 §4.3), o null. */
  static errorEmision(o: Obligacion, fce: boolean, totalPesos: Prisma.Decimal): string | null {
    if (fce && !o.obligado) return 'El cliente no está obligado a recibir factura de crédito MiPyME';
    if (!fce && ObligacionFceService.corresponde(o, totalPesos))
      return `El cliente está obligado a recibir factura de crédito MiPyME desde $ ${importeAR(o.montoMinimo ?? '0')}: emita una factura de crédito`;
    return null;
  }

  async consultar(terceroId: string, fecha: string, total?: string): Promise<ObligacionConTotal> {
    const o = await this.obligacion(terceroId, fecha);
    return { ...o, corresponde: total !== undefined && total !== '' && ObligacionFceService.corresponde(o, total) };
  }
}
