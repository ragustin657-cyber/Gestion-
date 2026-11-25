import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { PreciosService } from '../precios/precios.service';
import { armarLote } from './armado';
import type { FiltroVistaPrevia } from './dto';

/** E55: facturación por lotes de los remitos pendientes. */
@Injectable()
export class LotesFacturacionService {
  constructor(private readonly tenant: TenantPrisma, private readonly precios: PreciosService) {}

  vistaPrevia(q: FiltroVistaPrevia) {
    return armarLote(this.tenant.db, this.precios, q);
  }
}
