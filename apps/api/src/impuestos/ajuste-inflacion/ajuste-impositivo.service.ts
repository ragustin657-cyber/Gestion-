import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TipoCuenta } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { ORIGEN_AJUSTE } from '../../contabilidad/ajuste-inflacion/ajuste-inflacion.service';
import { indicesPara, Mes } from '../../indices-inflacion/indices';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ajusteImpositivo, clasificarAsiento, mesesNecesarios, MovimientoDinamico } from './calculo';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const mes = (d: Date) => d.toISOString().slice(0, 7);
const aMes = (m: string): Mes => ({ anio: Number(m.slice(0, 4)), mes: Number(m.slice(5, 7)) });
const dia = (d: Date) => d.toISOString().slice(0, 10);
export interface DatosPartida { ejercicioId: string; concepto: string; tipo: 'ACTIVO_INICIO' | 'PASIVO_INICIO' | 'DINAMICO'; fecha?: Date | null; importe: number }

@Injectable()
export class AjusteImpositivoService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService, private readonly cls: ClsService) {}

  /** Asientos de la apertura inicial del sistema (spec E45 §4): aperturas del primer ejercicio y el asiento manual del ajuste contable. */
  private async aperturaInicial(tx: TxEmpresa): Promise<string[]> {
    const primero = await tx.ejercicio.findFirst({ orderBy: { desde: 'asc' } });
    if (!primero) return [];
    const ids = (await tx.asiento.findMany({ where: { ejercicioId: primero.id, tipo: 'APERTURA' }, select: { id: true } })).map((a) => a.id);
    const config = await tx.configAjusteInflacion.findFirst();
    if (config?.asientoAperturaId && config.primerEjercicioId === primero.id) ids.push(config.asientoAperturaId);
    return ids;
  }

  /** Planilla del ajuste por inflación impositivo de un ejercicio (spec E45 §5). */
  async planilla(q: { ejercicioId?: string }) {
    const tx = this.tenant.db;
    if (!q.ejercicioId) throw new BadRequestException('Indique el ejercicio');
    const ej = await tx.ejercicio.findUnique({ where: { id: q.ejercicioId } });
    if (!ej) throw new NotFoundException('Ejercicio no encontrado');
    const empresaId = this.tenant.empresaId;
    const apertura = await this.aperturaInicial(tx);
    const ids = apertura.length ? Prisma.sql`${Prisma.join(apertura.map((id) => Prisma.sql`${id}::uuid`))}` : Prisma.sql`NULL::uuid`;
    const desde = dia(ej.desde), hasta = dia(ej.hasta);

    // Saldos nominales al inicio: sin cierres, aperturas ni ajustes contables; más la apertura inicial del sistema
    const saldos = await tx.$queryRaw<{ id: string; codigo: string; nombre: string; tipo: TipoCuenta; saldo: Prisma.Decimal }[]>`
      SELECT c."id", c."codigo", c."nombre", c."tipo", SUM(r."debe" - r."haber") AS saldo
      FROM "AsientoRenglon" r JOIN "Asiento" a ON a."id" = r."asientoId" JOIN "CuentaContable" c ON c."id" = r."cuentaContableId"
      WHERE a."empresaId" = ${empresaId}::uuid AND c."tipo" IN ('ACTIVO', 'PASIVO') AND c."ajusteImpositivo" = 'COMPUTABLE'
        AND ((a."fecha" < ${desde}::date AND a."tipo" NOT IN ('CIERRE', 'APERTURA', 'AJUSTE_INFLACION') AND a."origenTipo" <> ${ORIGEN_AJUSTE} AND a."id" NOT IN (${ids}))
             OR a."id" IN (${ids}))
      GROUP BY 1, 2, 3, 4 HAVING SUM(r."debe" - r."haber") <> 0 ORDER BY c."codigo"`;
    const cuentas = saldos.map((s) => ({ codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, saldo: s.tipo === 'ACTIVO' ? new D(s.saldo) : new D(s.saldo).negated() }));
    const activo = cuentas.filter((c) => c.tipo === 'ACTIVO').reduce((t, c) => t.plus(c.saldo), new D(0));
    const pasivo = cuentas.filter((c) => c.tipo === 'PASIVO').reduce((t, c) => t.plus(c.saldo), new D(0));

    // Movimientos del ejercicio por asiento (patrimonio neto y activo excluido)
    const renglones = await tx.$queryRaw<{ asientoId: string; numero: number; fecha: Date; descripcion: string; origenTipo: string; tipoCuenta: TipoCuenta; excluida: boolean; debe: Prisma.Decimal; haber: Prisma.Decimal }[]>`
      SELECT a."id" AS "asientoId", COALESCE(a."numeroDefinitivo", a."numero") AS numero, a."fecha", a."descripcion", a."origenTipo",
             c."tipo" AS "tipoCuenta", (c."ajusteImpositivo" = 'EXCLUIDO') AS excluida, r."debe", r."haber"
      FROM "AsientoRenglon" r JOIN "Asiento" a ON a."id" = r."asientoId" JOIN "CuentaContable" c ON c."id" = r."cuentaContableId"
      WHERE a."empresaId" = ${empresaId}::uuid AND a."fecha" BETWEEN ${desde}::date AND ${hasta}::date AND a."tipo" IN ('AUTOMATICO', 'MANUAL')
        AND a."origenTipo" <> ${ORIGEN_AJUSTE} AND a."id" NOT IN (${ids}) AND c."tipo" IN ('PATRIMONIO_NETO', 'ACTIVO')
      ORDER BY a."fecha", 2`;
    const porAsiento = new Map<string, typeof renglones>();
    for (const r of renglones) porAsiento.set(r.asientoId, [...(porAsiento.get(r.asientoId) ?? []), r]);
    const movimientos: MovimientoDinamico[] = [];
    for (const rs of porAsiento.values()) {
      const a = rs[0];
      const { pn, excluidos } = clasificarAsiento(rs.map((r) => ({ tipoCuenta: r.tipoCuenta, excluida: r.excluida, debe: new D(r.debe), haber: new D(r.haber) })));
      const base = { fecha: a.fecha, asientoNumero: a.numero, descripcion: a.descripcion };
      if (pn.gt(0)) movimientos.push({ ...base, tipo: 'APORTE', importe: pn.negated() });
      if (pn.lt(0)) movimientos.push({ ...base, tipo: 'RETIRO', importe: pn.negated() });
      // Las amortizaciones bajan el activo excluido pero no son ventas
      if (a.origenTipo !== 'AMORTIZACION' && !excluidos.isZero()) movimientos.push({ ...base, tipo: excluidos.gt(0) ? 'COMPRA_EXCLUIDO' : 'VENTA_EXCLUIDO', importe: excluidos });
    }
    const partidas = await tx.ajusteImpositivoPartida.findMany({ where: { ejercicioId: ej.id }, orderBy: [{ tipo: 'asc' }, { fecha: 'asc' }, { creadoEn: 'asc' }] });
    const manual = (t: string) => partidas.filter((p) => p.tipo === t).reduce((s, p) => s.plus(p.importe), new D(0));
    for (const p of partidas.filter((x) => x.tipo === 'DINAMICO'))
      movimientos.push({ fecha: p.fecha!, asientoNumero: null, descripcion: p.concepto, tipo: 'MANUAL', importe: new D(p.importe) });
    movimientos.sort((x, y) => x.fecha.getTime() - y.fecha.getTime());

    const mesCierre = mes(ej.hasta), mesAnterior = mes(new Date(ej.desde.getTime() - 86400000));
    const indices = await indicesPara(tx, mesesNecesarios({ mesAnterior, mesCierre, movimientos }).map(aMes));
    const r = ajusteImpositivo({
      mesAnterior, mesCierre, activoComputable: activo, pasivoComputable: pasivo, manualActivo: manual('ACTIVO_INICIO'), manualPasivo: manual('PASIVO_INICIO'),
      movimientos, indice: (m) => indices.get(m)!,
    });
    const t = (x: Dec) => x.toFixed(2);
    return {
      ejercicio: { numero: ej.numero, desde, hasta },
      estatico: {
        cuentas: cuentas.map((c) => ({ ...c, saldo: t(c.saldo) })), activo: t(activo), pasivo: t(pasivo), manualActivo: t(manual('ACTIVO_INICIO')), manualPasivo: t(manual('PASIVO_INICIO')),
        base: t(r.base), coeficiente: r.coeficienteEstatico.toFixed(6), ajuste: t(r.estatico),
      },
      dinamico: { movimientos: r.dinamico.map((m) => ({ fecha: dia(m.fecha), asientoNumero: m.asientoNumero, descripcion: m.descripcion, tipo: m.tipo, importe: t(m.importe), coeficiente: m.coeficiente.toFixed(6), ajuste: t(m.ajuste) })), total: t(r.totalDinamico) },
      partidas: partidas.map((p) => ({ id: p.id, concepto: p.concepto, tipo: p.tipo, fecha: p.fecha ? dia(p.fecha) : null, importe: t(new D(p.importe)) })),
      variacion36: t(r.variacion36), corresponde: r.corresponde, total: t(r.total), totalDj: t(r.totalDj), aviso: r.aviso,
    };
  }

  partidas(ejercicioId?: string) {
    if (!ejercicioId) throw new BadRequestException('Indique el ejercicio');
    return this.tenant.db.ajusteImpositivoPartida.findMany({ where: { ejercicioId }, orderBy: [{ tipo: 'asc' }, { creadoEn: 'asc' }] });
  }

  guardarPartida(id: string | null, d: DatosPartida) {
    const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.ejercicio.findUnique({ where: { id: d.ejercicioId } }))) throw new NotFoundException('Ejercicio no encontrado');
      const data = { ejercicioId: d.ejercicioId, concepto: d.concepto, tipo: d.tipo, fecha: d.tipo === 'DINAMICO' ? d.fecha ?? null : null, importe: d.importe };
      if (id && !(await tx.ajusteImpositivoPartida.findUnique({ where: { id } }))) throw new NotFoundException('Partida no encontrada');
      const p = id ? await tx.ajusteImpositivoPartida.update({ where: { id }, data }) : await tx.ajusteImpositivoPartida.create({ data: { ...data, empresaId: this.tenant.empresaId, creadoPor: usuario } });
      await this.auditoria.registrar(tx, { entidad: 'AjusteImpositivoPartida', entidadId: p.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
      return p;
    });
  }

  eliminarPartida(id: string) {
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.ajusteImpositivoPartida.findUnique({ where: { id } }))) throw new NotFoundException('Partida no encontrada');
      await tx.ajusteImpositivoPartida.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'AjusteImpositivoPartida', entidadId: id, accion: 'ELIMINAR' });
      return { ok: true };
    });
  }
}
