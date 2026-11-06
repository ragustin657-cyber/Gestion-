import { Controller, Get } from '@nestjs/common';
import { RequiereAlguno } from '../../auth/requiere-permiso.decorator';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';

/** Datos que necesitan las pantallas de ventas sin requerir que el usuario administre la empresa. */
@Controller('ventas/datos')
export class DatosVentasController {
  constructor(private readonly tenant: TenantPrisma) {}

  @Get() @RequiereAlguno('venta.emitir', 'cobro.registrar', 'venta.ver')
  async datos() {
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId }, select: { razonSocial: true, condicionIva: true } });
    const puntosVenta = await this.tenant.db.puntoVenta.findMany({ orderBy: { numero: 'asc' } });
    return { ...empresa, puntosVenta };
  }
}
