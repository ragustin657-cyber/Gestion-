import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { anularMovimientos, hoy, registrarMovimiento } from './tesoreria-comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';

const DIA = 86400000;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const aFecha = (f: string) => new Date(`${f}T00:00:00Z`);
const pesos = (d: Dec) => `$ ${Number(d).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ORIGEN_LIQUIDACION_TARJETA = 'LIQUIDACION_TARJETA';
export interface ImpuestoLiquidacion { clase: 'RETENCION' | 'PERCEPCION'; tipo: 'IVA' | 'GANANCIAS' | 'IIBB'; jurisdiccion?: string | null; importe: number }
export interface DatosLiquidacion {
  tarjetaId: string; fecha: string; referencia?: string | null; cuponIds: string[]; arancel: number; ivaArancel: number; costoFinanciero?: number; ivaCostoFinanciero?: number;
  impuestos: ImpuestoLiquidacion[]; neto: number; cuentaBancariaId?: string | null;
}
const CONCEPTO_IMPUESTO: Record<string, 'RETENCION_SUFRIDA_IVA' | 'RETENCION_SUFRIDA_GANANCIAS' | 'RETENCION_SUFRIDA_IIBB' | 'PERCEPCION_IVA' | 'PERCEPCION_IIBB'> = {
  'RETENCION.IVA': 'RETENCION_SUFRIDA_IVA', 'RETENCION.GANANCIAS': 'RETENCION_SUFRIDA_GANANCIAS', 'RETENCION.IIBB': 'RETENCION_SUFRIDA_IIBB', 'PERCEPCION.IVA': 'PERCEPCION_IVA', 'PERCEPCION.IIBB': 'PERCEPCION_IIBB',
};

export interface DatosTarjeta { nombre: string; tipo: 'CREDITO' | 'DEBITO' | 'QR'; cuentaBancariaId: string; cuentaContableId?: string | null; activa?: boolean }

/** Tarjetas, cupones y liquidaciones (spec E23). */
@Injectable()
export class TarjetasService {
  constructor(private readonly tenant: TenantPrisma, private readonly config: ConfigComprasService, private readonly alcance: AlcanceSucursalService,
    private readonly asientos: AsientosService, private readonly numeracion: NumeracionService, private readonly cls: ClsService) {}

  listar() {
    return this.tenant.db.tarjeta.findMany({ orderBy: { nombre: 'asc' } });
  }

  private async validar(tx: TxEmpresa, d: DatosTarjeta, id?: string) {
    const cb = await tx.cuentaBancaria.findUnique({ where: { id: d.cuentaBancariaId } });
    if (!cb) throw new BadRequestException('Cuenta bancaria inexistente');
    if (cb.monedaCodigo !== 'ARS') throw new BadRequestException('La cuenta bancaria debe ser en pesos');
    if (await tx.tarjeta.findFirst({ where: { nombre: d.nombre, id: id ? { not: id } : undefined } })) throw new BadRequestException(`Ya existe la tarjeta ${d.nombre}`);
    const cuentaContableId = d.cuentaContableId ?? (await this.config.cuenta(tx, 'TARJETAS_A_COBRAR'));
    const c = await tx.cuentaContable.findUnique({ where: { id: cuentaContableId } });
    if (!c || !c.imputable || !c.activa) throw new BadRequestException('Cuenta contable inválida: debe ser imputable y activa');
    return cuentaContableId;
  }

  crear(d: DatosTarjeta) {
    return this.tenant.transaccion(async (tx) => {
      const cuentaContableId = await this.validar(tx, d);
      return tx.tarjeta.create({ data: { empresaId: this.tenant.empresaId, nombre: d.nombre, tipo: d.tipo, cuentaBancariaId: d.cuentaBancariaId, cuentaContableId, activa: d.activa ?? true } });
    });
  }

  modificar(id: string, d: DatosTarjeta) {
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.tarjeta.findUnique({ where: { id } }))) throw new NotFoundException('Tarjeta inexistente');
      const cuentaContableId = await this.validar(tx, d, id);
      return tx.tarjeta.update({ where: { id }, data: { nombre: d.nombre, tipo: d.tipo, cuentaBancariaId: d.cuentaBancariaId, cuentaContableId, activa: d.activa ?? true } });
    });
  }

  /** Cupones con filtros y totales por tarjeta (limitado a la sucursal del usuario si tiene una). */
  async cupones(f: { tarjetaId?: string; estado?: string; desde?: string; hasta?: string }) {
    const db = this.tenant.db;
    const estado = f.estado && ['PENDIENTE', 'LIQUIDADO', 'ANULADO'].includes(f.estado) ? (f.estado as 'PENDIENTE' | 'LIQUIDADO' | 'ANULADO') : undefined;
    const cs = await db.cuponTarjeta.findMany({
      where: {
        ...(this.alcance.sucursalUsuario() ? { sucursalId: this.alcance.sucursalUsuario()! } : {}), tarjetaId: f.tarjetaId || undefined, estado,
        fecha: f.desde || f.hasta ? { gte: f.desde ? new Date(`${f.desde}T00:00:00Z`) : undefined, lte: f.hasta ? new Date(`${f.hasta}T00:00:00Z`) : undefined } : undefined,
      },
      orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
    });
    const tarjetas = new Map((await db.tarjeta.findMany()).map((t) => [t.id, t.nombre]));
    const ingresos = new Map((await db.ingresoValores.findMany({ where: { id: { in: cs.map((c) => c.ingresoId) } }, select: { id: true, terceroId: true, concepto: true } })).map((i) => [i.id, i]));
    const terceros = new Map((await db.tercero.findMany({ where: { id: { in: [...ingresos.values()].map((i) => i.terceroId).filter((x): x is string => !!x) } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
    const hoy = Date.now();
    const cupones = cs.map((c) => {
      const ing = ingresos.get(c.ingresoId);
      return {
        id: c.id, tarjetaId: c.tarjetaId, tarjeta: tarjetas.get(c.tarjetaId) ?? '', cliente: ing?.terceroId ? terceros.get(ing.terceroId) ?? '' : ing?.concepto ?? '',
        fecha: c.fecha.toISOString().slice(0, 10), lote: c.lote, numero: c.numero, cuotas: c.cuotas, importe: c.importe.toFixed(2), estado: c.estado,
        liquidacionId: c.liquidacionId, dias: Math.max(0, Math.floor((hoy - c.fecha.getTime()) / DIA)),
      };
    });
    const porTarjeta = new Map<string, { tarjetaId: string; tarjeta: string; cantidad: number; importe: number }>();
    for (const c of cupones) {
      const t = porTarjeta.get(c.tarjetaId) ?? { tarjetaId: c.tarjetaId, tarjeta: c.tarjeta, cantidad: 0, importe: 0 };
      t.cantidad++; t.importe = Math.round((t.importe + Number(c.importe)) * 100) / 100;
      porTarjeta.set(c.tarjetaId, t);
    }
    return { cupones, totales: [...porTarjeta.values()].map((t) => ({ ...t, importe: t.importe.toFixed(2) })) };
  }

  /** Liquidación de tarjeta (spec E23 §4, §9): acredita el neto y contabiliza los descuentos contra la cuenta a cobrar de cada cupón. */
  liquidar(d: DatosLiquidacion) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const tarjeta = await tx.tarjeta.findUnique({ where: { id: d.tarjetaId } });
      if (!tarjeta) throw new BadRequestException('Tarjeta inexistente');
      if (!d.cuponIds.length) throw new BadRequestException('Elija al menos un cupón');
      // Bloqueo de los cupones (ordenados) antes de validar: dos liquidaciones del mismo cupón se serializan
      await tx.$queryRawUnsafe(`SELECT id FROM "CuponTarjeta" WHERE id = ANY($1::uuid[]) AND "empresaId" = $2::uuid ORDER BY id FOR UPDATE`, [...d.cuponIds].sort(), empresaId);
      const cupones = await tx.cuponTarjeta.findMany({ where: { id: { in: d.cuponIds } } });
      if (cupones.length !== new Set(d.cuponIds).size) throw new BadRequestException('Cupón inexistente');
      const sucursal = this.alcance.sucursalUsuario();
      for (const c of cupones) {
        const nombre = c.numero ?? c.id.slice(0, 8);
        if (c.tarjetaId !== tarjeta.id) throw new BadRequestException(`El cupón ${nombre} es de otra tarjeta`);
        if (sucursal && c.sucursalId !== sucursal) throw new BadRequestException(`El cupón ${nombre} no pertenece a su sucursal`);
        if (c.estado !== 'PENDIENTE') throw new BadRequestException(`El cupón ${nombre} no está pendiente`);
      }
      const dec = (n: number | undefined) => new D(n ?? 0).toDecimalPlaces(2);
      const arancel = dec(d.arancel), ivaArancel = dec(d.ivaArancel), costo = dec(d.costoFinanciero), ivaCosto = dec(d.ivaCostoFinanciero), neto = dec(d.neto);
      const impuestos = d.impuestos.map((i) => ({ ...i, importe: dec(i.importe) }));
      for (const i of impuestos) {
        if (i.clase === 'PERCEPCION' && i.tipo === 'GANANCIAS') throw new BadRequestException('Las percepciones son de IVA o IIBB');
        if (i.tipo === 'IIBB' && !i.jurisdiccion) throw new BadRequestException('Indique la jurisdicción de IIBB');
      }
      if ([arancel, ivaArancel, costo, ivaCosto, ...impuestos.map((i) => i.importe)].some((x) => x.lt(0))) throw new BadRequestException('Los importes no pueden ser negativos');
      if (neto.lte(0)) throw new BadRequestException('El neto debe ser mayor que cero');
      const bruto = cupones.reduce((t, c) => t.plus(c.importe), new D(0));
      const totalImpuestos = impuestos.reduce((t, i) => t.plus(i.importe), new D(0));
      const diferencia = bruto.minus(arancel).minus(ivaArancel).minus(costo).minus(ivaCosto).minus(totalImpuestos).minus(neto);
      if (!diferencia.isZero()) throw new BadRequestException(`La liquidación no cierra: diferencia ${pesos(diferencia.abs())}`);
      const cuentaBancaria = await tx.cuentaBancaria.findUnique({ where: { id: d.cuentaBancariaId ?? tarjeta.cuentaBancariaId } });
      if (!cuentaBancaria || cuentaBancaria.monedaCodigo !== 'ARS') throw new BadRequestException('La cuenta bancaria debe ser en pesos');
      const fecha = aFecha(d.fecha);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const liq = await tx.liquidacionTarjeta.create({ data: {
        empresaId, numero: await this.numeracion.siguiente(tx, 'LIQUIDACION_TARJETA', 0), tarjetaId: tarjeta.id, fecha, referencia: d.referencia ?? null,
        bruto, arancel, ivaArancel, costoFinanciero: costo, ivaCostoFinanciero: ivaCosto, neto, cuentaBancariaId: cuentaBancaria.id, creadoPor: usuario,
        impuestos: { create: impuestos.map((i) => ({ empresaId, clase: i.clase, tipo: i.tipo, jurisdiccion: i.jurisdiccion ?? null, importe: i.importe })) },
      } });
      await tx.cuponTarjeta.updateMany({ where: { id: { in: d.cuponIds } }, data: { estado: 'LIQUIDADO', liquidacionId: liq.id } });
      await registrarMovimiento(tx, empresaId, { fecha, tipo: 'INGRESO', cuentaBancariaId: cuentaBancaria.id, monedaCodigo: 'ARS', importe: neto, origenTipo: ORIGEN_LIQUIDACION_TARJETA, origenId: liq.id });
      const renglones: RenglonAsiento[] = [{ cuentaContableId: cuentaBancaria.cuentaContableId, debe: neto.toFixed(2) }];
      const debe = (cuentaContableId: string, importe: Dec, detalle?: string) => { if (importe.gt(0)) renglones.push({ cuentaContableId, debe: importe.toFixed(2), detalle }); };
      debe(await this.config.cuenta(tx, 'COMISIONES_TARJETA'), arancel.plus(costo));
      debe(await this.config.cuenta(tx, 'IVA_CREDITO_FISCAL'), ivaArancel.plus(ivaCosto));
      for (const i of impuestos) debe(await this.config.cuenta(tx, CONCEPTO_IMPUESTO[`${i.clase}.${i.tipo}`]), i.importe, `${i.clase === 'RETENCION' ? 'Retención' : 'Percepción'} ${i.tipo}${i.jurisdiccion ? ` ${i.jurisdiccion}` : ''}`);
      // Haber: la cuenta a cobrar copiada en cada cupón
      const porCuenta = new Map<string, Dec>();
      for (const c of cupones) porCuenta.set(c.cuentaContableId, (porCuenta.get(c.cuentaContableId) ?? new D(0)).plus(c.importe));
      for (const [cuentaContableId, importe] of porCuenta) renglones.push({ cuentaContableId, haber: importe.toFixed(2) });
      const a = await this.asientos.generar(tx, { fecha, descripcion: `Liquidación de ${tarjeta.nombre} N° ${liq.numero}${d.referencia ? ` - ${d.referencia}` : ''}`, origenTipo: ORIGEN_LIQUIDACION_TARJETA, origenId: liq.id, renglones });
      await tx.liquidacionTarjeta.update({ where: { id: liq.id }, data: { asientoId: a.id } });
      return this.obtenerLiquidacion(liq.id, tx);
    });
  }

  anularLiquidacion(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "LiquidacionTarjeta" WHERE id = $1::uuid AND "empresaId" = $2::uuid FOR UPDATE`, id, this.tenant.empresaId);
      const l = await tx.liquidacionTarjeta.findUnique({ where: { id } });
      if (!l) throw new NotFoundException('Liquidación inexistente');
      if (l.estado === 'ANULADO') throw new BadRequestException('La liquidación ya está anulada');
      if (await tx.movimientoTesoreria.count({ where: { origenTipo: ORIGEN_LIQUIDACION_TARJETA, origenId: id, vinculoId: { not: null } } }))
        throw new BadRequestException('El movimiento bancario está conciliado: deshaga la conciliación antes de anular');
      const f = hoy();
      const fecha = f < l.fecha ? l.fecha : f;
      const contra = l.asientoId ? await this.asientos.contraasiento(tx, l.asientoId, fecha, `Anulación de la liquidación de tarjeta N° ${l.numero} - ${motivo}`) : null;
      await anularMovimientos(tx, ORIGEN_LIQUIDACION_TARJETA, id);
      await tx.cuponTarjeta.updateMany({ where: { liquidacionId: id }, data: { estado: 'PENDIENTE', liquidacionId: null } });
      await tx.liquidacionTarjeta.update({ where: { id }, data: { estado: 'ANULADO', asientoAnulacionId: contra?.id ?? null, motivoAnulacion: motivo } });
      return this.obtenerLiquidacion(id, tx);
    });
  }

  async obtenerLiquidacion(id: string, tx: TxEmpresa = this.tenant.db) {
    const l = await tx.liquidacionTarjeta.findUnique({ where: { id }, include: { impuestos: true } });
    if (!l) throw new NotFoundException('Liquidación inexistente');
    const cupones = await tx.cuponTarjeta.findMany({ where: { OR: [{ liquidacionId: id }] }, orderBy: { fecha: 'asc' } });
    const tarjeta = await tx.tarjeta.findUnique({ where: { id: l.tarjetaId } });
    const f = (x: Dec) => x.toFixed(2);
    return {
      ...l, fecha: l.fecha.toISOString().slice(0, 10), tarjeta: tarjeta?.nombre ?? '', bruto: f(l.bruto), arancel: f(l.arancel), ivaArancel: f(l.ivaArancel),
      costoFinanciero: f(l.costoFinanciero), ivaCostoFinanciero: f(l.ivaCostoFinanciero), neto: f(l.neto),
      impuestos: l.impuestos.map((i) => ({ ...i, importe: f(i.importe) })),
      cupones: cupones.map((c) => ({ id: c.id, fecha: c.fecha.toISOString().slice(0, 10), lote: c.lote, numero: c.numero, cuotas: c.cuotas, importe: f(c.importe) })),
    };
  }

  async liquidaciones(q: { tarjetaId?: string; desde?: string; hasta?: string }) {
    const ls = await this.tenant.db.liquidacionTarjeta.findMany({
      where: { tarjetaId: q.tarjetaId || undefined, fecha: q.desde || q.hasta ? { gte: q.desde ? aFecha(q.desde) : undefined, lte: q.hasta ? aFecha(q.hasta) : undefined } : undefined },
      orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
    });
    const tarjetas = new Map((await this.tenant.db.tarjeta.findMany()).map((t) => [t.id, t.nombre]));
    return ls.map((l) => ({ id: l.id, numero: l.numero, fecha: l.fecha.toISOString().slice(0, 10), tarjeta: tarjetas.get(l.tarjetaId) ?? '', bruto: l.bruto.toFixed(2), neto: l.neto.toFixed(2), estado: l.estado, referencia: l.referencia }));
  }

  /** Costo de cobrar con cada tarjeta en el período (spec §5). */
  async costo(desde: string, hasta: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta ?? '')) throw new BadRequestException('Indique el período (desde y hasta)');
    const ls = await this.tenant.db.liquidacionTarjeta.findMany({ where: { estado: 'CONFIRMADO', fecha: { gte: aFecha(desde), lte: aFecha(hasta) } }, include: { impuestos: true } });
    const tarjetas = new Map((await this.tenant.db.tarjeta.findMany()).map((t) => [t.id, t.nombre]));
    const por = new Map<string, { bruto: Dec; comisiones: Dec; iva: Dec; impuestos: Dec; neto: Dec }>();
    for (const l of ls) {
      const t = por.get(l.tarjetaId) ?? { bruto: new D(0), comisiones: new D(0), iva: new D(0), impuestos: new D(0), neto: new D(0) };
      t.bruto = t.bruto.plus(l.bruto); t.comisiones = t.comisiones.plus(l.arancel).plus(l.costoFinanciero); t.iva = t.iva.plus(l.ivaArancel).plus(l.ivaCostoFinanciero);
      t.impuestos = t.impuestos.plus(l.impuestos.reduce((s2, i) => s2.plus(i.importe), new D(0))); t.neto = t.neto.plus(l.neto);
      por.set(l.tarjetaId, t);
    }
    const pct = (a: Dec, b: Dec) => (b.isZero() ? '0.00' : a.div(b).times(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
    return [...por.entries()].map(([id, t]) => ({
      tarjetaId: id, tarjeta: tarjetas.get(id) ?? '', bruto: t.bruto.toFixed(2), comisiones: t.comisiones.toFixed(2), iva: t.iva.toFixed(2), impuestos: t.impuestos.toFixed(2), neto: t.neto.toFixed(2),
      costoPct: pct(t.comisiones, t.bruto), descuentoTotalPct: pct(t.bruto.minus(t.neto), t.bruto),
    })).sort((a, b) => a.tarjeta.localeCompare(b.tarjeta));
  }
}
