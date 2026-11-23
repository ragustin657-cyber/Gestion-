import { esUuid } from '../../comun/esquemas';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Ejercicio, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { PlanillaImpositivaService } from '../../bienes-uso/planilla-impositiva.service';
import { ORIGEN_AJUSTE } from '../../contabilidad/ajuste-inflacion/ajuste-inflacion.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AjusteImpositivoService } from '../ajuste-inflacion/ajuste-impositivo.service';
import { determinarDj, ResultadoDj } from './calculo';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const dia = (d: Date) => d.toISOString().slice(0, 10);
const mes = (d: Date) => d.toISOString().slice(0, 7);
export const DJ_PRESENTADA = 'La DJ de Ganancias del ejercicio está presentada';
export interface DatosCargados { ejercicioId: string; quebrantosAnteriores: number; anticiposIngresados: number; saldoAFavorAnterior: number; impuestoCheque: number; otrosPagos: number }
export interface Tramo { desde: number; fijo: number; alicuota: number }

/** Determinación en texto (2 decimales) para la respuesta y la foto. */
function texto(r: ResultadoDj) {
  const t = (x: Dec) => x.toFixed(2);
  return {
    resultadoContable: t(r.resultadoContable), ajusteAmortizaciones: t(r.ajusteAmortizaciones), ajusteInflacion: t(r.ajusteInflacion), totalAjustesManuales: t(r.totalAjustesManuales),
    resultadoImpositivo: t(r.resultadoImpositivo), quebrantosComputados: t(r.quebrantosComputados), quebrantoEjercicio: t(r.quebrantoEjercicio), gananciaNetaImponible: t(r.gananciaNetaImponible),
    impuestoDeterminado: t(r.impuestoDeterminado), pagosACuenta: t(r.pagosACuenta), saldo: t(r.saldo), baseAnticipos: t(r.baseAnticipos), vencimientoDj: r.vencimientoDj,
    anticipos: r.anticipos.map((a) => ({ numero: a.numero, mes: a.mes, porcentaje: a.porcentaje.toString(), importe: t(a.importe) })), avisos: r.avisos,
  };
}
export type Determinacion = ReturnType<typeof texto> & { retenciones: string; percepciones: string };

@Injectable()
export class DjGananciasService {
  constructor(
    private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService, private readonly cls: ClsService,
    private readonly amortizacion: PlanillaImpositivaService, private readonly ajusteInflacion: AjusteImpositivoService,
  ) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  // --- Escala de sociedades ---

  escala(anio: number) {
    return this.tenant.db.escalaSociedades.findMany({ where: { anio }, orderBy: { desde: 'asc' } });
  }

  guardarEscala(anio: number, tramos: Tramo[]) {
    if (!tramos.length || tramos[0].desde !== 0) throw new BadRequestException('El primer tramo empieza en 0');
    if (tramos.some((t, i) => i > 0 && t.desde <= tramos[i - 1].desde)) throw new BadRequestException('Los tramos deben estar ordenados de menor a mayor');
    // Revisión E46: el fijo de cada tramo es el impuesto acumulado hasta su «desde» (tolerancia por el redondeo de ARCA)
    for (let i = 1; i < tramos.length; i++) {
      const a = tramos[i - 1];
      const esperado = new D(a.fijo).plus(new D(tramos[i].desde).minus(a.desde).times(a.alicuota).div(100));
      if (new D(tramos[i].fijo).minus(esperado).abs().gt(D.max(1, esperado.times('0.01'))))
        throw new BadRequestException(`El monto fijo del tramo ${i + 1} no continúa el tramo anterior (esperado ${esperado.toFixed(2)})`);
    }
    return this.tenant.transaccion(async (tx) => {
      await tx.escalaSociedades.deleteMany({ where: { anio } });
      await tx.escalaSociedades.createMany({ data: tramos.map((t) => ({ empresaId: this.tenant.empresaId, anio, ...t })) });
      await this.auditoria.registrar(tx, { entidad: 'EscalaSociedades', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: { anio, tramos } });
      return tx.escalaSociedades.findMany({ where: { anio }, orderBy: { desde: 'asc' } });
    });
  }

