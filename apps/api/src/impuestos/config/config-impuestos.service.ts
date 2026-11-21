import { BadRequestException, Injectable } from '@nestjs/common';
import type { ConfigImpuestos, PeriodicidadArba } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

export interface DatosConfigImpuestos {
  arbaActividad: string; arbaSucursal: number; arbaPeriodicidad: PeriodicidadArba; agipCodigoNorma: string;
  ivaInicioAnio?: number | null; ivaInicioMes?: number | null; ivaSaldoTecnicoInicial?: number; ivaSaldoLibreInicial?: number;
  iibbInicioAnio?: number | null; iibbInicioMes?: number | null;
  prorrateoIva?: boolean; prorrateoDesdeAnio?: number | null; prorrateoDesdeMes?: number | null; prorrateoInicioMes?: number;
  prorrateoGravadasIniciales?: number; prorrateoExentasIniciales?: number;
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
    // E40: el prorrateo no cambia con posiciones cerradas desde su primer mes (el anterior o el nuevo, el menor)
    const cambiaProrrateo = (['prorrateoIva', 'prorrateoDesdeAnio', 'prorrateoDesdeMes', 'prorrateoInicioMes'] as const).some((k) => d[k] !== undefined && d[k] !== c[k])
      || (['prorrateoGravadasIniciales', 'prorrateoExentasIniciales'] as const).some((k) => d[k] !== undefined && !c[k].equals(d[k]!));
    const activo = d.prorrateoIva ?? c.prorrateoIva;
    const nuevoDesde = { anio: d.prorrateoDesdeAnio !== undefined ? d.prorrateoDesdeAnio : c.prorrateoDesdeAnio, mes: d.prorrateoDesdeMes !== undefined ? d.prorrateoDesdeMes : c.prorrateoDesdeMes };
    // Revisión E40: activo exige el primer mes, y no anterior al inicio de la posición de IVA
    if (activo && (!nuevoDesde.anio || !nuevoDesde.mes)) throw new BadRequestException('Indique el primer mes con prorrateo');
    const inicioIva = { anio: d.ivaInicioAnio !== undefined ? d.ivaInicioAnio : c.ivaInicioAnio, mes: d.ivaInicioMes !== undefined ? d.ivaInicioMes : c.ivaInicioMes };
    if (activo && inicioIva.anio && inicioIva.mes && nuevoDesde.anio! * 12 + nuevoDesde.mes! < inicioIva.anio * 12 + inicioIva.mes)
      throw new BadRequestException('El primer mes con prorrateo no puede ser anterior al inicio de la posición de IVA');
    // Desactivar no cambia los meses cerrados (guardan su prorrateo): no se bloquea. Activar mira solo el primer mes nuevo.
    if (cambiaProrrateo && activo) {
      const desdes = [...(c.prorrateoIva ? [[c.prorrateoDesdeAnio, c.prorrateoDesdeMes]] : []), [nuevoDesde.anio, nuevoDesde.mes]]
        .filter((x): x is [number, number] => !!x[0] && !!x[1]).sort((a, b) => a[0] * 12 + a[1] - (b[0] * 12 + b[1]));
      const desde = desdes[0];
      if (desde) {
        const cerradas = await this.tenant.db.posicionIva.count({ where: { OR: [{ anio: { gt: desde[0] } }, { anio: desde[0], mes: { gte: desde[1] } }] } });
        if (cerradas) throw new BadRequestException(`Hay posiciones de IVA cerradas desde ${String(desde[1]).padStart(2, '0')}/${desde[0]}: reábralas para cambiar el prorrateo`);
      }
    }
    const r = await this.tenant.db.configImpuestos.update({ where: { id: c.id }, data: d });
    await this.auditoria.registrar(this.tenant.db, { entidad: 'ConfigImpuestos', entidadId: c.id, accion: 'MODIFICAR', datos: d });
    return r;
  }
}
