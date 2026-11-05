import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { conUnicidad } from '../comun/errores';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

const fechaAR = (f: Date) =>
  `${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}/${f.getUTCFullYear()}`;

@Injectable()
export class MonedasService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  monedas() {
    return this.tenant.db.moneda.findMany({ orderBy: { codigo: 'asc' } });
  }

  /** Cotización de la moneda a una fecha: la de ese día o la última anterior. ARS = 1. */
  async cotizacion(monedaCodigo: string, fecha: Date): Promise<Prisma.Decimal> {
    if (monedaCodigo === 'ARS') return new Prisma.Decimal(1);
    const c = await this.tenant.db.cotizacion.findFirst({
      where: { monedaCodigo, fecha: { lte: fecha } },
      orderBy: { fecha: 'desc' },
    });
    if (!c) throw new BadRequestException(`No hay cotización de ${monedaCodigo} para el ${fechaAR(fecha)}`);
    return c.valor;
  }

  listarCotizaciones(monedaCodigo?: string) {
    return this.tenant.db.cotizacion.findMany({
      where: { monedaCodigo: monedaCodigo || undefined },
      orderBy: { fecha: 'desc' },
      take: 200,
    });
  }

  crearCotizacion(d: { monedaCodigo: string; fecha: Date; valor: number }) {
    return conUnicidad('Ya hay una cotización cargada para esa moneda y fecha', () =>
      this.tenant.transaccion(async (tx) => {
        const c = await tx.cotizacion.create({ data: { ...d, empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'Cotizacion', entidadId: c.id, accion: 'CREAR', datos: d });
        return c;
      }),
    );
  }
}