  // --- DJ ---

  private async ejercicio(tx: TxEmpresa, id?: string): Promise<Ejercicio> {
    if (!id) throw new BadRequestException('Indique el ejercicio');
    const ej = esUuid(id) ? await tx.ejercicio.findUnique({ where: { id } }) : null;
    if (!ej) throw new NotFoundException('Ejercicio no encontrado');
    return ej;
  }

  private async dj(tx: TxEmpresa, ejercicioId: string) {
    return (await tx.djGananciasSociedades.findUnique({ where: { ejercicioId } })) ?? tx.djGananciasSociedades.create({ data: { empresaId: this.tenant.empresaId, ejercicioId } });
  }

  /**
   * Error si la DJ del ejercicio está presentada. Revisión E46: toma la fila con FOR UPDATE, así una presentación en curso
   * termina antes (y la escritura la ve) o espera a esta escritura (y la foto la incluye).
   */
  async verificarEditable(tx: TxEmpresa, ejercicioId: string) {
    await this.dj(tx, ejercicioId);
    const [fila] = await tx.$queryRaw<{ estado: string }[]>`SELECT "estado" FROM "DjGananciasSociedades" WHERE "ejercicioId" = ${ejercicioId}::uuid AND "empresaId" = ${this.tenant.empresaId}::uuid FOR UPDATE`;
    if (fila?.estado === 'PRESENTADA') throw new BadRequestException(DJ_PRESENTADA);
  }

  /** Determinación al vuelo (spec E46 §3). */
  private async calcular(tx: TxEmpresa, ej: Ejercicio): Promise<Determinacion> {
    const desde = dia(ej.desde), hasta = dia(ej.hasta);
    const [{ resultado }] = await tx.$queryRaw<{ resultado: Prisma.Decimal | null }[]>`
      SELECT SUM(r."haber" - r."debe") AS resultado
      FROM "AsientoRenglon" r JOIN "Asiento" a ON a."id" = r."asientoId" JOIN "CuentaContable" c ON c."id" = r."cuentaContableId"
      WHERE a."empresaId" = ${this.tenant.empresaId}::uuid AND a."fecha" BETWEEN ${desde}::date AND ${hasta}::date
        AND a."tipo" IN ('AUTOMATICO', 'MANUAL') AND a."origenTipo" <> ${ORIGEN_AJUSTE} AND c."tipo" IN ('RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO')`;
    const retenciones = (await tx.reciboRetencion.aggregate({ _sum: { importe: true }, where: { tipo: 'GANANCIAS', fecha: { gte: ej.desde, lte: ej.hasta }, recibo: { estado: 'CONFIRMADO' } } }))._sum.importe ?? new D(0);
    // Revisión E46: también las retenciones de Ganancias de las liquidaciones de tarjetas
    const deTarjetas = (await tx.liquidacionTarjetaImpuesto.aggregate({ _sum: { importe: true }, where: { clase: 'RETENCION', tipo: 'GANANCIAS', liquidacion: { fecha: { gte: ej.desde, lte: ej.hasta }, estado: 'CONFIRMADO' } } }))._sum.importe ?? new D(0);
    const percepciones = (await tx.comprobanteCompra.aggregate({ _sum: { percepcionGanancias: true }, where: { fechaContable: { gte: ej.desde, lte: ej.hasta }, estado: 'CONFIRMADO' } }))._sum.percepcionGanancias ?? new D(0);
    const anio = ej.desde.getUTCFullYear();
    const tramos = await tx.escalaSociedades.findMany({ where: { anio }, orderBy: { desde: 'asc' } });
    if (!tramos.length) throw new BadRequestException(`Cargue la escala de Ganancias de sociedades de ${anio}`);
    // E44 y E45: si no se pueden calcular (p. ej. faltan índices), la DJ entera devuelve ese error
    const amort = await this.amortizacion.planilla({ ejercicioId: ej.id });
    const ajuste = await this.ajusteInflacion.planilla({ ejercicioId: ej.id });
    const dj = await this.dj(tx, ej.id);
    const ajustes = await tx.djGananciasAjuste.findMany({ where: { ejercicioId: ej.id } });
    const meses = (ej.hasta.getUTCFullYear() - ej.desde.getUTCFullYear()) * 12 + ej.hasta.getUTCMonth() - ej.desde.getUTCMonth() + 1;
    const r = determinarDj({
      resultadoContable: new D(resultado ?? 0), diferenciaAmortizaciones: new D(amort.totales.diferencia), ajusteInflacion: new D(ajuste.totalDj),
      ajustesManuales: ajustes.map((a) => ({ concepto: a.concepto, importe: new D(a.importe) })), quebrantosAnteriores: new D(dj.quebrantosAnteriores),
      tramos: tramos.map((t) => ({ desde: new D(t.desde), fijo: new D(t.fijo), alicuota: new D(t.alicuota) })),
      retenciones: new D(retenciones).plus(deTarjetas), percepciones: new D(percepciones), impuestoCheque: new D(dj.impuestoCheque), anticiposIngresados: new D(dj.anticiposIngresados),
      saldoAFavorAnterior: new D(dj.saldoAFavorAnterior), otrosPagos: new D(dj.otrosPagos), mesCierre: mes(ej.hasta), mesesEjercicio: meses,
    });
    const t = texto(r);
    t.avisos = [...t.avisos, ...amort.avisos, ...(ajuste.avisoApertura ? [ajuste.avisoApertura] : []), ...(ajuste.aviso ? [ajuste.aviso] : [])];
    return { ...t, retenciones: new D(retenciones).plus(deTarjetas).toFixed(2), percepciones: new D(percepciones).toFixed(2) };
  }

