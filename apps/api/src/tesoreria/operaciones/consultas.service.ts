import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoCheque, Prisma } from '@prisma/client';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { paginacion } from '../../comun/paginado';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { D, Dec, hoy, saldoBanco, saldoCaja } from './tesoreria-comun';

const ESTADOS = Object.values(EstadoCheque) as string[];

export const DESCRIPCIONES: Record<string, string> = {
  INGRESO: 'Ingreso de valores',
  TRASLADO: 'Traslado enviado',
  RECEPCION_TRASLADO: 'Recepción de traslado',
  DEPOSITO: 'Depósito',
  ACREDITACION_TRANSFERENCIA: 'Acreditación de transferencia',
  RECHAZO_CHEQUE: 'Cheque rechazado',
  OP: 'Orden de pago',
  DEBITO_CHEQUE: 'Débito de cheque propio',
  MOVIMIENTO_BANCARIO: 'Movimiento bancario',
  TRANSFERENCIA_INTERNA: 'Transferencia interna',
  MOVIMIENTO_CAJA: 'Movimiento de caja',
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Lunes de la semana de la fecha. */
function lunes(d: Date): string {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return iso(x);
}

export interface FiltroCheques {
  estado?: string;
  sucursalId?: string;
  cajaId?: string;
  desde?: string;
  hasta?: string;
  librador?: string;
  pagina?: string;
  porPagina?: string;
}

@Injectable()
export class ConsultasTesoreriaService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
  ) {}

  /** Filtro de visibilidad de cheques: la sucursal donde está el cheque ahora. */
  async visibilidadCheques(_tx: TxEmpresa = this.tenant.db): Promise<Prisma.ChequeTerceroWhereInput> {
    const s = this.alcance.sucursalUsuario();
    return s ? { sucursalId: s } : {};
  }

  private async vistaCheques<T extends { cajaId: string | null; cuentaBancariaId: string | null; terceroOrigenId: string | null; terceroDestinoId: string | null }>(filas: T[]) {
    const db = this.tenant.db;
    const cajas = await db.caja.findMany({ where: { id: { in: filas.map((f) => f.cajaId!).filter(Boolean) } }, include: { sucursal: true } });
    const cuentas = await db.cuentaBancaria.findMany({ where: { id: { in: filas.map((f) => f.cuentaBancariaId!).filter(Boolean) } }, include: { banco: true } });
    const terceros = await db.tercero.findMany({
      where: { id: { in: filas.flatMap((f) => [f.terceroOrigenId, f.terceroDestinoId]).filter((x): x is string => !!x) } },
      select: { id: true, razonSocial: true },
    });
    return filas.map((f) => {
      const caja = cajas.find((c) => c.id === f.cajaId);
      const cuenta = cuentas.find((c) => c.id === f.cuentaBancariaId);
      return {
        ...f,
        caja: caja ? { id: caja.id, nombre: caja.nombre, sucursal: caja.sucursal.nombre } : null,
        cuentaBancaria: cuenta ? { id: cuenta.id, numero: cuenta.numero, banco: cuenta.banco.nombre, monedaCodigo: cuenta.monedaCodigo } : null,
        terceroOrigen: terceros.find((t) => t.id === f.terceroOrigenId) ?? null,
        terceroDestino: terceros.find((t) => t.id === f.terceroDestinoId) ?? null,
      };
    });
  }

  async cheques(q: FiltroCheques) {
    const db = this.tenant.db;
    if (q.estado && !q.estado.split(',').every((e) => ESTADOS.includes(e))) throw new BadRequestException('Estado inválido');
    const and: Prisma.ChequeTerceroWhereInput[] = [await this.visibilidadCheques()];
    if (q.estado) and.push({ estado: { in: q.estado.split(',') as EstadoCheque[] } });
    if (q.sucursalId) and.push({ sucursalId: q.sucursalId });
    if (q.cajaId) and.push({ cajaId: q.cajaId });
    const desde = fechaQuery(q.desde);
    const hasta = fechaQuery(q.hasta);
    if (desde || hasta) and.push({ fechaPago: { gte: desde, lte: hasta } });
    if (q.librador) and.push({ OR: [{ libradorNombre: { contains: q.librador, mode: 'insensitive' } }, { libradorCuit: { contains: q.librador.replace(/\D/g, '') || q.librador } }] });
    const where: Prisma.ChequeTerceroWhereInput = { AND: and };
    const [filas, total, todos] = await Promise.all([
      db.chequeTercero.findMany({ where, orderBy: [{ fechaPago: 'asc' }, { numero: 'asc' }], ...paginacion(q) }),
      db.chequeTercero.count({ where }),
      db.chequeTercero.findMany({ where, select: { fechaPago: true, monedaCodigo: true, importe: true } }),
    ]);
    const totales = new Map<string, Dec>();
    const semanas = new Map<string, { semana: string; monedaCodigo: string; importe: Dec }>();
    for (const c of todos) {
      totales.set(c.monedaCodigo, (totales.get(c.monedaCodigo) ?? new D(0)).plus(c.importe));
      const k = `${lunes(c.fechaPago)}|${c.monedaCodigo}`;
      const s = semanas.get(k) ?? { semana: lunes(c.fechaPago), monedaCodigo: c.monedaCodigo, importe: new D(0) };
      semanas.set(k, { ...s, importe: s.importe.plus(c.importe) });
    }
    return {
      items: await this.vistaCheques(filas),
      total,
      totales: [...totales].sort(([a], [b]) => a.localeCompare(b)).map(([monedaCodigo, importe]) => ({ monedaCodigo, importe: importe.toString() })),
      porSemana: [...semanas.values()]
        .sort((a, b) => a.semana.localeCompare(b.semana) || a.monedaCodigo.localeCompare(b.monedaCodigo))
        .map((s) => ({ ...s, importe: s.importe.toString() })),
    };
  }

  async cheque(id: string) {
    const db = this.tenant.db;
    const c = await db.chequeTercero.findFirst({ where: { AND: [{ id }, await this.visibilidadCheques()] }, include: { historial: { orderBy: { creadoEn: 'asc' } } } });
    if (!c) throw new NotFoundException('Cheque no encontrado');
    const { historial, ...cheque } = c;
    const cajas = await db.caja.findMany({ where: { id: { in: historial.map((h) => h.cajaId!).filter(Boolean) } } });
    const cuentas = await db.cuentaBancaria.findMany({ where: { id: { in: historial.map((h) => h.cuentaBancariaId!).filter(Boolean) } }, include: { banco: true } });
    const usuarios = await db.usuario.findMany({ where: { id: { in: historial.map((h) => h.usuarioId) } }, select: { id: true, nombre: true } });
    const [vista] = await this.vistaCheques([cheque]);
    return {
      ...vista,
      historial: historial.map((h) => {
        const cb = cuentas.find((x) => x.id === h.cuentaBancariaId);
        return {
          ...h,
          caja: cajas.find((x) => x.id === h.cajaId)?.nombre ?? null,
          cuentaBancaria: cb ? `${cb.banco.nombre} - ${cb.numero}` : null,
          usuario: usuarios.find((u) => u.id === h.usuarioId)?.nombre ?? null,
        };
      }),
    };
  }

  /** Saldos de bancos y cajas a una fecha (hoy por defecto). Los usuarios de sucursal no ven bancos. */
  async saldos(fecha?: string) {
    const db = this.tenant.db;
    const corte = fechaQuery(fecha) ?? hoy();
    const conBancos = !this.alcance.sucursalUsuario();
    const cuentas = conBancos ? await db.cuentaBancaria.findMany({ where: { activa: true }, include: { banco: true }, orderBy: { numero: 'asc' } }) : [];
    const cajas = await db.caja.findMany({ where: { activa: true, ...this.alcance.filtroCajas() }, include: { sucursal: true }, orderBy: { nombre: 'asc' } });
    const cheques = await db.chequeTercero.groupBy({ by: ['cajaId'], where: { estado: 'EN_CARTERA', cajaId: { in: cajas.map((c) => c.id) } }, _sum: { importe: true } });
    return {
      fecha: iso(corte),
      bancos: await Promise.all(cuentas.map(async (c) => ({
        id: c.id, nombre: `${c.banco.nombre} - ${c.numero}`, monedaCodigo: c.monedaCodigo, saldo: (await saldoBanco(db, c.id, corte)).toString(),
      }))),
      cajas: await Promise.all(cajas.map(async (c) => ({
        id: c.id, nombre: c.nombre, sucursal: c.sucursal.nombre, monedaCodigo: c.monedaCodigo,
        efectivo: (await saldoCaja(db, c.id, corte)).toString(),
        cheques: (cheques.find((x) => x.cajaId === c.id)?._sum.importe ?? new D(0)).toString(),
      }))),
    };
  }

  /** Movimientos de una cuenta bancaria o una caja entre fechas, con saldo inicial y acumulado. */
  async movimientos(q: { cuentaBancariaId?: string; cajaId?: string; desde?: string; hasta?: string }) {
    const db = this.tenant.db;
    const desde = fechaQuery(q.desde);
    const hasta = fechaQuery(q.hasta);
    if (!!q.cuentaBancariaId === !!q.cajaId) throw new BadRequestException('Indique una cuenta bancaria o una caja');
    let where: Prisma.MovimientoTesoreriaWhereInput;
    if (q.cuentaBancariaId) {
      const c = this.alcance.sucursalUsuario() ? null : await db.cuentaBancaria.findFirst({ where: { id: q.cuentaBancariaId } });
      if (!c) throw new NotFoundException('Cuenta bancaria no encontrada');
      where = { cuentaBancariaId: c.id };
    } else {
      const c = await db.caja.findFirst({ where: { id: q.cajaId, ...this.alcance.filtroCajas() } });
      if (!c) throw new NotFoundException('Caja no encontrada');
      where = { cajaId: c.id };
    }
    const signo = (tipo: string, importe: Dec) => (tipo === 'INGRESO' ? importe : importe.neg());
    const previos = desde ? await db.movimientoTesoreria.findMany({ where: { ...where, anulado: false, fecha: { lt: desde } }, select: { tipo: true, importe: true } }) : [];
    const saldoInicial = previos.reduce((s, m) => s.plus(signo(m.tipo, m.importe)), new D(0));
    const filas = await db.movimientoTesoreria.findMany({
      where: { ...where, anulado: false, fecha: { gte: desde, lte: hasta } }, orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
    });
    let saldo = saldoInicial;
    const movimientos = filas.map((m) => {
      saldo = saldo.plus(signo(m.tipo, m.importe));
      return {
        id: m.id, fecha: iso(m.fecha), tipo: m.tipo, origenTipo: m.origenTipo, origenId: m.origenId,
        descripcion: DESCRIPCIONES[m.origenTipo] ?? m.origenTipo, monedaCodigo: m.monedaCodigo, importe: m.importe.toString(), saldo: saldo.toString(),
      };
    });
    return { saldoInicial: saldoInicial.toString(), movimientos, saldoFinal: saldo.toString() };
  }

}
