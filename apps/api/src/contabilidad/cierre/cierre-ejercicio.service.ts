import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CuentaContable, Ejercicio, PeriodoContable } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AsientosService, RenglonAsiento } from '../asientos/asientos.service';
import { D, Dec, saldosPorCuenta } from '../consultas/saldos';
import { PeriodosService } from '../periodos/periodos.service';

const RESULTADOS = ['RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO'];
const PATRIMONIALES = ['ACTIVO', 'PASIVO', 'PATRIMONIO_NETO'];

/** Renglón que deja en cero un saldo (debe − haber). */
const inverso = (cuentaContableId: string, saldo: Dec): RenglonAsiento =>
  saldo.gt(0) ? { cuentaContableId, haber: saldo.toFixed(2) } : { cuentaContableId, debe: saldo.neg().toFixed(2) };
const mmaaaa = (p: PeriodoContable) => `${String(p.mes).padStart(2, '0')}/${p.anio}`;

@Injectable()
export class CierreEjercicioService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly asientos: AsientosService,
    private readonly periodos: PeriodosService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private async ejercicio(tx: TxEmpresa, id: string) {
    const e = await tx.ejercicio.findUnique({ where: { id }, include: { periodos: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } } });
    if (!e) throw new NotFoundException('Ejercicio no encontrado');
    return e;
  }

  /** Requisitos que faltan para cerrar, en orden. */
  private async faltantes(tx: TxEmpresa, e: Ejercicio & { periodos: PeriodoContable[] }) {
    const r: string[] = [];
    if (e.estado === 'CERRADO') return ['El ejercicio ya está cerrado'];
    const anterior = await tx.ejercicio.findFirst({ where: { numero: { lt: e.numero }, estado: 'ABIERTO' }, orderBy: { numero: 'asc' } });
    if (anterior) return [`Cierre primero el ejercicio ${anterior.numero}`];
    if (e.periodos.slice(0, 11).some((p) => p.estado !== 'CERRADO')) r.push(`Cierre los períodos hasta ${mmaaaa(e.periodos[10])}`);
    const sig = await tx.ejercicio.findFirst({ where: { numero: e.numero + 1 }, include: { periodos: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } } });
    if (!sig) r.push('Abra el ejercicio siguiente');
    else if (sig.periodos[0]?.estado !== 'ABIERTO') r.push('El primer período del ejercicio siguiente debe estar abierto');
    return r;
  }

  /** Renglones de la refundición y del cierre, calculados con los saldos del ejercicio. */
  private async calcular(tx: TxEmpresa, e: Ejercicio) {
    const saldos = await saldosPorCuenta(tx, { ejercicioId: e.id });
    const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: [...saldos.keys()] } } });
    const tipo = new Map<string, CuentaContable['tipo']>(cuentas.map((c) => [c.id, c.tipo]));
    const saldo = new Map<string, Dec>([...saldos].map(([id, s]) => [id, s.debe.minus(s.haber)]));
    const refundicion: RenglonAsiento[] = [];
    let resultado = new D(0); // positivo = ganancia (saldo acreedor neto de resultados)
    for (const [id, s] of saldo) if (RESULTADOS.includes(tipo.get(id)!) && !s.isZero()) {
      refundicion.push(inverso(id, s));
      resultado = resultado.minus(s);
    }
    const cuentaResultado = await this.cuentas.cuenta(tx, 'RESULTADO_DEL_EJERCICIO');
    if (refundicion.length && !resultado.isZero()) refundicion.push(inverso(cuentaResultado, resultado));
    // Saldos patrimoniales después de la refundición
    if (refundicion.length) {
      saldo.set(cuentaResultado, (saldo.get(cuentaResultado) ?? new D(0)).minus(resultado));
      tipo.set(cuentaResultado, 'PATRIMONIO_NETO');
    }
    const cierre: RenglonAsiento[] = [];
    for (const [id, s] of saldo) if (PATRIMONIALES.includes(tipo.get(id)!) && !s.isZero()) cierre.push(inverso(id, s));
    return { refundicion, cierre, resultado };
  }

  async previa(id: string) {
    const db = this.tenant.db;
    const e = await this.ejercicio(db, id);
    const { refundicion, cierre, resultado } = await this.calcular(db, e);
    const cuentas = await db.cuentaContable.findMany({ where: { id: { in: [...refundicion, ...cierre].map((r) => r.cuentaContableId) } } });
    const vista = (rs: RenglonAsiento[]) => rs.map((r) => {
      const c = cuentas.find((x) => x.id === r.cuentaContableId)!;
      return { cuenta: `${c.codigo} ${c.nombre}`, debe: r.debe ?? '0', haber: r.haber ?? '0' };
    });
    return { resultado: resultado.toString(), refundicion: vista(refundicion), cierre: vista(cierre), faltantes: await this.faltantes(db, e) };
  }

  cerrar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.ejercicio(tx, id);
      await bloquear(tx, 'Ejercicio', this.tenant.empresaId, [id]);
      const previo = await this.ejercicio(tx, id);
      // Antes de calcular los saldos: el último mes y el primero del siguiente, en ese orden (el mismo que usa generar)
      await bloquear(tx, 'PeriodoContable', this.tenant.empresaId, [previo.periodos[11].id]);
      const siguiente = await tx.ejercicio.findFirst({ where: { numero: previo.numero + 1 }, include: { periodos: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } } });
      if (siguiente) await bloquear(tx, 'PeriodoContable', this.tenant.empresaId, [siguiente.periodos[0].id]);
      const e = await this.ejercicio(tx, id);
      const faltan = await this.faltantes(tx, e);
      if (faltan.length) throw new BadRequestException(faltan[0]);
      const sig = await tx.ejercicio.findFirstOrThrow({ where: { numero: e.numero + 1 } });
      const { refundicion, cierre } = await this.calcular(tx, e);
      const base = { origenTipo: 'CIERRE_EJERCICIO', origenId: e.id };
      const ref = refundicion.length
        ? await this.asientos.generar(tx, { ...base, fecha: e.hasta, descripcion: `Refundición de cuentas de resultado - ejercicio ${e.numero}`, tipo: 'REFUNDICION', renglones: refundicion })
        : null;
      let cie: { id: string } | null = null;
      let ape: { id: string } | null = null;
      if (cierre.length) {
        cie = await this.asientos.generar(tx, { ...base, fecha: e.hasta, descripcion: `Cierre del ejercicio ${e.numero}`, tipo: 'CIERRE', renglones: cierre });
        const apertura = cierre.map((r) => ({ cuentaContableId: r.cuentaContableId, debe: r.haber, haber: r.debe }));
        ape = await this.asientos.generar(tx, { ...base, origenId: sig.id, fecha: sig.desde, descripcion: `Apertura del ejercicio ${sig.numero}`, tipo: 'APERTURA', renglones: apertura });
      }
      await this.periodos.cerrarEnTx(tx, e.periodos[11].id, true);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const r = await tx.ejercicio.update({
        where: { id }, data: { estado: 'CERRADO', asientoRefundicionId: ref?.id ?? null, asientoCierreId: cie?.id ?? null, asientoAperturaId: ape?.id ?? null, cerradoPor: usuario, cerradoEn: new Date(), motivoReapertura: null },
      });
      await this.auditoria.registrar(tx, { entidad: 'Ejercicio', entidadId: id, accion: 'MODIFICAR', datos: { cierre: true } });
      return r;
    }, { timeout: 120000 });
  }

  reabrir(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.ejercicio(tx, id);
      await bloquear(tx, 'Ejercicio', this.tenant.empresaId, [id]);
      const e = await this.ejercicio(tx, id);
      if (e.estado !== 'CERRADO') throw new BadRequestException('El ejercicio no está cerrado');
      if (await tx.ejercicio.count({ where: { numero: { gt: e.numero }, estado: 'CERRADO' } })) throw new BadRequestException('Solo se puede reabrir el último ejercicio cerrado');
      const previoSig = await tx.ejercicio.findFirst({ where: { numero: e.numero + 1 } });
      // El cierre de meses del siguiente bloquea su ejercicio: así no se numera la apertura mientras se borra
      if (previoSig) await bloquear(tx, 'Ejercicio', this.tenant.empresaId, [previoSig.id]);
      const sig = await tx.ejercicio.findFirst({ where: { numero: e.numero + 1 }, include: { periodos: true } });
      if (sig?.periodos.some((p) => p.estado === 'CERRADO')) throw new BadRequestException('El ejercicio siguiente tiene períodos cerrados: reábralos primero');
      const ids = [e.asientoRefundicionId, e.asientoCierreId, e.asientoAperturaId].filter((x): x is string => !!x);
      for (const a of await tx.asiento.findMany({ where: { id: { in: ids } }, include: { renglones: true } }))
        await this.auditoria.registrar(tx, { entidad: 'Asiento', entidadId: a.id, accion: 'ELIMINAR', datos: a });
      await tx.asientoRenglon.deleteMany({ where: { asientoId: { in: ids } } });
      await tx.asiento.deleteMany({ where: { id: { in: ids } } });
      await this.periodos.reabrirEnTx(tx, e.periodos[11].id, motivo, true);
      const r = await tx.ejercicio.update({
        where: { id }, data: { estado: 'ABIERTO', asientoRefundicionId: null, asientoCierreId: null, asientoAperturaId: null, cerradoPor: null, cerradoEn: null, motivoReapertura: motivo },
      });
      await this.auditoria.registrar(tx, { entidad: 'Ejercicio', entidadId: id, accion: 'MODIFICAR', datos: { reapertura: motivo } });
      return r;
    }, { timeout: 120000 });
  }
}
