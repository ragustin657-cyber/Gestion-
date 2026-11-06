import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { paginacion } from '../../comun/paginado';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { CarteraService, noDisponible } from './cartera.service';
import { DatosRecepcion, DatosTraslado } from './dto';
import { anularMovimientos, aPesos, D, hoy, MONEDA_DISTINTA, registrarMovimiento, SALDO_INSUFICIENTE, saldoCaja } from './tesoreria-comun';

const INCLUIR = { items: { orderBy: { tipo: 'asc' } } } satisfies Prisma.TrasladoInclude;

@Injectable()
export class TrasladosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly cartera: CarteraService,
    private readonly asientos: AsientosService,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  /** Traslados visibles: los que salen o llegan a una caja del alcance del usuario. */
  private async filtro(tx: TxEmpresa, sucursalId?: string): Promise<Prisma.TrasladoWhereInput> {
    const and: Prisma.TrasladoWhereInput[] = [];
    for (const s of [this.alcance.sucursalUsuario(), sucursalId]) {
      if (!s) continue;
      const cajas = (await tx.caja.findMany({ where: { sucursalId: s }, select: { id: true } })).map((c) => c.id);
      and.push({ OR: [{ cajaOrigenId: { in: cajas } }, { cajaDestinoId: { in: cajas } }] });
    }
    return { AND: and };
  }

  private async vista(tx: TxEmpresa, filas: Prisma.TrasladoGetPayload<{ include: typeof INCLUIR }>[]) {
    const cajas = await tx.caja.findMany({ where: { id: { in: filas.flatMap((f) => [f.cajaOrigenId, f.cajaDestinoId]) } }, include: { sucursal: true } });
    const cheques = await tx.chequeTercero.findMany({ where: { id: { in: filas.flatMap((f) => f.items.map((i) => i.chequeId!).filter(Boolean)) } } });
    const caja = (id: string) => {
      const c = cajas.find((x) => x.id === id)!;
      return { id: c.id, nombre: c.nombre, sucursal: c.sucursal.nombre, monedaCodigo: c.monedaCodigo };
    };
    return filas.map((f) => ({
      ...f,
      cajaOrigen: caja(f.cajaOrigenId),
      cajaDestino: caja(f.cajaDestinoId),
      items: f.items.map((i) => {
        const ch = cheques.find((c) => c.id === i.chequeId);
        return { ...i, cheque: ch ? { id: ch.id, banco: ch.banco, numero: ch.numero, libradorNombre: ch.libradorNombre, fechaPago: ch.fechaPago } : null };
      }),
    }));
  }

  async listar(q: { estado?: string; sucursalId?: string; pagina?: string; porPagina?: string }) {
    const db = this.tenant.db;
    const where = await this.filtro(db, q.sucursalId);
    if (q.estado) {
      if (!['ENVIADO', 'RECIBIDO', 'RECIBIDO_PARCIAL', 'ANULADO'].includes(q.estado)) throw new BadRequestException('Estado inválido');
      (where.AND as Prisma.TrasladoWhereInput[]).push({ estado: q.estado as 'ENVIADO' });
    }
    const [filas, total] = await Promise.all([
      db.traslado.findMany({ where, include: INCLUIR, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(q) }),
      db.traslado.count({ where }),
    ]);
    return { items: await this.vista(db, filas), total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const t = await tx.traslado.findFirst({ where: { AND: [{ id }, await this.filtro(tx)] }, include: INCLUIR });
    if (!t) throw new NotFoundException('Traslado no encontrado');
    return (await this.vista(tx, [t]))[0];
  }

  enviar(d: DatosTraslado) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const origen = await this.alcance.verificarCaja(tx, d.cajaOrigenId);
      const destino = await tx.caja.findUnique({ where: { id: d.cajaDestinoId } });
      if (!destino) throw new NotFoundException('Caja no encontrada');
      if (origen.id === destino.id) throw new BadRequestException('Las cajas de origen y destino deben ser distintas');
      if (!origen.activa || !destino.activa) throw new BadRequestException('La caja está inactiva');
      if (origen.monedaCodigo !== destino.monedaCodigo) throw new BadRequestException(MONEDA_DISTINTA);
      if (!d.cheques.length && !d.efectivo) throw new BadRequestException('Indique los valores a trasladar');
      if (new Set(d.cheques).size !== d.cheques.length) throw new BadRequestException('Hay cheques repetidos');

      await bloquear(tx, 'Caja', empresaId, [origen.id, destino.id]);
      await bloquear(tx, 'ChequeTercero', empresaId, d.cheques);
      const cheques = await tx.chequeTercero.findMany({ where: { id: { in: d.cheques } } });
      if (cheques.length !== d.cheques.length) throw new NotFoundException('Cheque no encontrado');
      for (const c of cheques) if (c.estado !== 'EN_CARTERA' || c.cajaId !== origen.id) throw noDisponible(c.numero);
      const efectivo = d.efectivo ? new D(d.efectivo.importe).toDecimalPlaces(2) : null;
      if (efectivo && efectivo.gt(await saldoCaja(tx, origen.id))) throw new BadRequestException(SALDO_INSUFICIENTE);

      const numero = await this.numeracion.siguiente(tx, 'TRA', 0);
      const traslado = await tx.traslado.create({
        data: { empresaId, numero, fecha: d.fecha, cajaOrigenId: origen.id, cajaDestinoId: destino.id, observaciones: d.observaciones ?? null, creadoPor: this.usuario() },
      });
      const mov = { tipo: 'TRASLADO', id: traslado.id, fecha: d.fecha };
      for (const c of cheques) {
        await this.cartera.cambiarEstado(tx, c.id, 'EN_TRANSITO', {}, mov, ['EN_CARTERA']);
        await tx.trasladoItem.create({ data: { empresaId, trasladoId: traslado.id, tipo: 'CHEQUE', chequeId: c.id, monedaCodigo: c.monedaCodigo, importe: c.importe } });
      }
      if (efectivo) {
        await tx.trasladoItem.create({ data: { empresaId, trasladoId: traslado.id, tipo: 'EFECTIVO', monedaCodigo: origen.monedaCodigo, importe: efectivo } });
        await registrarMovimiento(tx, empresaId, { fecha: d.fecha, tipo: 'EGRESO', cajaId: origen.id, monedaCodigo: origen.monedaCodigo, importe: efectivo, origenTipo: 'TRASLADO', origenId: traslado.id });
        const pesos = await aPesos(tx, origen.monedaCodigo, efectivo, d.fecha);
        const asiento = await this.asientos.generar(tx, {
          fecha: d.fecha, descripcion: `Traslado de valores ${numero}: ${origen.nombre} → ${destino.nombre}`, origenTipo: 'TRASLADO', origenId: traslado.id,
          renglones: [
            { cuentaContableId: await this.cuentas.cuenta(tx, 'VALORES_EN_TRANSITO'), debe: pesos.toFixed(2) },
            { cuentaContableId: origen.cuentaContableId, haber: pesos.toFixed(2) },
          ],
        });
        await tx.traslado.update({ where: { id: traslado.id }, data: { asientoId: asiento.id } });
      }
      await this.auditoria.registrar(tx, { entidad: 'Traslado', entidadId: traslado.id, accion: 'CREAR', datos: { numero, cheques: d.cheques.length, efectivo: efectivo?.toString() } });
      return this.obtener(traslado.id, tx);
    });
  }

  recibir(id: string, d: DatosRecepcion) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const t = await tx.traslado.findUnique({ where: { id }, include: INCLUIR });
      if (!t) throw new NotFoundException('Traslado no encontrado');
      const destino = await this.alcance.verificarCaja(tx, t.cajaDestinoId).catch(() => {
        throw new NotFoundException('Traslado no encontrado');
      });
      const origen = await tx.caja.findUniqueOrThrow({ where: { id: t.cajaOrigenId } });
      await bloquear(tx, 'Caja', empresaId, [origen.id, destino.id]);
      const actual = await tx.traslado.findUniqueOrThrow({ where: { id } });
      if (actual.estado !== 'ENVIADO') throw new BadRequestException('El traslado ya fue recibido o anulado');
      const decisiones = new Map(d.items.map((i) => [i.itemId, i]));
      if (decisiones.size !== d.items.length || t.items.length !== d.items.length || t.items.some((i) => !decisiones.has(i.id)))
        throw new BadRequestException('Indique la decisión de todos los ítems del traslado');
      for (const i of d.items)
        if (!i.aceptado && !i.motivo)
          throw new BadRequestException({ statusCode: 400, message: 'Indique el motivo del rechazo', campos: { motivo: 'Indique el motivo del rechazo' } });

      const fecha = d.fecha ?? (hoy() < t.fecha ? t.fecha : hoy());
      if (fecha < t.fecha) throw new BadRequestException('La fecha de recepción no puede ser anterior a la del envío');
      await bloquear(tx, 'ChequeTercero', empresaId, t.items.map((i) => i.chequeId!).filter(Boolean));
      const mov = { tipo: 'RECEPCION_TRASLADO', id, fecha };
      const renglones: RenglonAsiento[] = [];
      const enTransito = await this.cuentas.cuenta(tx, 'VALORES_EN_TRANSITO');
      for (const item of t.items) {
        const dec = decisiones.get(item.id)!;
        const caja = dec.aceptado ? destino : origen;
        if (item.tipo === 'CHEQUE') await this.cartera.cambiarEstado(tx, item.chequeId!, 'EN_CARTERA', { cajaId: caja.id, sucursalId: caja.sucursalId }, mov, ['EN_TRANSITO']);
        else {
          await registrarMovimiento(tx, empresaId, { fecha, tipo: 'INGRESO', cajaId: caja.id, monedaCodigo: item.monedaCodigo, importe: item.importe, origenTipo: 'RECEPCION_TRASLADO', origenId: id });
          const pesos = await aPesos(tx, item.monedaCodigo, item.importe, t.fecha);
          renglones.push({ cuentaContableId: caja.cuentaContableId, debe: pesos.toFixed(2) }, { cuentaContableId: enTransito, haber: pesos.toFixed(2) });
        }
        await tx.trasladoItem.update({ where: { id: item.id }, data: { aceptado: dec.aceptado, motivoRechazo: dec.aceptado ? null : dec.motivo } });
      }
      let asientoRecepcionId: string | null = null;
      if (renglones.length)
        asientoRecepcionId = (await this.asientos.generar(tx, {
          fecha, descripcion: `Recepción del traslado ${t.numero}: ${origen.nombre} → ${destino.nombre}`, origenTipo: 'RECEPCION_TRASLADO', origenId: id, renglones,
        })).id;
      const estado = d.items.every((i) => i.aceptado) ? 'RECIBIDO' : 'RECIBIDO_PARCIAL';
      await tx.traslado.update({ where: { id }, data: { estado, fechaRecepcion: fecha, recibidoPor: this.usuario(), asientoRecepcionId } });
      await this.auditoria.registrar(tx, { entidad: 'Traslado', entidadId: id, accion: 'MODIFICAR', datos: { recepcion: true, estado } });
      return this.obtener(id, tx);
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const t = await tx.traslado.findUnique({ where: { id }, include: INCLUIR });
      if (!t) throw new NotFoundException('Traslado no encontrado');
      const origen = await this.alcance.verificarCaja(tx, t.cajaOrigenId).catch(() => {
        throw new NotFoundException('Traslado no encontrado');
      });
      await bloquear(tx, 'Caja', empresaId, [origen.id, t.cajaDestinoId]);
      const actual = await tx.traslado.findUniqueOrThrow({ where: { id } });
      if (actual.estado !== 'ENVIADO') throw new BadRequestException('Solo se pueden anular traslados enviados y no recibidos');
      await bloquear(tx, 'ChequeTercero', empresaId, t.items.map((i) => i.chequeId!).filter(Boolean));
      const fecha = hoy() < t.fecha ? t.fecha : hoy();
      const mov = { tipo: 'ANULACION_TRASLADO', id, fecha };
      for (const item of t.items.filter((i) => i.chequeId))
        await this.cartera.cambiarEstado(tx, item.chequeId!, 'EN_CARTERA', { cajaId: origen.id }, mov, ['EN_TRANSITO']);
      await anularMovimientos(tx, 'TRASLADO', id);
      const contra = t.asientoId ? await this.asientos.contraasiento(tx, t.asientoId, fecha, `Anulación del traslado ${t.numero} - ${motivo}`) : null;
      await tx.traslado.update({ where: { id }, data: { estado: 'ANULADO', motivoAnulacion: motivo, asientoAnulacionId: contra?.id ?? null } });
      await this.auditoria.registrar(tx, { entidad: 'Traslado', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }
}
