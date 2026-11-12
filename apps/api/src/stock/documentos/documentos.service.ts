import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TipoDocumentoStock } from '@prisma/client';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { D, Dec } from '../../contabilidad/consultas/saldos';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { Movimiento, MotorStock, Resultado } from '../motor';
import type { DatosDocumento } from './dto';

export const ORIGEN_DOC = 'DOC_STOCK';
const NOMBRE: Record<TipoDocumentoStock, string> = { TRANSFERENCIA: 'Transferencia', INVENTARIO: 'Inventario físico', INICIAL: 'Inventario inicial', SALIDA: 'Salida manual' };
const cero = new D(0);

/** Acumula renglones de asiento sin fusionar debe y haber de una misma cuenta. */
export class Partida {
  private readonly lineas = new Map<string, { cuentaContableId: string; lado: 'debe' | 'haber'; importe: Dec }>();
  agregar(cuentaContableId: string, importe: Dec) {
    if (importe.isZero()) return;
    const lado = importe.gt(0) ? 'debe' : 'haber';
    const clave = `${cuentaContableId}:${lado}`;
    const l = this.lineas.get(clave) ?? { cuentaContableId, lado, importe: cero };
    l.importe = l.importe.plus(importe.abs());
    this.lineas.set(clave, l);
  }
  renglones(): RenglonAsiento[] {
    return [...this.lineas.values()].map((l) => ({ cuentaContableId: l.cuentaContableId, [l.lado]: l.importe.toFixed(2) }));
  }
}

