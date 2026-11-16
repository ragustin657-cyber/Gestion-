import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { bloquear } from '../compras/comun';
import { AsientosService } from '../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { NumeracionService } from '../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { anularMovimientos, hoy, registrarMovimiento, SALDO_INSUFICIENTE, saldoCaja } from '../tesoreria/operaciones/tesoreria-comun';
import { ContribucionesService } from './contribuciones.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);
const mmaaaa = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
const pesos = (d: Dec) => `$ ${Number(d).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ORIGEN_PAGO_SUELDOS = 'PAGO_SUELDOS';
export const ORIGEN_PAGO_CARGAS = 'PAGO_CARGAS_SOCIALES';
interface Origen { cuentaBancariaId?: string | null; cajaId?: string | null }

/** Pagos de netos de una liquidación y de cargas sociales y retenciones (spec E19 §4). */
@Injectable()
export class PagosSueldosService {
  constructor(private readonly tenant: TenantPrisma, private readonly asientos: AsientosService, private readonly numeracion: NumeracionService,
    private readonly contribuciones: ContribucionesService, private readonly cls: ClsService) {}

  private usuario() { return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId; }

  /** Cuenta contable y datos del banco o la caja de origen (en pesos). */
  private async origen(tx: TxEmpresa, o: Origen, importe: Dec, fecha: Date) {
    if (!!o.cuentaBancariaId === !!o.cajaId) throw new BadRequestException('Indique una cuenta bancaria o una caja');
    if (o.cuentaBancariaId) {
      const c = await tx.cuentaBancaria.findUnique({ where: { id: o.cuentaBancariaId } });
      if (!c || !c.activa) throw new BadRequestException('Cuenta bancaria inexistente');
      if (c.monedaCodigo !== 'ARS') throw new BadRequestException('La cuenta debe ser en pesos');
      return { cuentaContableId: c.cuentaContableId };
    }
    const c = await tx.caja.findUnique({ where: { id: o.cajaId! } });
    if (!c || !c.activa) throw new BadRequestException('Caja inexistente');
    if (c.monedaCodigo !== 'ARS') throw new BadRequestException('La caja debe ser en pesos');
    // Como el resto de Tesorería: caja bloqueada y saldo suficiente a la fecha del pago y hoy (un pago con fecha anterior no la deja en negativo)
    await bloquear(tx, 'Caja', this.tenant.empresaId, [c.id]);
    const saldo = D.min(await saldoCaja(tx, c.id, fecha), await saldoCaja(tx, c.id));
    if (importe.gt(saldo)) throw new BadRequestException(SALDO_INSUFICIENTE);
    return { cuentaContableId: c.cuentaContableId };
  }

  /** Recibos de la liquidación pagados en pagos vigentes. */
  async recibosPagados(tx: TxEmpresa, liquidacionId: string): Promise<Set<string>> {
    const rs = await tx.pagoSueldosRecibo.findMany({ where: { pago: { liquidacionId, anulado: false } }, select: { reciboId: true } });
    return new Set(rs.map((r) => r.reciboId));
  }

  async pagosDeLiquidacion(tx: TxEmpresa, liquidacionId: string) {
    const ps = await tx.pagoSueldos.findMany({ where: { liquidacionId }, include: { recibos: true }, orderBy: { numero: 'asc' } });
    const bancos = new Map((await tx.cuentaBancaria.findMany({ include: { banco: true } })).map((c) => [c.id, `${c.banco.nombre} - ${c.numero}`]));
    const cajas = new Map((await tx.caja.findMany()).map((c) => [c.id, c.nombre]));
    return ps.map((p) => ({ id: p.id, numero: p.numero, fecha: p.fecha.toISOString().slice(0, 10), cuenta: p.cuentaBancariaId ? bancos.get(p.cuentaBancariaId) ?? '' : cajas.get(p.cajaId!) ?? '', importe: p.importe.toFixed(2), anulado: p.anulado, empleados: p.recibos.length }));
  }

  pagar(liquidacionId: string, d: Origen & { fecha: string; reciboIds?: string[] }) {
    return this.tenant.transaccion(async (tx) => {
      // Serializa los pagos de una misma liquidación
      await tx.$queryRawUnsafe(`SELECT id FROM "Liquidacion" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, liquidacionId, this.tenant.empresaId);
      const l = await tx.liquidacion.findUnique({ where: { id: liquidacionId } });
      if (!l) throw new NotFoundException('Liquidación inexistente');
      if (l.estado !== 'CERRADA') throw new BadRequestException('La liquidación no está cerrada');
      if (!l.asientoId) throw new BadRequestException('La liquidación no está contabilizada');
      const pagados = await this.recibosPagados(tx, l.id);
      const todos = await tx.reciboSueldo.findMany({ where: { liquidacionId: l.id }, orderBy: { legajo: 'asc' } });
      let recibos = todos.filter((r) => !pagados.has(r.id));
      if (d.reciboIds) {
        for (const id of d.reciboIds) {
          const r = todos.find((x) => x.id === id);
          if (!r) throw new BadRequestException('Recibo inexistente en la liquidación');
          if (pagados.has(id)) throw new BadRequestException(`El recibo del legajo ${r.legajo} ya está pagado`);
        }
        recibos = todos.filter((r) => d.reciboIds!.includes(r.id));
      }
      recibos = recibos.filter((r) => new D(r.neto).gt(0));
      if (!recibos.length) throw new BadRequestException('No hay recibos pendientes de pago');
      const importe = recibos.reduce((s, r) => s.plus(r.neto), new D(0));
      const fecha = aFecha(d.fecha);
      const o = await this.origen(tx, d, importe, fecha);
      const cfg = await this.contribuciones.configuracion(tx);
      const pago = await tx.pagoSueldos.create({ data: {
        empresaId: this.tenant.empresaId, numero: await this.numeracion.siguiente(tx, 'PAGO_SUELDOS', 0), liquidacionId: l.id, fecha, cuentaBancariaId: d.cuentaBancariaId ?? null, cajaId: d.cajaId ?? null,
        importe, creadoPor: this.usuario(), recibos: { create: recibos.map((r) => ({ empresaId: this.tenant.empresaId, reciboId: r.id, importe: r.neto })) },
      } });
      await registrarMovimiento(tx, this.tenant.empresaId, { fecha, tipo: 'EGRESO', cuentaBancariaId: d.cuentaBancariaId, cajaId: d.cajaId, monedaCodigo: 'ARS', importe, origenTipo: ORIGEN_PAGO_SUELDOS, origenId: pago.id });
      const a = await this.asientos.generar(tx, {
        fecha, descripcion: await this.descripcionPago(tx, pago.numero, l), origenTipo: ORIGEN_PAGO_SUELDOS, origenId: pago.id,
        renglones: [{ cuentaContableId: cfg.cuentaSueldosAPagarId, debe: importe.toFixed(2) }, { cuentaContableId: o.cuentaContableId, haber: importe.toFixed(2) }],
      });
      await tx.pagoSueldos.update({ where: { id: pago.id }, data: { asientoId: a.id } });
      return { id: pago.id, numero: pago.numero, importe: importe.toFixed(2) };
    });
  }

  /** "Pago de sueldos N° X - MM/AAAA[ SAC]" o, para una final, "Pago de sueldos N° X - Final MM/AAAA - Apellido, Nombre". */
  private async descripcionPago(tx: TxEmpresa, numero: number, l: { id: string; tipo: string; anio: number; mes: number }) {
    if (l.tipo !== 'FINAL') return `Pago de sueldos N° ${numero} - ${mmaaaa(l.anio, l.mes)}${l.tipo === 'SAC' ? ' SAC' : ''}`;
    const r = await tx.reciboSueldo.findFirst({ where: { liquidacionId: l.id } });
    return `Pago de sueldos N° ${numero} - Final ${mmaaaa(l.anio, l.mes)}${r ? ` - ${r.apellido}, ${r.nombre}` : ''}`;
  }

  anular(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "PagoSueldos" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, id, this.tenant.empresaId);
      const p = await tx.pagoSueldos.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Pago inexistente');
      if (p.anulado) throw new BadRequestException('El pago ya está anulado');
      await anularMovimientos(tx, ORIGEN_PAGO_SUELDOS, p.id);
      if (p.asientoId) await this.asientos.contraasiento(tx, p.asientoId, hoy(), `Anulación del pago de sueldos N° ${p.numero}`);
      await tx.pagoSueldos.update({ where: { id }, data: { anulado: true } });
      return { ok: true };
    });
  }

  /** Devengado, pagado y pendiente por cuenta de deuda de las liquidaciones cerradas del mes. */
  async cargasSociales(anio: number, mes: number, tx: TxEmpresa = this.tenant.db) {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Mes inválido');
    const cfg = await this.contribuciones.configuracion(tx);
    const liqs = await tx.liquidacion.findMany({ where: { anio, mes, asientoId: { not: null } } });
    const renglones = await tx.asientoRenglon.findMany({ where: { asientoId: { in: liqs.map((l) => l.asientoId!) } } });
    const devengado = new Map<string, Dec>([[cfg.cuentaCargasSocialesId, new D(0)], [cfg.cuentaRetencionesSindicalesId, new D(0)]]);
    for (const r of renglones) {
      if (new D(r.haber).isZero() || r.cuentaContableId === cfg.cuentaSueldosAPagarId) continue;
      devengado.set(r.cuentaContableId, (devengado.get(r.cuentaContableId) ?? new D(0)).plus(r.haber).minus(r.debe));
    }
    const pagos = await tx.pagoCargasSociales.groupBy({ by: ['cuentaContableDeudaId'], where: { anio, mes, anulado: false }, _sum: { importe: true } });
    const cuentas = new Map((await tx.cuentaContable.findMany({ where: { id: { in: [...devengado.keys()] } } })).map((c) => [c.id, c]));
    const detalle = await this.detalleF931(tx, liqs.map((l) => l.id), cfg.cuentaCargasSocialesId);
    return [...devengado.entries()].map(([id, dev]) => {
      const pagado = pagos.find((p) => p.cuentaContableDeudaId === id)?._sum.importe ?? new D(0);
      return {
        cuentaContableId: id, codigo: cuentas.get(id)?.codigo ?? '', nombre: cuentas.get(id)?.nombre ?? '', devengado: dev.toFixed(2), pagado: new D(pagado).toFixed(2), pendiente: dev.minus(pagado).toFixed(2),
        ...(id === cfg.cuentaCargasSocialesId ? { detalle } : {}),
      };
    }).sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  /** Composición de Cargas sociales a pagar como la muestra el F.931. */
  private async detalleF931(tx: TxEmpresa, liquidacionIds: string[], cuentaCargas: string) {
    const recibos = await tx.reciboSueldo.findMany({ where: { liquidacionId: { in: liquidacionIds } }, include: { renglones: { where: { clase: 'DESCUENTO' } }, contribuciones: true } });
    const conceptos = new Map((await tx.concepto.findMany()).map((c) => [c.id, c]));
    const t = { aportesSS: new D(0), aportesOS: new D(0), contribucionesSS: new D(0), contribucionesOS: new D(0), art: new D(0), scvo: new D(0) };
    for (const r of recibos) {
      for (const x of r.renglones) {
        const c = x.conceptoId ? conceptos.get(x.conceptoId) : undefined;
        if (c?.destino === 'SEGURIDAD_SOCIAL' && (c.cuentaContableId ?? cuentaCargas) === cuentaCargas) t.aportesSS = t.aportesSS.plus(x.importe);
        if (c?.destino === 'OBRA_SOCIAL' && (c.cuentaContableId ?? cuentaCargas) === cuentaCargas) t.aportesOS = t.aportesOS.plus(x.importe);
      }
      for (const c of r.contribuciones.filter((y) => y.cuentaContableId === cuentaCargas)) {
        const k = c.destino === 'SEGURIDAD_SOCIAL' ? 'contribucionesSS' : c.destino === 'OBRA_SOCIAL' ? 'contribucionesOS' : c.destino === 'ART' ? 'art' : 'scvo';
        t[k] = t[k].plus(c.importe);
      }
    }
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toFixed(2)]));
  }

  pagarCargas(d: Origen & { anio: number; mes: number; cuentaContableDeudaId: string; importe: number; fecha: string; detalle?: string | null }) {
    return this.tenant.transaccion(async (tx) => {
      // Mismo orden que reabrir (liquidación y después configuración) para no trabarse entre sí
      const delMes = (await tx.liquidacion.findMany({ where: { anio: d.anio, mes: d.mes }, select: { id: true } })).map((x) => x.id).sort();
      if (delMes.length) await tx.$queryRawUnsafe(`SELECT id FROM "Liquidacion" WHERE id = ANY($1::uuid[]) AND "empresaId" = $2::uuid ORDER BY id FOR UPDATE`, delMes, this.tenant.empresaId);
      await tx.$queryRawUnsafe(`SELECT id FROM "ConfiguracionSueldos" WHERE "empresaId" = $1::uuid FOR UPDATE`, this.tenant.empresaId);
      const fila = (await this.cargasSociales(d.anio, d.mes, tx)).find((f) => f.cuentaContableId === d.cuentaContableDeudaId);
      if (!fila) throw new BadRequestException('La cuenta no es una deuda de sueldos del período');
      const importe = new D(d.importe).toDecimalPlaces(2);
      if (importe.lte(0)) throw new BadRequestException('El importe debe ser mayor que cero');
      if (importe.gt(fila.pendiente)) throw new BadRequestException(`El importe supera lo pendiente (pendiente ${pesos(new D(fila.pendiente))})`);
      const fecha = aFecha(d.fecha);
      const o = await this.origen(tx, d, importe, fecha);
      const pago = await tx.pagoCargasSociales.create({ data: {
        empresaId: this.tenant.empresaId, numero: await this.numeracion.siguiente(tx, 'PAGO_CARGAS', 0), fecha, cuentaContableDeudaId: d.cuentaContableDeudaId, anio: d.anio, mes: d.mes,
        cuentaBancariaId: d.cuentaBancariaId ?? null, cajaId: d.cajaId ?? null, importe, detalle: d.detalle ?? null, creadoPor: this.usuario(),
      } });
      await registrarMovimiento(tx, this.tenant.empresaId, { fecha, tipo: 'EGRESO', cuentaBancariaId: d.cuentaBancariaId, cajaId: d.cajaId, monedaCodigo: 'ARS', importe, origenTipo: ORIGEN_PAGO_CARGAS, origenId: pago.id });
      const a = await this.asientos.generar(tx, {
        fecha, descripcion: `Pago de ${fila.nombre} ${mmaaaa(d.anio, d.mes)} N° ${pago.numero}`, origenTipo: ORIGEN_PAGO_CARGAS, origenId: pago.id,
        renglones: [{ cuentaContableId: d.cuentaContableDeudaId, debe: importe.toFixed(2) }, { cuentaContableId: o.cuentaContableId, haber: importe.toFixed(2) }],
      });
      await tx.pagoCargasSociales.update({ where: { id: pago.id }, data: { asientoId: a.id } });
      return { id: pago.id, numero: pago.numero };
    });
  }

  async pagosCargas(anio: number, mes: number) {
    const ps = await this.tenant.db.pagoCargasSociales.findMany({ where: { anio, mes }, orderBy: { numero: 'asc' } });
    return ps.map((p) => ({ ...p, fecha: p.fecha.toISOString().slice(0, 10), importe: p.importe.toFixed(2) }));
  }

  anularCargas(id: string) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "PagoCargasSociales" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, id, this.tenant.empresaId);
      const p = await tx.pagoCargasSociales.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Pago inexistente');
      if (p.anulado) throw new BadRequestException('El pago ya está anulado');
      await anularMovimientos(tx, ORIGEN_PAGO_CARGAS, p.id);
      if (p.asientoId) await this.asientos.contraasiento(tx, p.asientoId, hoy(), `Anulación del pago de cargas sociales N° ${p.numero}`);
      await tx.pagoCargasSociales.update({ where: { id }, data: { anulado: true } });
      return { ok: true };
    });
  }

  /** Bloqueos para reabrir una liquidación (spec §3 y §9.1). */
  async validarReapertura(tx: TxEmpresa, l: { id: string; anio: number; mes: number }) {
    if (await tx.pagoSueldos.count({ where: { liquidacionId: l.id, anulado: false } })) throw new BadRequestException('La liquidación tiene pagos: anúlelos antes de reabrir');
    if (await tx.pagoCargasSociales.count({ where: { anio: l.anio, mes: l.mes, anulado: false } })) throw new BadRequestException(`Hay pagos de cargas sociales de ${mmaaaa(l.anio, l.mes)}: anúlelos antes de reabrir`);
  }
}
