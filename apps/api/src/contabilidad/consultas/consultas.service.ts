import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { paginacion } from '../../comun/paginado';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { arbolSaldos, D, ejercicioDelRango, esDescendiente, saldosPorCuenta } from './saldos';

const hoy = () => new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
const INCLUIR = { renglones: true } satisfies Prisma.AsientoInclude;

/** Pantalla del comprobante que originó el asiento, si la hay. */
export function rutaOrigen(origenTipo: string, origenId: string, asientoId: string): string | null {
  switch (origenTipo) {
    case 'COMPRA': return `/compras/comprobantes?id=${origenId}`;
    case 'PAGO': case 'OP': return `/pagos/op/${origenId}`;
    case 'INGRESO_VALORES': return '/tesoreria/ingreso';
    case 'DEPOSITO': return '/tesoreria/deposito';
    case 'MOVIMIENTO_BANCARIO': return '/tesoreria/movimientos-bancarios';
    case 'MANUAL': return `/contabilidad/asientos/${asientoId}`;
    case 'VENTA': return `/ventas/comprobantes?id=${origenId}`;
    case 'RECIBO': return `/ventas/recibos?id=${origenId}`;
    case 'APLICACION_COBRO': return `/ventas/aplicaciones?id=${origenId}`;
    default: return null;
  }
}

@Injectable()
export class ConsultasContablesService {
  constructor(private readonly tenant: TenantPrisma) {}