@Injectable()
export class DocumentosStockService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly motor: MotorStock,
    private readonly asientos: AsientosService,
    private readonly conceptos: ConfigComprasService,
    private readonly numeracion: NumeracionService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const d = await tx.documentoStock.findUnique({ where: { id }, include: { renglones: true } });
    if (!d) throw new NotFoundException('Documento no encontrado');
    return d;
  }

  async listar(q: { tipo?: string; desde?: string; hasta?: string }) {
    const tipo = q.tipo && q.tipo in NOMBRE ? (q.tipo as TipoDocumentoStock) : undefined;
    return this.tenant.db.documentoStock.findMany({
      where: { tipo, fecha: { gte: q.desde ? new Date(`${q.desde}T00:00:00Z`) : undefined, lte: q.hasta ? new Date(`${q.hasta}T00:00:00Z`) : undefined } },
      orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], include: { renglones: true }, take: 200,
    });
  }

  private async cuenta(tx: TxEmpresa, id: string | null | undefined) {
    if (!id) throw new BadRequestException('Indique la cuenta contable');
    const c = await tx.cuentaContable.findUnique({ where: { id } });
    if (!c || !c.imputable) throw new BadRequestException('La cuenta contable debe ser imputable');
    return c.id;
  }

  crear(d: DatosDocumento) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      if (!(await tx.deposito.findUnique({ where: { id: d.depositoId } }))) throw new BadRequestException('Depósito inexistente');
      const conAsiento = d.tipo === 'SALIDA' || (d.tipo === 'INICIAL' && d.conAsiento) || d.tipo === 'INVENTARIO';
      const cuentaContableId = d.tipo === 'SALIDA' || (d.tipo === 'INICIAL' && d.conAsiento) ? await this.cuenta(tx, d.cuentaContableId) : null;
      const numero = await this.numeracion.siguiente(tx, 'DOC_STOCK', 0);
      const doc = await tx.documentoStock.create({
        data: {
          empresaId, numero, tipo: d.tipo, fecha: d.fecha, depositoId: d.depositoId, depositoDestinoId: d.tipo === 'TRANSFERENCIA' ? d.depositoDestinoId : null,
          cuentaContableId, conAsiento, observaciones: d.observaciones ?? null, creadoPor: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId,
          renglones: {
            create: d.renglones.map((r) => ({
              empresaId, articuloId: r.articuloId, cantidad: 'cantidad' in r ? r.cantidad : 0,
              costoUnitario: 'costoUnitario' in r ? r.costoUnitario : null, cantidadContada: 'cantidadContada' in r ? r.cantidadContada : null,
            })),
          },
        },
        include: { renglones: true },
      });
      const base = { fecha: d.fecha, origenTipo: ORIGEN_DOC, origenId: doc.id };
      const movs: Movimiento[] = [];
      if (d.tipo === 'INICIAL')
        doc.renglones.forEach((r) => movs.push({ ...base, articuloId: r.articuloId, depositoId: d.depositoId, cantidad: new D(r.cantidad), costoUnitario: new D(r.costoUnitario!), tipo: 'INICIAL', origenRenglonId: r.id }));
      else if (d.tipo === 'SALIDA')
        doc.renglones.forEach((r) => movs.push({ ...base, articuloId: r.articuloId, depositoId: d.depositoId, cantidad: new D(r.cantidad).neg(), tipo: 'SALIDA_MANUAL', origenRenglonId: r.id }));
      const p = new Partida();
      const merc = await this.conceptos.cuenta(tx, 'MERCADERIAS');
      let res: Resultado[];
      if (d.tipo === 'TRANSFERENCIA') res = await this.transferir(tx, doc.renglones, base, d.depositoId, d.depositoDestinoId);
      else if (d.tipo === 'INVENTARIO') res = await this.inventariar(tx, doc.renglones, base, d.depositoId, p, merc);
      else {
        res = await this.motor.moverVarios(tx, movs);
        if (cuentaContableId) await this.contabilizar(tx, p, res, merc, cuentaContableId);
      }
      let asientoId: string | null = null;
      if (conAsiento) {
        const rs = p.renglones();
        if (rs.length) asientoId = (await this.asientos.generar(tx, { fecha: d.fecha, descripcion: `${NOMBRE[d.tipo]} N° ${numero}`, origenTipo: ORIGEN_DOC, origenId: doc.id, renglones: rs })).id;
      }
      const final = await tx.documentoStock.update({ where: { id: doc.id }, data: { asientoId }, include: { renglones: true } });
      await this.auditoria.registrar(tx, { entidad: 'DocumentoStock', entidadId: doc.id, accion: 'CREAR', datos: { tipo: d.tipo, numero } });
      return { ...final, advertencias: res.map((r) => r.advertencia).filter((x): x is string => !!x) };
    });
  }

  private async transferir(tx: TxEmpresa, renglones: { id: string; articuloId: string; cantidad: Prisma.Decimal }[], base: Pick<Movimiento, 'fecha' | 'origenTipo' | 'origenId'>, origen: string, destino: string) {
    if (origen === destino) throw new BadRequestException('El depósito de destino debe ser distinto del de origen');
    if (!(await tx.deposito.findUnique({ where: { id: destino } }))) throw new BadRequestException('Depósito inexistente');
    const res: Resultado[] = [];
    for (const r of [...renglones].sort((a, b) => a.articuloId.localeCompare(b.articuloId))) {
      const sale = await this.motor.mover(tx, { ...base, articuloId: r.articuloId, depositoId: origen, cantidad: new D(r.cantidad).neg(), tipo: 'TRANSFERENCIA', origenRenglonId: r.id, regularizar: false });
      const entra = await this.motor.mover(tx, { ...base, articuloId: r.articuloId, depositoId: destino, cantidad: new D(r.cantidad), costoUnitario: sale.costoUnitario, importe: sale.importe.neg(), tipo: 'TRANSFERENCIA', origenRenglonId: r.id, regularizar: false });
      res.push(sale, entra);
    }
    return res;
  }

  /** Inventario físico: diferencia contra el saldo al confirmar; sobrantes al promedio. */
  private async inventariar(tx: TxEmpresa, renglones: { id: string; articuloId: string; cantidadContada: Prisma.Decimal | null }[], base: Pick<Movimiento, 'fecha' | 'origenTipo' | 'origenId'>, depositoId: string, p: Partida, merc: string) {
    const ids = renglones.map((r) => r.articuloId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay artículos repetidos en el inventario');
    await bloquear(tx, 'Articulo', this.tenant.empresaId, ids);
    const [sobrantes, faltantes] = await Promise.all([this.conceptos.cuenta(tx, 'SOBRANTES_INVENTARIO'), this.conceptos.cuenta(tx, 'FALTANTES_INVENTARIO')]);
    const res: Resultado[] = [];
    for (const r of [...renglones].sort((a, b) => a.articuloId.localeCompare(b.articuloId))) {
      const art = await tx.articulo.findUniqueOrThrow({ where: { id: r.articuloId } });
      if (!art.controlaStock) throw new BadRequestException(`El artículo ${art.codigo} no controla stock`);
      const saldo = new D((await tx.saldoStock.findFirst({ where: { articuloId: r.articuloId, depositoId } }))?.cantidad ?? 0);
      const diferencia = new D(r.cantidadContada!).minus(saldo);
      await tx.documentoStockRenglon.update({ where: { id: r.id }, data: { cantidad: diferencia } });
      if (diferencia.isZero()) continue;
      if (diferencia.gt(0) && new D(art.costoPromedio).isZero()) throw new BadRequestException(`El artículo ${art.codigo} no tiene costo: cárguelo con inventario inicial`);
      const m = await this.motor.mover(tx, { ...base, articuloId: r.articuloId, depositoId, cantidad: diferencia, costoUnitario: diferencia.gt(0) ? new D(art.costoPromedio) : undefined, tipo: 'INVENTARIO', origenRenglonId: r.id });
      await this.contabilizar(tx, p, [m], merc, diferencia.gt(0) ? sobrantes : faltantes);
      res.push(m);
    }
    return res;
  }

  /** Mercaderías contra la cuenta del documento por cada movimiento, y las regularizaciones contra el costo de lo vendido. */
  private async contabilizar(tx: TxEmpresa, p: Partida, res: Resultado[], merc: string, contra: string) {
    for (const r of res) {
      p.agregar(merc, r.importe);
      p.agregar(contra, r.importe.neg());
      if (!r.regularizacion.isZero()) {
        const cmv = await this.conceptos.cuenta(tx, 'COSTO_MERCADERIAS_VENDIDAS');
        p.agregar(merc, r.regularizacion);
        p.agregar(cmv, r.regularizacion.neg());
      }
    }
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      await this.obtener(id, tx);
      await bloquear(tx, 'DocumentoStock', this.tenant.empresaId, [id]);
      const doc = await this.obtener(id, tx);
      if (doc.estado === 'ANULADO') throw new ConflictException('El documento ya está anulado');
      const hoy = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
      const res = await this.revertir(tx, ORIGEN_DOC, id, hoy);
      const contra = doc.asientoId ? await this.asientos.contraasiento(tx, doc.asientoId, hoy, `Anulación: ${motivo}`) : null;
      await contabilizarRegularizacion(tx, this.asientos, this.conceptos, res, { fecha: hoy, descripcion: `Regularización de stock - anulación de ${NOMBRE[doc.tipo]} N° ${doc.numero}`, origenTipo: ORIGEN_DOC, origenId: id });
      const final = await tx.documentoStock.update({ where: { id }, data: { estado: 'ANULADO', motivoAnulacion: motivo, asientoAnulacionId: contra?.id ?? null }, include: { renglones: true } });
      await this.auditoria.registrar(tx, { entidad: 'DocumentoStock', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return { ...final, advertencias: res.map((r) => r.advertencia).filter((x): x is string => !!x) };
    });
  }

  /** Movimientos inversos (mismo costo e importe) de todo lo que generó un origen. */
  revertir(tx: TxEmpresa, origenTipo: string, origenId: string, fecha: Date) {
    return revertirOrigen(tx, this.motor, origenTipo, origenId, fecha);
  }
}

