import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { RENGLONES_FIJOS } from './lsd-conceptos';
import { DatosConceptoLsd, linea, REG_CONCEPTO } from './lsd-diseno';

const archivo = (lineas: string[]) => Buffer.from(lineas.map((l) => `${l}\r\n`).join(''), 'latin1');

/** Archivos de importación del Libro de Sueldos Digital (spec E30). */
@Injectable()
export class LsdService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Asociación de conceptos (Anexo II): todos los conceptos, activos o no, y los renglones fijos del cálculo. */
  async conceptos() {
    const cs = await this.tenant.db.concepto.findMany({ orderBy: { codigo: 'asc' } });
    const datos: DatosConceptoLsd[] = [
      ...cs.map((c) => ({ codigoArca: c.codigoArca, codigo: c.codigo, descripcion: c.nombre, clase: c.clase })),
      ...RENGLONES_FIJOS.map((r) => ({ codigoArca: r.codigoArca, codigo: r.codigo, descripcion: r.nombre, clase: r.clase })),
    ];
    return { nombre: 'LSD-conceptos.txt', contenido: archivo(datos.map((d) => linea(REG_CONCEPTO, d))) };
  }
}
