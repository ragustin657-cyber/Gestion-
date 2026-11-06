import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Conciliacion, Prisma, TipoVinculo } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { bloquear, fechaAR, MODIFICADO } from '../compras/comun';
import { desvincular } from './bloqueo';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { DESCRIPCIONES } from '../tesoreria/operaciones/consultas.service';
import { FormatosService } from './formatos.service';
import { DatosConciliacion } from './dto';
import { reglaPara } from './reglas-iniciales';
import { sugerir } from './sugerencias';
import { DatosReporte, ItemReporte } from './reporte';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const CERRADA = 'La conciliación está cerrada';
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const pesos = (n: Dec) => `${n.isNegative() ? '-' : ''}$ ${Number(n.abs()).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firmado = (m: { tipo: string; importe: Dec }) => (m.tipo === 'INGRESO' ? m.importe : m.importe.neg());

export interface MovimientoVista { id: string; fecha: string; tipo: string; origenTipo: string; origenId: string; descripcion: string; referencia: string | null; importe: string }

@Injectable()
export class ConciliacionesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly formatos: FormatosService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  /** Conciliación de la empresa (404 si no existe o el usuario es de sucursal). */
  async buscar(tx: TxEmpresa, id: string): Promise<Conciliacion> {
    const c = await tx.conciliacion.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Conciliación no encontrada');
    await this.formatos.cuenta(tx, c.cuentaBancariaId);
    return c;
  }

  /** Bloquea la conciliación y exige que esté abierta. */
  async abierta(tx: TxEmpresa, id: string): Promise<Conciliacion> {
    await this.buscar(tx, id);
    await bloquear(tx, 'Conciliacion', this.tenant.empresaId, [id]);
    const c = await tx.conciliacion.findUniqueOrThrow({ where: { id } });
    if (c.estado !== 'ABIERTA') throw new BadRequestException(CERRADA);
    return c;
  }

  async listar(cuentaBancariaId?: string) {
    if (this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).sucursalId) return [];
    if (cuentaBancariaId) await this.formatos.cuenta(this.tenant.db, cuentaBancariaId);
    return this.tenant.db.conciliacion.findMany({ where: { cuentaBancariaId: cuentaBancariaId || undefined }, orderBy: [{ desde: 'desc' }] });
  }

  crear(d: DatosConciliacion) {
    return this.tenant.transaccion(async (tx) => {
      await this.formatos.cuenta(tx, d.cuentaBancariaId);
      if (await tx.conciliacion.findFirst({ where: { cuentaBancariaId: d.cuentaBancariaId, estado: 'ABIERTA' } }))
        throw new ConflictException('Ya hay una conciliación abierta para esta cuenta');
      const superpuesta = await tx.conciliacion.findFirst({ where: { cuentaBancariaId: d.cuentaBancariaId, desde: { lte: d.hasta }, hasta: { gte: d.desde } } });
      if (superpuesta) throw new ConflictException(`El período se superpone con la conciliación del ${fechaAR(superpuesta.desde)} al ${fechaAR(superpuesta.hasta)}`);
      const anterior = await tx.conciliacion.findFirst({ where: { cuentaBancariaId: d.cuentaBancariaId, estado: 'CERRADA' }, orderBy: { hasta: 'desc' } });
      if (anterior && d.desde <= anterior.hasta) throw new ConflictException('El período debe ser posterior a la última conciliación cerrada');
      const c = await tx.conciliacion.create({
        data: {
          empresaId: this.tenant.empresaId, cuentaBancariaId: d.cuentaBancariaId, desde: d.desde, hasta: d.hasta,
          saldoInicial: d.saldoInicial ?? anterior?.saldoFinal ?? 0, saldoFinal: d.saldoFinal, creadoPor: this.usuario(),
        },
      });
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: c.id, accion: 'CREAR', datos: { desde: iso(d.desde), hasta: iso(d.hasta) } });
      return c;
    });
  }

  /** Referencia de cada movimiento (boleta, número de cheque, referencia de transferencia o número de comprobante). */
  private async referencias(tx: TxEmpresa, movs: { origenTipo: string; origenId: string }[]): Promise<Map<string, string | null>> {
    const de = (t: string) => movs.filter((m) => m.origenTipo === t).map((m) => m.origenId);
    const r = new Map<string, string | null>();
    for (const x of await tx.depositoBancario.findMany({ where: { id: { in: de('DEPOSITO') } } })) r.set(x.id, x.boleta ?? String(x.numero));
    for (const x of await tx.transferenciaRecibida.findMany({ where: { id: { in: de('ACREDITACION_TRANSFERENCIA') } } })) r.set(x.id, x.referencia);
    for (const x of await tx.chequePropio.findMany({ where: { id: { in: de('DEBITO_CHEQUE') } } })) r.set(x.id, x.numero);
    for (const x of await tx.chequeTercero.findMany({ where: { id: { in: de('RECHAZO_CHEQUE') } } })) r.set(x.id, x.numero);
    for (const x of await tx.movimientoBancario.findMany({ where: { id: { in: de('MOVIMIENTO_BANCARIO') } } })) r.set(x.id, String(x.numero));
    for (const x of await tx.transferenciaInterna.findMany({ where: { id: { in: de('TRANSFERENCIA_INTERNA') } } })) r.set(x.id, String(x.numero));
    const ops = de('OP');
    for (const m of await tx.ordenPagoMedio.findMany({ where: { ordenPagoId: { in: ops } } }))
      if (!r.get(m.ordenPagoId)) r.set(m.ordenPagoId, m.chequeNumero ?? m.referencia ?? null);
    return r;
  }

  async vistaMovimientos(tx: TxEmpresa, movs: Prisma.MovimientoTesoreriaGetPayload<object>[]): Promise<MovimientoVista[]> {
    const refs = await this.referencias(tx, movs);
    return movs.map((m) => ({
      id: m.id, fecha: iso(m.fecha), tipo: m.tipo, origenTipo: m.origenTipo, origenId: m.origenId,
      descripcion: DESCRIPCIONES[m.origenTipo] ?? m.origenTipo, referencia: refs.get(m.origenId) ?? null, importe: firmado(m).toString(),
    }));
  }

  /** Importes del resumen (spec §3). */
  async resumen(tx: TxEmpresa, c: Conciliacion) {
    const movs = await tx.movimientoTesoreria.findMany({ where: { cuentaBancariaId: c.cuentaBancariaId, anulado: false, fecha: { lte: c.hasta } }, select: { tipo: true, importe: true, vinculoId: true } });
    const saldoSistema = movs.reduce((s, m) => s.plus(firmado(m)), new D(0));
    const pendientesSistema = movs.filter((m) => !m.vinculoId).reduce((s, m) => s.plus(firmado(m)), new D(0));
    const lineas = await tx.lineaExtracto.findMany({ where: { cuentaBancariaId: c.cuentaBancariaId, fecha: { gte: c.desde, lte: c.hasta } }, select: { importe: true, estado: true } });
    const pendientesExtracto = lineas.filter((l) => l.estado === 'PENDIENTE').reduce((s, l) => s.plus(l.importe), new D(0));
    const diferencia = c.saldoFinal.minus(saldoSistema.minus(pendientesSistema).plus(pendientesExtracto));
    const explicado = c.saldoInicial.plus(lineas.filter((l) => l.estado !== 'IGNORADA').reduce((s, l) => s.plus(l.importe), new D(0)));
    return {
      saldoSistema: saldoSistema.toString(), pendientesSistema: pendientesSistema.toString(), pendientesExtracto: pendientesExtracto.toString(),
      diferencia: diferencia.toString(), lineasPendientes: lineas.filter((l) => l.estado === 'PENDIENTE').length,
      advertencia: explicado.eq(c.saldoFinal) ? null : 'El extracto del período no explica el saldo final',
    };
  }

  async obtener(id: string) {
    const db = this.tenant.db;
    const c = await this.buscar(db, id);
    const lineas = await db.lineaExtracto.findMany({
      where: { cuentaBancariaId: c.cuentaBancariaId, fecha: { gte: c.desde, lte: c.hasta }, estado: { in: ['PENDIENTE', 'IGNORADA'] } }, orderBy: [{ fecha: 'asc' }, { fila: 'asc' }],
    });
    const movs = await db.movimientoTesoreria.findMany({
      where: { cuentaBancariaId: c.cuentaBancariaId, anulado: false, vinculoId: null, fecha: { lte: c.hasta } }, orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
    });
    const vinculos = await db.vinculoConciliacion.findMany({ where: { conciliacionId: id }, orderBy: { creadoEn: 'asc' } });
    const ids = vinculos.map((v) => v.id);
    const lineasV = await db.lineaExtracto.findMany({ where: { vinculoId: { in: ids } }, orderBy: { fecha: 'asc' } });
    const movsV = await db.movimientoTesoreria.findMany({ where: { vinculoId: { in: ids } }, orderBy: { fecha: 'asc' } });
    const vistaV = await this.vistaMovimientos(db, movsV);
    const reglas = await db.reglaConciliacion.findMany({ where: { activa: true } });
    const cuentas = await db.cuentaContable.findMany({ where: { id: { in: reglas.map((r) => r.cuentaContableId) } } });
    return {
      ...c,
      resumen: await this.resumen(db, c),
      lineas: lineas.map((l) => {
        const r = l.estado === 'PENDIENTE' ? reglaPara(reglas, l, c.cuentaBancariaId) : null;
        const cc = r ? cuentas.find((x) => x.id === r.cuentaContableId) : null;
        return { ...l, reglaSugerida: r && cc ? { id: r.id, cuentaContableId: cc.id, cuenta: `${cc.codigo} ${cc.nombre}`, concepto: r.concepto ?? l.concepto } : null };
      }),
      movimientos: await this.vistaMovimientos(db, movs),
      vinculos: vinculos.map((v) => ({
        ...v, lineas: lineasV.filter((l) => l.vinculoId === v.id), movimientos: vistaV.filter((m) => movsV.find((x) => x.id === m.id)!.vinculoId === v.id),
      })),
    };
  }

  /**
   * Datos del reporte. Las partidas pendientes son las que estaban sin conciliar al cierre del período:
   * sin vínculo, o conciliadas después en una conciliación de un período posterior.
   */
  async datosReporte(id: string): Promise<DatosReporte> {
    const db = this.tenant.db;
    const c = await this.buscar(db, id);
    const cuenta = await db.cuentaBancaria.findUniqueOrThrow({ where: { id: c.cuentaBancariaId }, include: { banco: true } });
    const empresa = await db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const posteriores = (await db.conciliacion.findMany({ where: { cuentaBancariaId: c.cuentaBancariaId, desde: { gt: c.hasta } }, select: { id: true } })).map((x) => x.id);
    const vinculosPost = posteriores.length ? (await db.vinculoConciliacion.findMany({ where: { conciliacionId: { in: posteriores } }, select: { id: true } })).map((v) => v.id) : [];
    const movs = await db.movimientoTesoreria.findMany({
      where: { cuentaBancariaId: c.cuentaBancariaId, anulado: false, fecha: { lte: c.hasta }, OR: [{ vinculoId: null }, { vinculoId: { in: vinculosPost } }] },
      orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
    });
    const vista = await this.vistaMovimientos(db, movs);
    const item = (m: MovimientoVista): ItemReporte => ({ fecha: m.fecha, descripcion: m.descripcion, referencia: m.referencia, importe: new D(m.importe).abs().toString() });
    const lineas = await db.lineaExtracto.findMany({ where: { cuentaBancariaId: c.cuentaBancariaId, fecha: { gte: c.desde, lte: c.hasta }, estado: 'PENDIENTE' }, orderBy: { fecha: 'asc' } });
    const r = c.estado === 'CERRADA' && c.resumen ? (c.resumen as { saldoSistema: string; diferencia: string }) : await this.resumen(db, c);
    const usuario = c.cerradaPor ? await db.usuario.findUnique({ where: { id: c.cerradaPor }, select: { nombre: true } }) : null;
    return {
      encabezado: {
        empresa: empresa.razonSocial, cuit: empresa.cuit, cuenta: `${cuenta.banco.nombre} - ${cuenta.numero}`, monedaCodigo: cuenta.monedaCodigo,
        periodo: `${fechaAR(c.desde)} al ${fechaAR(c.hasta)}`, estado: c.estado, cerradaPor: usuario?.nombre ?? null, cerradaEn: c.cerradaEn ? fechaAR(c.cerradaEn) : null,
      },
      saldoExtracto: c.saldoFinal.toString(),
      creditosNoAcreditados: vista.filter((m) => !m.importe.startsWith('-')).map(item),
      debitosNoDebitados: vista.filter((m) => m.importe.startsWith('-')).map(item),
      lineasPendientes: lineas.map((l) => ({ fecha: iso(l.fecha), descripcion: l.concepto, referencia: l.referencia, importe: l.importe.toString() })),
      saldoLibros: r.saldoSistema,
      diferencia: r.diferencia,
    };
  }

  async obtenerCabecera(id: string) {
    const c = await this.buscar(this.tenant.db, id);
    const cuenta = await this.tenant.db.cuentaBancaria.findUniqueOrThrow({ where: { id: c.cuentaBancariaId } });
    return { cuentaNumero: cuenta.numero, desde: iso(c.desde) };
  }

  /** Coincidencias propuestas entre lo pendiente de cada lado (no guarda nada). */
  async sugerencias(id: string) {
    const db = this.tenant.db;
    const c = await this.buscar(db, id);
    if (c.estado !== 'ABIERTA') throw new BadRequestException(CERRADA);
    const empresa = await db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const lineas = await db.lineaExtracto.findMany({ where: { cuentaBancariaId: c.cuentaBancariaId, fecha: { gte: c.desde, lte: c.hasta }, estado: 'PENDIENTE' } });
    const movs = await db.movimientoTesoreria.findMany({ where: { cuentaBancariaId: c.cuentaBancariaId, anulado: false, vinculoId: null, fecha: { lte: c.hasta } } });
    const refs = await this.referencias(db, movs);
    return sugerir(
      lineas.map((l) => ({ id: l.id, fecha: l.fecha, importe: l.importe, referencia: [l.referencia, l.concepto].filter(Boolean).join(' ') })),
      movs.map((m) => ({ id: m.id, fecha: m.fecha, importe: firmado(m), referencia: refs.get(m.origenId) ?? null })),
      empresa.diasToleranciaConciliacion,
    );
  }

  /** Crea un vínculo validando pertenencia, estado e importes. La conciliación ya está bloqueada y abierta. */
  async vincular(tx: TxEmpresa, c: Conciliacion, lineaIds: string[], movimientoIds: string[], tipo: TipoVinculo) {
    const empresaId = this.tenant.empresaId;
    if (!lineaIds.length || !movimientoIds.length) throw new BadRequestException('Elija al menos una línea del extracto y un movimiento del sistema');
    if (new Set(lineaIds).size !== lineaIds.length || new Set(movimientoIds).size !== movimientoIds.length) throw new BadRequestException('Hay elementos repetidos');
    await bloquear(tx, 'MovimientoTesoreria', empresaId, movimientoIds);
    await bloquear(tx, 'LineaExtracto', empresaId, lineaIds);
    const movs = await tx.movimientoTesoreria.findMany({ where: { id: { in: movimientoIds } } });
    const lineas = await tx.lineaExtracto.findMany({ where: { id: { in: lineaIds } } });
    if (lineas.length !== lineaIds.length || lineas.some((l) => l.cuentaBancariaId !== c.cuentaBancariaId || l.fecha < c.desde || l.fecha > c.hasta))
      throw new BadRequestException('La línea no pertenece a esta conciliación');
    if (movs.length !== movimientoIds.length || movs.some((m) => m.cuentaBancariaId !== c.cuentaBancariaId || m.anulado || m.fecha > c.hasta))
      throw new BadRequestException('El movimiento no pertenece a esta conciliación');
    if (lineas.some((l) => l.estado === 'CONCILIADA' || l.vinculoId)) throw new ConflictException('La línea ya fue conciliada');
    if (lineas.some((l) => l.estado === 'IGNORADA')) throw new BadRequestException('La línea está ignorada: restáurela primero');
    if (movs.some((m) => m.vinculoId)) throw new ConflictException('El movimiento ya fue conciliado');
    const sumaLineas = lineas.reduce((s, l) => s.plus(l.importe), new D(0));
    const sumaMovs = movs.reduce((s, m) => s.plus(firmado(m)), new D(0));
    if (!sumaLineas.eq(sumaMovs)) throw new BadRequestException(`Los importes no coinciden (extracto ${pesos(sumaLineas)}, sistema ${pesos(sumaMovs)})`);
    const v = await tx.vinculoConciliacion.create({ data: { empresaId, conciliacionId: c.id, tipo, creadoPor: this.usuario() } });
    await tx.lineaExtracto.updateMany({ where: { id: { in: lineaIds } }, data: { estado: 'CONCILIADA', vinculoId: v.id, conciliacionId: c.id } });
    await tx.movimientoTesoreria.updateMany({ where: { id: { in: movimientoIds } }, data: { vinculoId: v.id } });
    return v;
  }

  crearVinculo(id: string, lineas: string[], movimientos: string[]) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.abierta(tx, id);
      const v = await this.vincular(tx, c, lineas, movimientos, 'MANUAL');
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: id, accion: 'MODIFICAR', datos: { vinculo: v.id, lineas, movimientos } });
      return v;
    });
  }

  crearLote(id: string, vinculos: { lineas: string[]; movimientos: string[] }[]) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.abierta(tx, id);
      for (const x of vinculos) await this.vincular(tx, c, x.lineas, x.movimientos, 'AUTOMATICO');
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: id, accion: 'MODIFICAR', datos: { lote: vinculos.length } });
      return { creados: vinculos.length };
    });
  }

  cerrar(id: string, version: number) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.abierta(tx, id);
      if (c.version !== version) throw new ConflictException(MODIFICADO);
      const r = await this.resumen(tx, c);
      if (r.lineasPendientes) throw new BadRequestException(`Hay ${r.lineasPendientes} líneas del extracto sin conciliar`);
      const dif = new D(r.diferencia);
      if (!dif.isZero()) throw new BadRequestException(`La conciliación no cuadra: diferencia ${pesos(dif)}`);
      const cerrada = await tx.conciliacion.update({
        where: { id }, data: { estado: 'CERRADA', resumen: r, cerradaPor: this.usuario(), cerradaEn: new Date(), motivoReapertura: null, version: { increment: 1 } },
      });
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: id, accion: 'MODIFICAR', datos: { cierre: true, resumen: r } });
      return cerrada;
    });
  }

  reabrir(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.buscar(tx, id);
      await bloquear(tx, 'Conciliacion', this.tenant.empresaId, [id]);
      const c = await tx.conciliacion.findUniqueOrThrow({ where: { id } });
      if (c.estado !== 'CERRADA') throw new BadRequestException('La conciliación no está cerrada');
      if (await tx.conciliacion.findFirst({ where: { cuentaBancariaId: c.cuentaBancariaId, id: { not: id }, OR: [{ estado: 'ABIERTA' }, { desde: { gt: c.hasta } }] } }))
        throw new BadRequestException('Solo se puede reabrir la última conciliación de la cuenta');
      const r = await tx.conciliacion.update({ where: { id }, data: { estado: 'ABIERTA', motivoReapertura: motivo, cerradaPor: null, cerradaEn: null, version: { increment: 1 } } });
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: id, accion: 'MODIFICAR', datos: { reapertura: motivo } });
      return r;
    });
  }

  eliminarVinculo(id: string, vinculoId: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.abierta(tx, id);
      const v = await tx.vinculoConciliacion.findFirst({ where: { id: vinculoId, conciliacionId: id } });
      if (!v) throw new NotFoundException('Vínculo no encontrado');
      await desvincular(tx, vinculoId);
      await this.auditoria.registrar(tx, { entidad: 'Conciliacion', entidadId: id, accion: 'MODIFICAR', datos: { desvinculo: vinculoId } });
      return { ok: true };
    });
  }

  ignorar(id: string, lineaId: string, motivo: string | null) {
    return this.tenant.transaccion(async (tx) => {
      const c = await this.abierta(tx, id);
      await bloquear(tx, 'LineaExtracto', this.tenant.empresaId, [lineaId]);
      const l = await tx.lineaExtracto.findUnique({ where: { id: lineaId } });
      if (!l || l.cuentaBancariaId !== c.cuentaBancariaId || l.fecha < c.desde || l.fecha > c.hasta) throw new BadRequestException('La línea no pertenece a esta conciliación');
      if (motivo !== null) {
        if (l.estado !== 'PENDIENTE') throw new ConflictException('La línea ya fue conciliada');
        return tx.lineaExtracto.update({ where: { id: lineaId }, data: { estado: 'IGNORADA', motivoIgnorada: motivo, conciliacionId: id } });
      }
      if (l.estado !== 'IGNORADA') throw new BadRequestException('La línea no está ignorada');
      return tx.lineaExtracto.update({ where: { id: lineaId }, data: { estado: 'PENDIENTE', motivoIgnorada: null, conciliacionId: null } });
    });
  }
}