/** Asiento de las regularizaciones (Mercaderías contra costo de lo vendido) que dejó una operación sin asiento propio para ellas. */
export async function contabilizarRegularizacion(
  tx: TxEmpresa, asientos: AsientosService, conceptos: ConfigComprasService, res: Resultado[],
  d: { fecha: Date; descripcion: string; origenTipo: string; origenId: string },
) {
  const total = res.reduce((s, r) => s.plus(r.regularizacion), cero);
  if (total.isZero()) return null;
  const p = new Partida();
  p.agregar(await conceptos.cuenta(tx, 'MERCADERIAS'), total);
  p.agregar(await conceptos.cuenta(tx, 'COSTO_MERCADERIAS_VENDIDAS'), total.neg());
  return asientos.generar(tx, { ...d, renglones: p.renglones() });
}

/** Movimientos inversos de un origen, con el importe exacto de cada uno. */
export async function revertirOrigen(tx: TxEmpresa, motor: MotorStock, origenTipo: string, origenId: string, fecha: Date): Promise<Resultado[]> {
  const movs = await tx.movimientoStock.findMany({ where: { origenTipo, origenId, anulaAId: null }, orderBy: { creadoEn: 'asc' } });
  return motor.moverVarios(tx, movs.map((m) => ({
    fecha, articuloId: m.articuloId, depositoId: m.depositoId, cantidad: new D(m.cantidad).neg(), costoUnitario: new D(m.costoUnitario),
    importe: new D(m.importe).neg(), tipo: m.tipo, origenTipo, origenId, origenRenglonId: m.origenRenglonId, anulaAId: m.id, regularizar: m.tipo !== 'TRANSFERENCIA',
  })));
}
