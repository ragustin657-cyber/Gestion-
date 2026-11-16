import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';

const DIA = 86400000;

export interface DatosTarjeta { nombre: string; tipo: 'CREDITO' | 'DEBITO' | 'QR'; cuentaBancariaId: string; cuentaContableId?: string | null; activa?: boolean }

/** Tarjetas, cupones y liquidaciones (spec E23). */
@Injectable()
export class TarjetasService {
  constructor(private readonly tenant: TenantPrisma, private readonly config: ConfigComprasService, private readonly alcance: AlcanceSucursalService) {}

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
}
