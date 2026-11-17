import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfiguracionSueldos, Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { ContribucionCalc } from './calculo';

const D = Prisma.Decimal;
const clave = (anio: number, mes: number) => anio * 100 + mes;
export interface DatosContribucion { codigo: string; nombre: string; destino: ContribucionCalc['destino']; alicuota: number; importeFijo: number; aplicaDetraccion: boolean; cuentaContableId: string; desdeAnio: number; desdeMes: number; activa?: boolean }
export interface DatosConfiguracion { cuentaSueldosId: string; cuentaContribucionesId: string; cuentaSueldosAPagarId: string; cuentaCargasSocialesId: string; cuentaRetencionesSindicalesId: string; cuentaIndemnizacionesId?: string | null; conceptoComisionesId?: string | null }
const CAMPOS_CONFIG = ['cuentaSueldosId', 'cuentaContribucionesId', 'cuentaSueldosAPagarId', 'cuentaCargasSocialesId', 'cuentaRetencionesSindicalesId'] as const;

/** Contribuciones patronales, parámetros previsionales y cuentas de sueldos de la empresa. */
@Injectable()
export class ContribucionesService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Todas las vigencias (o, con período, las que rigen en ese mes). */
  async listar(anio?: number, mes?: number) {
    if (anio && mes) return (await this.vigentes(this.tenant.db, anio, mes, true)).map((c) => ({ ...c, alicuota: new D(c.alicuota).toString(), importeFijo: new D(c.importeFijo).toFixed(2) }));
    const cs = await this.tenant.db.contribucionPatronal.findMany({ orderBy: [{ codigo: 'asc' }, { desdeAnio: 'asc' }, { desdeMes: 'asc' }] });
    return cs.map((c) => ({ ...c, alicuota: new D(c.alicuota).toString(), importeFijo: c.importeFijo.toFixed(2) }));
  }

  /** Contribuciones que rigen en el período: por código, la vigencia más reciente ≤ período (solo activas). */
  async vigentes(tx: TxEmpresa, anio: number, mes: number, conId = false): Promise<(ContribucionCalc & { id?: string })[]> {
    const todas = await tx.contribucionPatronal.findMany({ orderBy: [{ desdeAnio: 'desc' }, { desdeMes: 'desc' }] });
    const porCodigo = new Map<string, (typeof todas)[number]>();
    for (const c of todas) if (clave(c.desdeAnio, c.desdeMes) <= clave(anio, mes) && !porCodigo.has(c.codigo)) porCodigo.set(c.codigo, c);
    return [...porCodigo.values()].filter((c) => c.activa).sort((a, b) => a.codigo.localeCompare(b.codigo)).map((c) => ({
      ...(conId ? { id: c.id } : {}), codigo: c.codigo, nombre: c.nombre, destino: c.destino, alicuota: new D(c.alicuota), importeFijo: new D(c.importeFijo), aplicaDetraccion: c.aplicaDetraccion, cuentaContableId: c.cuentaContableId,
    }));
  }

  private async validarCuenta(tx: TxEmpresa, id: string) {
    const c = await tx.cuentaContable.findUnique({ where: { id } });
    if (!c || !c.imputable || !c.activa) throw new BadRequestException('Cuenta contable inválida: debe ser imputable y activa');
  }

  async crear(d: DatosContribucion) {
    await this.validarCuenta(this.tenant.db, d.cuentaContableId);
    if (await this.tenant.db.contribucionPatronal.findFirst({ where: { codigo: d.codigo, desdeAnio: d.desdeAnio, desdeMes: d.desdeMes } }))
      throw new BadRequestException(`Ya existe ${d.codigo} desde ${String(d.desdeMes).padStart(2, '0')}/${d.desdeAnio}`);
    return this.tenant.db.contribucionPatronal.create({ data: { ...d, empresaId: this.tenant.empresaId } });
  }

  async modificar(id: string, d: DatosContribucion) {
    if (!(await this.tenant.db.contribucionPatronal.findUnique({ where: { id } }))) throw new NotFoundException('Contribución inexistente');
    await this.validarCuenta(this.tenant.db, d.cuentaContableId);
    return this.tenant.db.contribucionPatronal.update({ where: { id }, data: d });
  }

  /** Parámetros que rigen en el período (la fila del mes o la última anterior). */
  async parametros(tx: TxEmpresa, anio: number, mes: number): Promise<{ anio: number; mes: number; baseMaxima: Prisma.Decimal | null; detraccion: Prisma.Decimal; aviso?: string }> {
    const p = await tx.parametroPrevisional.findFirst({ where: { OR: [{ anio: { lt: anio } }, { anio, mes: { lte: mes } }] }, orderBy: [{ anio: 'desc' }, { mes: 'desc' }] });
    if (!p) return { anio, mes, baseMaxima: null, detraccion: new D(0), aviso: 'No hay parámetros previsionales cargados' };
    return { anio: p.anio, mes: p.mes, baseMaxima: p.baseMaximaAportes, detraccion: p.detraccion };
  }

  async verParametros(anio: number, mes: number) {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Mes inválido');
    const p = await this.parametros(this.tenant.db, anio, mes);
    return { anio: p.anio, mes: p.mes, baseMaximaAportes: p.baseMaxima?.toFixed(2) ?? null, detraccion: p.detraccion.toFixed(2), ...(p.aviso ? { aviso: p.aviso } : {}) };
  }

  async guardarParametros(d: { anio: number; mes: number; baseMaximaAportes: number | null; detraccion: number }) {
    await this.tenant.db.parametroPrevisional.upsert({
      where: { empresaId_anio_mes: { empresaId: this.tenant.empresaId, anio: d.anio, mes: d.mes } },
      create: { empresaId: this.tenant.empresaId, ...d }, update: { baseMaximaAportes: d.baseMaximaAportes, detraccion: d.detraccion },
    });
    return this.verParametros(d.anio, d.mes);
  }

  /** Configuración completa de cuentas (lanza si falta alguna). */
  async configuracion(tx: TxEmpresa): Promise<ConfiguracionSueldos & DatosConfiguracion> {
    const c = await tx.configuracionSueldos.findFirst();
    if (!c || CAMPOS_CONFIG.some((k) => !c[k])) throw new BadRequestException('Configure las cuentas de sueldos');
    return c as ConfiguracionSueldos & DatosConfiguracion;
  }

  async verConfiguracion() {
    const c = await this.tenant.db.configuracionSueldos.findFirst();
    const ids = [...CAMPOS_CONFIG, 'cuentaIndemnizacionesId' as const].map((k) => c?.[k]).filter((x): x is string => !!x);
    const cuentas = new Map((await this.tenant.db.cuentaContable.findMany({ where: { id: { in: ids } }, select: { id: true, codigo: true, nombre: true } })).map((x) => [x.id, x]));
    const concepto = c?.conceptoComisionesId ? await this.tenant.db.concepto.findUnique({ where: { id: c.conceptoComisionesId }, select: { id: true, codigo: true, nombre: true } }) : null;
    return {
      ...Object.fromEntries([...CAMPOS_CONFIG, 'cuentaIndemnizacionesId' as const].flatMap((k) => [[k, c?.[k] ?? null], [k.replace(/Id$/, ''), c?.[k] ? cuentas.get(c[k]!) ?? null : null]])),
      conceptoComisionesId: c?.conceptoComisionesId ?? null, conceptoComisiones: concepto,
    };
  }

  async guardarConfiguracion(d: DatosConfiguracion) {
    for (const k of CAMPOS_CONFIG) await this.validarCuenta(this.tenant.db, d[k]);
    if (d.cuentaIndemnizacionesId) await this.validarCuenta(this.tenant.db, d.cuentaIndemnizacionesId);
    if (d.conceptoComisionesId) {
      const c = await this.tenant.db.concepto.findUnique({ where: { id: d.conceptoComisionesId } });
      if (!c || c.tipo !== 'FIJO' || !c.activo || c.clase === 'DESCUENTO') throw new BadRequestException('Concepto de comisiones inválido: debe ser fijo, activo y no de descuento');
    }
    const actual = await this.tenant.db.configuracionSueldos.findFirst();
    if (actual) await this.tenant.db.configuracionSueldos.update({ where: { id: actual.id }, data: d });
    else await this.tenant.db.configuracionSueldos.create({ data: { ...d, empresaId: this.tenant.empresaId } });
    return this.verConfiguracion();
  }
}
