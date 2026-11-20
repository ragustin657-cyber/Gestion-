import { BadRequestException, Injectable } from '@nestjs/common';
import type { ConfigImpuestos, PeriodicidadArba } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

export interface DatosConfigImpuestos {
  arbaActividad: string; arbaSucursal: number; arbaPeriodicidad: PeriodicidadArba; agipCodigoNorma: string;
  ivaInicioAnio?: number | null; ivaInicioMes?: number | null; ivaSaldoTecnicoInicial?: number; ivaSaldoLibreInicial?: number;
  iibbInicioAnio?: number | null; iibbInicioMes?: number | null;
}

@Injectable()
export class ConfigImpuestosService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}

  /** La configuración de la empresa; se crea con los valores por defecto si no existe. */
  async obtener(tx: TxEmpresa = this.tenant.db): Promise<ConfigImpuestos> {
    return (await tx.configImpuestos.findFirst()) ?? tx.configImpuestos.create({ data: { empresaId: this.tenant.empresaId } });
  }

  async guardar(d: DatosConfigImpuestos) {
    const c = await this.obtener();
    // E37: el inicio de la posición de IVA y sus saldos no cambian con meses cerrados
    const cambiaInicio = (['ivaInicioAnio', 'ivaInicioMes'] as const).some((k) => d[k] !== undefined && d[k] !== c[k])
      || (['ivaSaldoTecnicoInicial', 'ivaSaldoLibreInicial'] as const).some((k) => d[k] !== undefined && !c[k].equals(d[k]!));
    if (cambiaInicio && (await this.tenant.db.posicionIva.count())) throw new BadRequestException('Hay posiciones de IVA cerradas: reábralas para cambiar el inicio');
    // E38: el inicio de la liquidación de IIBB tampoco cambia con meses cerrados
    const cambiaIibb = (['iibbInicioAnio', 'iibbInicioMes'] as const).some((k) => d[k] !== undefined && d[k] !== c[k]);
    if (cambiaIibb && (await this.tenant.db.posicionIibb.count())) throw new BadRequestException('Hay liquidaciones de IIBB cerradas: reábralas para cambiar el inicio');
    const r = await this.tenant.db.configImpuestos.update({ where: { id: c.id }, data: d });
    await this.auditoria.registrar(this.tenant.db, { entidad: 'ConfigImpuestos', entidadId: c.id, accion: 'MODIFICAR', datos: d });
    return r;
  }
}
