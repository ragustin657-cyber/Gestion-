import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TablaGanancias, TramoGanancias } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { DatosTablaGanancias } from './dto';

export type TablaConTramos = TablaGanancias & { tramos: TramoGanancias[] };
const f2 = (x: Prisma.Decimal | null) => (x === null ? null : x.toFixed(2));
export const semestreDe = (mes: number) => (mes <= 6 ? 1 : 2);

/** Tablas de Ganancias de cuarta que publica ARCA por semestre (spec E31 §3). */
@Injectable()
export class TablasGananciasService {
  constructor(private readonly tenant: TenantPrisma) {}

  private validar(anio: number, semestre: number) {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || (semestre !== 1 && semestre !== 2)) throw new BadRequestException('Año o semestre inválido');
  }

  /** Tabla del semestre del mes (para calcular la retención), o null. */
  tabla(tx: TxEmpresa, anio: number, mes: number): Promise<TablaConTramos | null> {
    return tx.tablaGanancias.findUnique({ where: { empresaId_anio_semestre: { empresaId: this.tenant.empresaId, anio, semestre: semestreDe(mes) } }, include: { tramos: { orderBy: { desde: 'asc' } } } });
  }

  async ver(anio: number, semestre: number) {
    this.validar(anio, semestre);
    const t = await this.tenant.db.tablaGanancias.findUnique({ where: { empresaId_anio_semestre: { empresaId: this.tenant.empresaId, anio, semestre } }, include: { tramos: { orderBy: { desde: 'asc' } } } });
    if (!t) return null;
    return {
      anio, semestre, gni: f2(t.gni), deduccionEspecial: f2(t.deduccionEspecial), conyuge: f2(t.conyuge), hijo: f2(t.hijo), hijoIncapacitado: f2(t.hijoIncapacitado),
      topes: { hipotecario: f2(t.topeHipotecario), seguroMuerte: f2(t.topeSeguroMuerte), seguroMixto: f2(t.topeSeguroMixto), seguroRetiro: f2(t.topeSeguroRetiro), sepelio: f2(t.topeSepelio) },
      tramos: t.tramos.map((x) => ({ desde: f2(x.desde), hasta: f2(x.hasta), fijo: f2(x.fijo), porcentaje: x.porcentaje.toFixed(4) })),
    };
  }

  async guardar(anio: number, semestre: number, d: DatosTablaGanancias) {
    this.validar(anio, semestre);
    const empresaId = this.tenant.empresaId;
    const datos = {
      gni: d.gni, deduccionEspecial: d.deduccionEspecial, conyuge: d.conyuge, hijo: d.hijo, hijoIncapacitado: d.hijoIncapacitado,
      topeHipotecario: d.topes.hipotecario, topeSeguroMuerte: d.topes.seguroMuerte, topeSeguroMixto: d.topes.seguroMixto, topeSeguroRetiro: d.topes.seguroRetiro, topeSepelio: d.topes.sepelio,
    };
    await this.tenant.transaccion(async (tx) => {
      const t = await tx.tablaGanancias.upsert({ where: { empresaId_anio_semestre: { empresaId, anio, semestre } }, update: datos, create: { ...datos, empresaId, anio, semestre } });
      await tx.tramoGanancias.deleteMany({ where: { tablaId: t.id } });
      await tx.tramoGanancias.createMany({ data: d.tramos.map((x) => ({ empresaId, tablaId: t.id, desde: x.desde, hasta: x.hasta, fijo: x.fijo, porcentaje: x.porcentaje })) });
    });
    return this.ver(anio, semestre);
  }

  /** Copia la tabla del semestre anterior (del 1.er semestre, la del 2.º del año anterior) para editarla. */
  async copiarAnterior(anio: number, semestre: number) {
    this.validar(anio, semestre);
    const [a, s] = semestre === 2 ? [anio, 1] : [anio - 1, 2];
    const prev = await this.ver(a, s);
    if (!prev) throw new BadRequestException('No hay tabla del semestre anterior');
    const n = (x: string | null) => Number(x);
    return this.guardar(anio, semestre, {
      gni: n(prev.gni), deduccionEspecial: n(prev.deduccionEspecial), conyuge: n(prev.conyuge), hijo: n(prev.hijo), hijoIncapacitado: n(prev.hijoIncapacitado),
      topes: { hipotecario: n(prev.topes.hipotecario), seguroMuerte: n(prev.topes.seguroMuerte), seguroMixto: n(prev.topes.seguroMixto), seguroRetiro: n(prev.topes.seguroRetiro), sepelio: n(prev.topes.sepelio) },
      tramos: prev.tramos.map((x) => ({ desde: n(x.desde), hasta: x.hasta === null ? null : n(x.hasta), fijo: n(x.fijo), porcentaje: Number(x.porcentaje) })),
    });
  }
}