  async consultar(q: { ejercicioId?: string }) {
    const tx = this.tenant.db;
    const ej = await this.ejercicio(tx, q.ejercicioId);
    const dj = await this.dj(tx, ej.id);
    const presentaciones = await tx.djGananciasPresentacion.findMany({ where: { ejercicioId: ej.id }, orderBy: { numero: 'asc' } });
    const vigente = presentaciones.filter((p) => !p.anuladaEn).at(-1);
    // Presentada: la foto, no un recálculo
    const determinacion = dj.estado === 'PRESENTADA' && vigente ? (vigente.datos as unknown as Determinacion) : await this.calcular(tx, ej);
    const ajustes = await tx.djGananciasAjuste.findMany({ where: { ejercicioId: ej.id }, orderBy: { creadoEn: 'asc' } });
    const n = (x: Prisma.Decimal) => new D(x).toFixed(2);
    return {
      ejercicio: { numero: ej.numero, desde: dia(ej.desde), hasta: dia(ej.hasta), estado: ej.estado }, estado: dj.estado,
      datos: { quebrantosAnteriores: n(dj.quebrantosAnteriores), anticiposIngresados: n(dj.anticiposIngresados), saldoAFavorAnterior: n(dj.saldoAFavorAnterior), impuestoCheque: n(dj.impuestoCheque), otrosPagos: n(dj.otrosPagos) },
      ajustes: ajustes.map((a) => ({ id: a.id, concepto: a.concepto, importe: n(a.importe) })), determinacion,
      presentaciones: presentaciones.map((p) => ({ numero: p.numero, presentadaEn: p.presentadaEn, presentadaPor: p.presentadaPor, anuladaEn: p.anuladaEn, motivoAnulacion: p.motivoAnulacion })),
    };
  }

