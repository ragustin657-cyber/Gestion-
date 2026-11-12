import { BadRequestException, Injectable } from '@nestjs/common';
import type { ConfigAjusteInflacion, Ejercicio } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../consultas/saldos';
import type { DatosConfig } from './dto';

const numMes = (anio: number, mes: number) => anio * 12 + mes;

@Injectable()
export class ConfigAjusteService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  obtener(tx: TxEmpresa): Promise<ConfigAjusteInflacion | null> {
    return tx.configAjusteInflacion.findFirst();
  }

  async requerir(tx: TxEmpresa): Promise<ConfigAjusteInflacion> {
    const c = await this.obtener(tx);
    if (!c) throw new BadRequestException('Configure el ajuste por inflación');
    return c;
  }

  /** Saldo de apertura (debe − haber) por cuenta: el asiento elegido en el primer ejercicio, o los asientos APERTURA. */
  async aperturaDe(tx: TxEmpresa, ejercicio: Ejercicio, config: Pick<ConfigAjusteInflacion, 'primerEjercicioId' | 'asientoAperturaId'>): Promise<Map<string, Dec>> {
    const where = ejercicio.id === config.primerEjercicioId && config.asientoAperturaId
      ? { asientoId: config.asientoAperturaId }
      : { asiento: { ejercicioId: ejercicio.id, tipo: 'APERTURA' as const } };
    const g = await tx.asientoRenglon.groupBy({ by: ['cuentaContableId'], where, _sum: { debe: true, haber: true } });
    return new Map(g.map((x) => [x.cuentaContableId, new D(x._sum.debe ?? 0).minus(x._sum.haber ?? 0)]));
  }

  /** Cuentas que se pueden anticuar: no monetarias con saldo de apertura, salvo Resultados no asignados y RECPAM. */
  private async anticuables(tx: TxEmpresa, ejercicio: Ejercicio, config: Pick<ConfigAjusteInflacion, 'primerEjercicioId' | 'asientoAperturaId'>) {
    const apertura = await this.aperturaDe(tx, ejercicio, config);
    const excluidas = new Set(await Promise.all([this.cuentas.cuenta(tx, 'RESULTADOS_NO_ASIGNADOS'), this.cuentas.cuenta(tx, 'RECPAM')]));
    const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: [...apertura.keys()] }, monetaria: false }, orderBy: { codigo: 'asc' } });
    return cuentas.filter((c) => !excluidas.has(c.id) && !apertura.get(c.id)!.isZero()).map((c) => ({ cuenta: c, saldo: apertura.get(c.id)! }));
  }

  async vista() {
    const db = this.tenant.db;
    const c = await this.obtener(db);
    if (!c) return { primerEjercicioId: null, asientoAperturaId: null, anticuacion: [] };
    const ej = await db.ejercicio.findUniqueOrThrow({ where: { id: c.primerEjercicioId } });
    const tramos = await db.anticuacionApertura.findMany({ orderBy: [{ anio: 'asc' }, { mes: 'asc' }] });
    return {
      primerEjercicioId: c.primerEjercicioId,
      asientoAperturaId: c.asientoAperturaId,
      anticuacion: (await this.anticuables(db, ej, c)).map(({ cuenta, saldo }) => ({
        cuentaContableId: cuenta.id, codigo: cuenta.codigo, nombre: cuenta.nombre, saldoApertura: saldo.toFixed(2),
        tramos: tramos.filter((t) => t.cuentaContableId === cuenta.id).map((t) => ({ anio: t.anio, mes: t.mes, importe: new D(t.importe).toFixed(2) })),
      })),
    };
  }

  guardar(d: DatosConfig) {
    return this.tenant.transaccion(async (tx) => {
      const ej = await tx.ejercicio.findUnique({ where: { id: d.primerEjercicioId } });
      if (!ej) throw new BadRequestException('Ejercicio inexistente');
      const actual = await this.obtener(tx);
      if (actual) await bloquear(tx, 'ConfigAjusteInflacion', this.tenant.empresaId, [actual.id]);
      if (actual && actual.primerEjercicioId !== d.primerEjercicioId) await this.sinAjustesVigentes(tx);
      const hayAjustes = await this.hayAjustesVigentes(tx);
      const asientoAperturaId = d.asientoAperturaId ?? null;
      if (asientoAperturaId) {
        const a = await tx.asiento.findUnique({ where: { id: asientoAperturaId } });
        if (!a || a.ejercicioId !== ej.id) throw new BadRequestException('El asiento de apertura debe ser del primer ejercicio ajustado');
        if (a.anulaAId || (await tx.asiento.count({ where: { anulaAId: a.id } }))) throw new BadRequestException('El asiento de apertura está anulado');
      }
      const anticuables = new Map((await this.anticuables(tx, ej, { primerEjercicioId: ej.id, asientoAperturaId })).map((x) => [x.cuenta.id, x]));
      const inicio = numMes(ej.desde.getUTCFullYear(), ej.desde.getUTCMonth() + 1);
      for (const a of d.anticuacion) {
        const x = anticuables.get(a.cuentaContableId);
        if (!x) throw new BadRequestException('Solo se anticúan cuentas no monetarias con saldo de apertura');
        if (a.tramos.some((t) => numMes(t.anio, t.mes) >= inicio)) throw new BadRequestException('El mes de origen debe ser anterior al inicio del ejercicio');
        const suma = a.tramos.reduce((s, t) => s.plus(t.importe), new D(0));
        const mismoSigno = a.tramos.every((t) => Math.sign(t.importe) === x.saldo.s);
        if (!mismoSigno || suma.abs().gt(x.saldo.abs())) throw new BadRequestException(`La anticuación de ${x.cuenta.codigo} supera su saldo de apertura`);
        const meses = new Set(a.tramos.map((t) => numMes(t.anio, t.mes)));
        if (meses.size !== a.tramos.length) throw new BadRequestException(`La anticuación de ${x.cuenta.codigo} repite un mes de origen`);
      }
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const empresaId = this.tenant.empresaId;
      await tx.configAjusteInflacion.upsert({
        where: { empresaId },
        create: { empresaId, primerEjercicioId: ej.id, asientoAperturaId, actualizadoPor: usuario },
        update: { primerEjercicioId: ej.id, asientoAperturaId, actualizadoPor: usuario },
      });
      await tx.anticuacionApertura.deleteMany({});
      await tx.anticuacionApertura.createMany({
        data: d.anticuacion.flatMap((a) => a.tramos.map((t) => ({ empresaId, cuentaContableId: a.cuentaContableId, anio: t.anio, mes: t.mes, importe: t.importe }))),
      });
      await this.auditoria.registrar(tx, { entidad: 'ConfigAjusteInflacion', entidadId: empresaId, accion: 'MODIFICAR', datos: d });
      return { ok: true, advertencias: hayAjustes ? ['Hay ajustes generados: el próximo ajuste recalculará la diferencia'] : [] };
    });
  }

  private async hayAjustesVigentes(tx: TxEmpresa) {
    const ajustes = await tx.asiento.findMany({ where: { origenTipo: 'AJUSTE_INFLACION', anulaAId: null }, select: { id: true } });
    if (!ajustes.length) return false;
    return ajustes.length > (await tx.asiento.count({ where: { anulaAId: { in: ajustes.map((a) => a.id) } } }));
  }

  /** Lanza si hay ajustes por inflación vigentes (no anulados). */
  async sinAjustesVigentes(tx: TxEmpresa) {
    const ajustes = await tx.asiento.findMany({ where: { origenTipo: 'AJUSTE_INFLACION', anulaAId: null }, select: { id: true } });
    const anulados = await tx.asiento.count({ where: { anulaAId: { in: ajustes.map((a) => a.id) } } });
    if (ajustes.length > anulados) throw new BadRequestException('Hay ajustes generados: anúlelos antes de cambiar el primer ejercicio');
  }
}