  private async vista(tx: TxEmpresa, asientos: Prisma.AsientoGetPayload<{ include: typeof INCLUIR }>[]) {
    const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: [...new Set(asientos.flatMap((a) => a.renglones.map((r) => r.cuentaContableId)))] } } });
    const ccs = await tx.centroCosto.findMany({ where: { id: { in: asientos.flatMap((a) => a.renglones.map((r) => r.centroCostoId!)).filter(Boolean) } } });
    return asientos.map((a) => ({
      id: a.id, numero: a.numero, numeroDefinitivo: a.numeroDefinitivo, fecha: a.fecha, tipo: a.tipo, descripcion: a.descripcion, anulaAId: a.anulaAId, version: a.version,
      origen: { tipo: a.origenTipo, id: a.origenId, ruta: rutaOrigen(a.origenTipo, a.origenId, a.id) },
      renglones: a.renglones
        .sort((x, y) => Number(y.debe) - Number(x.debe))
        .map((r) => {
          const c = cuentas.find((x) => x.id === r.cuentaContableId)!;
          const cc = ccs.find((x) => x.id === r.centroCostoId);
          return { cuenta: { id: c.id, codigo: c.codigo, nombre: c.nombre }, centroCosto: cc ? { id: cc.id, codigo: cc.codigo, nombre: cc.nombre } : null, debe: r.debe.toString(), haber: r.haber.toString(), detalle: r.detalle };
        }),
    }));
  }

  async diario(q: { desde?: string; hasta?: string; origenTipo?: string; pagina?: string; porPagina?: string }, todo = false) {
    const db = this.tenant.db;
    const where: Prisma.AsientoWhereInput = { fecha: { gte: fechaQuery(q.desde), lte: fechaQuery(q.hasta) }, origenTipo: q.origenTipo || undefined };
    const orden: Prisma.AsientoOrderByWithRelationInput[] = [{ fecha: 'asc' }, { numeroDefinitivo: 'asc' }, { creadoEn: 'asc' }];
    const [filas, total, sumas] = await Promise.all([
      db.asiento.findMany({ where, include: INCLUIR, orderBy: orden, ...(todo ? {} : paginacion(q)) }),
      db.asiento.count({ where }),
      db.asientoRenglon.aggregate({ where: { asiento: where }, _sum: { debe: true, haber: true } }),
    ]);
    return { items: await this.vista(db, filas), total, totales: { debe: (sumas._sum.debe ?? new D(0)).toString(), haber: (sumas._sum.haber ?? new D(0)).toString() } };
  }

  async asiento(id: string) {
    const db = this.tenant.db;
    const a = await db.asiento.findUnique({ where: { id }, include: INCLUIR });
    if (!a) throw new NotFoundException('Asiento no encontrado');
    const [v] = await this.vista(db, [a]);
    const anulacion = await db.asiento.findFirst({ where: { anulaAId: id }, select: { id: true, numero: true, numeroDefinitivo: true } });
    return { ...v, anuladoPor: anulacion };
  }

  async mayor(q: { cuentaContableId?: string; desde?: string; hasta?: string; centroCostoId?: string }) {
    const db = this.tenant.db;
    if (!q.cuentaContableId) throw new BadRequestException('Indique la cuenta');
    const cuenta = await db.cuentaContable.findUnique({ where: { id: q.cuentaContableId } });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');
    const desde = fechaQuery(q.desde);
    const hasta = fechaQuery(q.hasta);
    const ej = await ejercicioDelRango(db, desde, hasta, hoy());
    const ids = (await db.cuentaContable.findMany({ select: { id: true, codigo: true } })).filter((c) => esDescendiente(c.codigo, cuenta.codigo)).map((c) => c.id);
    const base: Prisma.AsientoRenglonWhereInput = { cuentaContableId: { in: ids }, centroCostoId: q.centroCostoId || undefined };
    const inicial = desde
      ? await db.asientoRenglon.aggregate({ where: { ...base, asiento: { ejercicioId: ej.id, fecha: { lt: desde } } }, _sum: { debe: true, haber: true } })
      : null;
    const saldoInicial = inicial ? (inicial._sum.debe ?? new D(0)).minus(inicial._sum.haber ?? new D(0)) : new D(0);
    const renglones = await db.asientoRenglon.findMany({
      where: { ...base, asiento: { ejercicioId: ej.id, fecha: { gte: desde ?? ej.desde, lte: hasta ?? ej.hasta } } },
      include: { asiento: true },
      orderBy: [{ asiento: { fecha: 'asc' } }, { asiento: { numeroDefinitivo: 'asc' } }, { asiento: { creadoEn: 'asc' } }],
    });
    let saldo = saldoInicial;
    const movimientos = renglones.map((r) => {
      saldo = saldo.plus(r.debe).minus(r.haber);
      return {
        fecha: r.asiento.fecha, asientoId: r.asientoId, numero: r.asiento.numeroDefinitivo ?? r.asiento.numero, definitivo: r.asiento.numeroDefinitivo !== null,
        descripcion: r.detalle ? `${r.asiento.descripcion} · ${r.detalle}` : r.asiento.descripcion, debe: r.debe.toString(), haber: r.haber.toString(), saldo: saldo.toString(),
      };
    });
    return { cuenta: { id: cuenta.id, codigo: cuenta.codigo, nombre: cuenta.nombre }, ejercicio: { id: ej.id, numero: ej.numero }, saldoInicial: saldoInicial.toString(), movimientos, saldoFinal: saldo.toString() };
  }

  async sumasSaldos(q: { ejercicioId?: string; desde?: string; hasta?: string; nivel?: string; incluirCierre?: string }) {
    const db = this.tenant.db;
    const desde = fechaQuery(q.desde);
    const hasta = fechaQuery(q.hasta);
    const nivel = q.nivel ? Number(q.nivel) : 99;
    if (!Number.isInteger(nivel) || nivel < 1) throw new BadRequestException('Nivel inválido');
    const ej = await ejercicioDelRango(db, desde, hasta, hoy(), q.ejercicioId);
    const saldos = await saldosPorCuenta(db, { ejercicioId: ej.id, desde, hasta, excluirTipos: q.incluirCierre === 'true' ? [] : ['REFUNDICION', 'CIERRE'] });
    const cuentas = await db.cuentaContable.findMany();
    const filas = arbolSaldos(cuentas, saldos, nivel);
    const imputables = arbolSaldos(cuentas, saldos).filter((f) => f.imputable);
    const suma = (k: 'debe' | 'haber' | 'saldoDeudor' | 'saldoAcreedor') => imputables.reduce((s, f) => s.plus(f[k]), new D(0)).toString();
    return {
      ejercicio: { id: ej.id, numero: ej.numero, desde: ej.desde, hasta: ej.hasta }, desde: desde ?? ej.desde, hasta: hasta ?? ej.hasta,
      filas, totales: { debe: suma('debe'), haber: suma('haber'), saldoDeudor: suma('saldoDeudor'), saldoAcreedor: suma('saldoAcreedor') },
    };
  }

  empresa() {
    return this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
  }
}