  guardarDatos(d: DatosCargados) {
    return this.tenant.transaccion(async (tx) => {
      const ej = await this.ejercicio(tx, d.ejercicioId);
      await this.verificarEditable(tx, ej.id);
      await this.dj(tx, ej.id);
      const { ejercicioId, ...datos } = d;
      const r = await tx.djGananciasSociedades.update({ where: { ejercicioId }, data: datos });
      await this.auditoria.registrar(tx, { entidad: 'DjGananciasSociedades', entidadId: r.id, accion: 'MODIFICAR', datos });
      return r;
    });
  }

  guardarAjuste(id: string | null, d: { ejercicioId: string; concepto: string; importe: number }) {
    return this.tenant.transaccion(async (tx) => {
      const ej = await this.ejercicio(tx, d.ejercicioId);
      await this.verificarEditable(tx, ej.id);
      if (id) {
        const actual = await tx.djGananciasAjuste.findUnique({ where: { id } });
        if (!actual) throw new NotFoundException('Ajuste no encontrado');
        // Revisión E46: tampoco se saca un ajuste de una DJ presentada pasándolo a otro ejercicio
        await this.verificarEditable(tx, actual.ejercicioId);
      }
      const a = id ? await tx.djGananciasAjuste.update({ where: { id }, data: d }) : await tx.djGananciasAjuste.create({ data: { ...d, empresaId: this.tenant.empresaId } });
      await this.auditoria.registrar(tx, { entidad: 'DjGananciasAjuste', entidadId: a.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
      return a;
    });
  }

  eliminarAjuste(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const a = await tx.djGananciasAjuste.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Ajuste no encontrado');
      await this.verificarEditable(tx, a.ejercicioId);
      await tx.djGananciasAjuste.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'DjGananciasAjuste', entidadId: id, accion: 'ELIMINAR' });
      return { ok: true };
    });
  }

  presentar(ejercicioId?: string) {
    return this.tenant.transaccion(async (tx) => {
      const ej = await this.ejercicio(tx, ejercicioId);
      await this.verificarEditable(tx, ej.id);
      if (ej.estado !== 'CERRADO') throw new BadRequestException('Cierre el ejercicio antes de presentar la DJ');
      const datos = await this.calcular(tx, ej);
      const numero = await tx.djGananciasPresentacion.count({ where: { ejercicioId: ej.id } });
      const p = await tx.djGananciasPresentacion.create({ data: { empresaId: this.tenant.empresaId, ejercicioId: ej.id, numero, datos: datos as unknown as Prisma.InputJsonValue, presentadaPor: this.usuario() } });
      await tx.djGananciasSociedades.update({ where: { ejercicioId: ej.id }, data: { estado: 'PRESENTADA' } });
      await this.auditoria.registrar(tx, { entidad: 'DjGananciasPresentacion', entidadId: p.id, accion: 'APROBAR', datos: { numero } });
      return { numero };
    });
  }

  anular(ejercicioId: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const ej = await this.ejercicio(tx, ejercicioId);
      const dj = await tx.djGananciasSociedades.findUnique({ where: { ejercicioId: ej.id } });
      if (dj?.estado !== 'PRESENTADA') throw new BadRequestException('La DJ no está presentada');
      const vigente = await tx.djGananciasPresentacion.findFirst({ where: { ejercicioId: ej.id, anuladaEn: null }, orderBy: { numero: 'desc' } });
      if (vigente) await tx.djGananciasPresentacion.update({ where: { id: vigente.id }, data: { anuladaEn: new Date(), anuladaPor: this.usuario(), motivoAnulacion: motivo } });
      await tx.djGananciasSociedades.update({ where: { ejercicioId: ej.id }, data: { estado: 'BORRADOR' } });
      await this.auditoria.registrar(tx, { entidad: 'DjGananciasPresentacion', entidadId: vigente?.id ?? dj.id, accion: 'ANULAR', datos: { motivo } });
      return { ok: true };
    });
  }
}
