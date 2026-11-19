import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { acumuladoEmpleado, aportesTotales, brutaGravada } from './acumulado';
import { HojaGanancias, retencionGanancias } from './calculo';
import { armarF1359Empleado, DatosF1359Empleado } from './f1359-datos';
import { aTablaCalc, prepararDatos } from './preparar';
import { nombreSemestre, SinTablaGanancias, tablaAnual, tablaFinal } from './tablas';
import { TablasGananciasService } from './tablas.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const f = (x: Dec) => x.toFixed(2);

export interface AnualEmpleado { hoja: HojaGanancias; impuesto: Dec; retenido: Dec; pagosACuenta: Dec; saldo: Dec; f1359: DatosF1359Empleado }

/** Liquidación anual de Ganancias de cuarta (spec E32 §5). */
@Injectable()
export class AnualGananciasService {
  constructor(private readonly tenant: TenantPrisma, private readonly tablas: TablasGananciasService, private readonly cls: ClsService) {}

  /** Anual de un empleado: tabla anual (2.º semestre sin prorratear), año completo; saldo sin topes. */
  anualDeEmpleado(tx: TxEmpresa, empleadoId: string, anio: number): Promise<AnualEmpleado> {
    return this.liquidacionDeEmpleado(tx, empleadoId, anio, { modo: 'ANUAL', fechaPago: new Date(Date.UTC(anio, 11, 31)), mes: 12 });
  }

  /**
   * Liquidación de un empleado para la DJ (E32 §5 a §7): ANUAL con la tabla anual del 2.º semestre al 31/12;
   * FINAL con la tabla anual del semestre de pago, acumulado hasta la fecha de pago de la final.
   */
  async liquidacionDeEmpleado(tx: TxEmpresa, empleadoId: string, anio: number, o: { modo: 'ANUAL' | 'FINAL'; fechaPago: Date; mes: number }): Promise<AnualEmpleado> {
    const e = await tx.empleado.findUniqueOrThrow({ where: { id: empleadoId } });
    const { t1, t2 } = await this.tablas.tablasDelAnio(tx, anio);
    const c1 = t1 ? aTablaCalc(t1) : null;
    const c2 = t2 ? aTablaCalc(t2) : null;
    let tabla;
    if (o.modo === 'ANUAL') {
      if (!c2) throw new SinTablaGanancias(`Cargue la tabla de Ganancias de ${nombreSemestre(2, anio)}`);
      tabla = tablaAnual(c2);
    } else tabla = tablaFinal(c1, c2, o.mes, anio);
    const a = await acumuladoEmpleado(tx, empleadoId, anio, { fechaPago: o.fechaPago, mes: o.mes });
    const { deducciones, cargas, detalle } = prepararDatos(a, { tabla, c1, c2, mes: o.mes, modo: o.modo });
    const res = retencionGanancias({
      mes: o.mes, tabla, deducciones, cargas, bruta: brutaGravada(a), aportes: aportesTotales(a),
      retenidoAnterior: new D(0), retenidoEmpresa: new D(0), brutaRecibo: new D('1e15'),
    });
    const impuesto = new D(res.hoja.impuesto);
    const retenido = a.retenido.plus(a.previo.retenido).plus(a.otros.retenido);
    const saldo = impuesto.minus(retenido).minus(a.pagosACuenta);
    const hoja: HojaGanancias = { ...res.hoja, retenidoAnterior: f(retenido), pagosACuenta: f(a.pagosACuenta), calculado: f(saldo), importe: f(saldo), topeMes: '0.00', noRetenido: '0.00' };
    const f1359 = armarF1359Empleado(a, hoja, detalle, { cuil: e.cuil, anio, ingreso: e.fechaIngreso, egreso: e.fechaEgreso, retenido, pagosACuenta: a.pagosACuenta });
    return { hoja, impuesto, retenido, pagosACuenta: a.pagosACuenta, saldo, f1359 };
  }

  /** Mismo lock que el cierre de liquidaciones (E33): serializa la anual con los cierres que aplican el ajuste. */
  private async bloquear(tx: TxEmpresa) {
    await tx.$queryRawUnsafe(`SELECT id FROM "ConfiguracionSueldos" WHERE "empresaId" = $1::uuid FOR UPDATE`, this.tenant.empresaId);
    // Sin fila de ConfiguracionSueldos el FOR UPDATE no bloquea: la anual se serializa además con un lock propio por empresa (E34)
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `ganancias-anual:${this.tenant.empresaId}`);
  }

  private async encabezado(tx: TxEmpresa, anio: number) {
    return tx.liquidacionAnualGanancias.findUnique({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio } } });
  }

  async ver(anio: number, tx: TxEmpresa = this.tenant.db) {
    const l = await this.encabezado(tx, anio);
    if (!l) return { anio, estado: null, cerradoEn: null, empleados: [] };
    const filas = await tx.liquidacionAnualGananciasEmpleado.findMany({ where: { anualId: l.id } });
    const emps = new Map((await tx.empleado.findMany({ where: { id: { in: filas.map((x) => x.empleadoId) } } })).map((e) => [e.id, e]));
    // E34 (revisión): una final ya cerrada en el año siguiente que no lleva el renglón de ajuste de este año no lo aplicará:
    // se avisa si el empleado tiene saldo. No depende de fechas (la final pudo cerrarse antes que la anual con pago posterior).
    const conSaldo = filas.filter((x) => !x.distracto && !new D(x.saldo).isZero()).map((x) => x.empleadoId);
    const recibosFinales = conSaldo.length ? await tx.reciboSueldo.findMany({
      where: { empleadoId: { in: conSaldo }, liquidacion: { tipo: 'FINAL', estado: 'CERRADA', fechaPago: { gte: new Date(Date.UTC(anio + 1, 0, 1)), lt: new Date(Date.UTC(anio + 2, 0, 1)) } } },
      select: { empleadoId: true, renglones: { where: { anioAjusteGanancias: anio }, select: { id: true } } },
    }) : [];
    const sinAjuste = new Set(recibosFinales.filter((r) => !r.renglones.length).map((r) => r.empleadoId));
    return {
      anio, estado: l.estado, cerradoEn: l.cerradoEn,
      empleados: filas.map((x) => {
        const e = emps.get(x.empleadoId)!;
        return { empleadoId: x.empleadoId, legajo: e.legajo, apellido: e.apellido, nombre: e.nombre, distracto: x.distracto, hoja: x.hoja, impuesto: f(x.impuesto), retenido: f(x.retenido), pagosACuenta: f(x.pagosACuenta), saldo: f(x.saldo),
          aviso: !x.distracto && sinAjuste.has(x.empleadoId) ? 'Su final ya está cerrada: el saldo se retiene o devuelve fuera del sistema' : null };
      }).sort((p, q) => p.legajo - q.legajo),
    };
  }

  calcular(anio: number) {
    if (!Number.isInteger(anio) || anio >= hoy().getUTCFullYear()) throw new BadRequestException('Solo se liquida un año terminado');
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const previo = await this.encabezado(tx, anio);
      if (previo?.estado === 'CERRADA') throw new BadRequestException(`La liquidación anual de ${anio} está cerrada`);
      // upsert: sin fila de ConfiguracionSueldos el lock no serializa y dos primeros 'calcular' no chocan (E34)
      const l = previo ?? (await tx.liquidacionAnualGanancias.upsert({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio } }, update: {}, create: { empresaId: this.tenant.empresaId, anio } }));
      await this.recalcular(tx, l.id, anio);
      return this.ver(anio, tx);
    }, { timeout: 60000 });
  }

  /** Rearma las filas no distracto con los datos al día (lo usan calcular y cerrar, revisión E32). */
  private async recalcular(tx: TxEmpresa, anualId: string, anio: number) {
    const l = { id: anualId };
    {
      await tx.liquidacionAnualGananciasEmpleado.deleteMany({ where: { anualId: l.id, distracto: false } });
      const recibos = await tx.reciboSueldo.findMany({ where: { liquidacion: { estado: 'CERRADA', fechaPago: { gte: new Date(Date.UTC(anio, 0, 1)), lte: new Date(Date.UTC(anio, 11, 31)) } } }, select: { empleadoId: true }, distinct: ['empleadoId'] });
      // Los egresados del año van en su final y no entran. De los egresados de enero a marzo siguientes, solo quedan afuera los que ya
      // tienen su distracto (final cerrada de enero a marzo); el resto entra y su ajuste va en la final (E33)
      const distractos = new Set((await tx.liquidacionAnualGananciasEmpleado.findMany({ where: { anualId: l.id, distracto: true }, select: { empleadoId: true } })).map((x) => x.empleadoId));
      const empleados = await tx.empleado.findMany({ where: { id: { in: recibos.map((r) => r.empleadoId) }, OR: [{ fechaEgreso: null }, { fechaEgreso: { lt: new Date(Date.UTC(anio, 0, 1)) } }, { fechaEgreso: { gt: new Date(Date.UTC(anio, 11, 31)) } }] } });
      for (const e of empleados.filter((x) => !distractos.has(x.id))) {
        let r: AnualEmpleado;
        try { r = await this.anualDeEmpleado(tx, e.id, anio); } catch (err) { if (err instanceof SinTablaGanancias) throw new BadRequestException(err.message); throw err; }
        await tx.liquidacionAnualGananciasEmpleado.create({ data: {
          empresaId: this.tenant.empresaId, anualId: l.id, empleadoId: e.id, hoja: r.hoja as unknown as Prisma.InputJsonValue, f1359: r.f1359 as unknown as Prisma.InputJsonValue,
          impuesto: r.impuesto, retenido: r.retenido, pagosACuenta: r.pagosACuenta, saldo: r.saldo,
        } });
      }
    }
  }

  cerrar(anio: number) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const l = await this.encabezado(tx, anio);
      if (!l) throw new BadRequestException(`Calcule la liquidación anual de ${anio}`);
      if (l.estado === 'CERRADA') throw new BadRequestException(`La liquidación anual de ${anio} ya está cerrada`);
      // ARCA acepta la anual original desde el 1/4 y para entonces se conocen los egresos de enero a marzo (distracto)
      if (hoy() < new Date(Date.UTC(anio + 1, 3, 1))) throw new BadRequestException(`La liquidación anual se cierra desde el 1/4/${anio + 1}, cuando ya se conocen los egresos de enero a marzo (que van en el distracto)`);
      // Revisión E33: una final de un egreso de enero a marzo, sin cerrar y con pago anterior a hoy, decide si el empleado va en el
      // distracto o en la anual; cerrar la anual antes perdería su ajuste (la final ya no lo aplicaría)
      const pendiente = await tx.liquidacion.findFirst({ where: { tipo: 'FINAL', estado: 'BORRADOR', fechaPago: { lt: hoy() }, egreso: { fechaEgreso: { gte: new Date(Date.UTC(anio + 1, 0, 1)), lte: new Date(Date.UTC(anio + 1, 2, 31)) } } } });
      if (pendiente) throw new BadRequestException(`Cierre primero las liquidaciones finales pendientes de los egresos de enero a marzo de ${anio + 1}`);
      // Se cierra lo que dan los datos de hoy, no la última vista previa (egresos, liquidaciones o F.572 que cambiaron después)
      await this.recalcular(tx, l.id, anio);
      await tx.liquidacionAnualGanancias.update({ where: { id: l.id }, data: { estado: 'CERRADA', cerradoEn: new Date(), cerradoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId } });
      return this.ver(anio, tx);
    }, { timeout: 60000 });
  }

  reabrir(anio: number) {
    return this.tenant.transaccion(async (tx) => {
      await this.bloquear(tx);
      const l = await this.encabezado(tx, anio);
      if (!l || l.estado !== 'CERRADA') throw new BadRequestException(`La liquidación anual de ${anio} no está cerrada`);
      // Los 561 de las finales con distracto liquidan la anual del empleado en su final, no el ajuste de la anual cerrada
      const finales = (await tx.liquidacionAnualGananciasEmpleado.findMany({ where: { anualId: l.id, distracto: true, liquidacionFinalId: { not: null } }, select: { liquidacionFinalId: true } })).map((x) => x.liquidacionFinalId!);
      const aplicado = await tx.reciboSueldoRenglon.findFirst({ where: { anioAjusteGanancias: anio, recibo: { liquidacionId: { notIn: finales }, liquidacion: { estado: 'CERRADA' } } } });
      if (aplicado) throw new BadRequestException('El ajuste anual ya se aplicó en una liquidación cerrada: no se puede reabrir');
      await tx.liquidacionAnualGanancias.update({ where: { id: l.id }, data: { estado: 'BORRADOR', cerradoEn: null, cerradoPor: null } });
      return this.ver(anio, tx);
    });
  }
}
