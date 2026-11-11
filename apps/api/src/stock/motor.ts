import { BadRequestException, Injectable } from '@nestjs/common';
import type { TipoMovimientoStock } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { bloquear } from '../compras/comun';
import { D, Dec } from '../contabilidad/consultas/saldos';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { ConfigStockService } from './config-stock.service';

export interface Movimiento {
  fecha: Date;
  articuloId: string;
  /** Nulo solo en los movimientos de importe (AJUSTE_COSTO). */
  depositoId: string | null;
  /** Con signo: positivo = entrada. 0 = movimiento de solo importe. */
  cantidad: Dec;
  /** Costo dado (entradas, devoluciones, anulaciones). En salidas sin costo se usa el promedio. */
  costoUnitario?: Dec;
  /** Importe forzado (anulaciones exactas y movimientos de solo importe). */
  importe?: Dec;
  tipo: TipoMovimientoStock;
  origenTipo: string;
  origenId: string;
  origenRenglonId?: string | null;
  anulaAId?: string | null;
}

export interface Resultado {
  id: string;
  importe: Dec;
  costoUnitario: Dec;
  /** Importe del movimiento REGULARIZACION generado al entrar con saldo negativo (va al costo de lo vendido). */
  regularizacion: Dec;
  advertencia?: string;
}

const cero = new D(0);
const r2 = (x: Dec) => x.toDecimalPlaces(2);

/** Motor de stock: kardex, saldos por depósito y costo promedio ponderado móvil por artículo (spec §3). */
@Injectable()
export class MotorStock {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly config: ConfigStockService,
    private readonly cls: ClsService,
  ) {}

  /** Mueve varios renglones en orden de artículo y depósito (evita bloqueos cruzados). */
  async moverVarios(tx: TxEmpresa, ms: Movimiento[]): Promise<Resultado[]> {
    const orden = ms.map((m, i) => ({ m, i })).sort((a, b) => a.m.articuloId.localeCompare(b.m.articuloId) || (a.m.depositoId ?? '').localeCompare(b.m.depositoId ?? ''));
    const r: Resultado[] = new Array(ms.length);
    for (const { m, i } of orden) r[i] = await this.mover(tx, m);
    return r;
  }

  async mover(tx: TxEmpresa, m: Movimiento): Promise<Resultado> {
    const empresaId = this.tenant.empresaId;
    await bloquear(tx, 'Articulo', empresaId, [m.articuloId]);
    const art = await tx.articulo.findUniqueOrThrow({ where: { id: m.articuloId } });
    if (!art.controlaStock) throw new BadRequestException(`El artículo ${art.codigo} no controla stock`);
    const creadoPor = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO)?.usuarioId ?? 'sistema';
    const q0 = new D(art.stockCantidad);
    const v0 = new D(art.stockValor);
    const prom = new D(art.costoPromedio);
    const cant = new D(m.cantidad);
    let importe: Dec;
    let advertencia: string | undefined;
    let regularizacion = cero;

    if (cant.isZero()) {
      importe = r2(m.importe ?? cero);
    } else {
      if (!m.depositoId) throw new BadRequestException('Indique el depósito');
      const saldo = await tx.saldoStock.upsert({
        where: { empresaId_articuloId_depositoId: { empresaId, articuloId: m.articuloId, depositoId: m.depositoId } },
        create: { empresaId, articuloId: m.articuloId, depositoId: m.depositoId }, update: {},
      });
      await bloquear(tx, 'SaldoStock', empresaId, [saldo.id]);
      const s0 = new D((await tx.saldoStock.findUniqueOrThrow({ where: { id: saldo.id } })).cantidad);
      if (cant.lt(0)) {
        const c = cant.neg();
        if (s0.minus(c).lt(0)) {
          const dep = await tx.deposito.findUniqueOrThrow({ where: { id: m.depositoId } });
          const msj = `Stock insuficiente de ${art.codigo} en ${dep.nombre}: hay ${s0.toString()}, se piden ${c.toString()}`;
          if ((await this.config.modo(tx)) === 'BLOQUEAR') throw new BadRequestException(msj);
          advertencia = msj;
        }
        if (m.importe) importe = r2(m.importe);
        else if (m.costoUnitario) importe = r2(c.times(m.costoUnitario)).neg();
        else if (q0.gt(0)) importe = c.gte(q0) ? v0.plus(c.minus(q0).times(prom)).neg() : r2(v0.times(c).div(q0)).neg();
        else importe = r2(c.times(prom)).neg();
        importe = r2(importe);
      } else {
        importe = r2(m.importe ?? cant.times(m.costoUnitario ?? prom));
      }
      await tx.saldoStock.update({ where: { id: saldo.id }, data: { cantidad: s0.plus(cant) } });
    }
    const costoUnitario = m.costoUnitario ?? (cant.isZero() ? cero : importe.abs().div(cant.abs()).toDecimalPlaces(6));
    const mov = await tx.movimientoStock.create({
      data: {
        empresaId, fecha: m.fecha, articuloId: m.articuloId, depositoId: m.depositoId, tipo: m.tipo, cantidad: cant, costoUnitario, importe,
        origenTipo: m.origenTipo, origenId: m.origenId, origenRenglonId: m.origenRenglonId ?? null, anulaAId: m.anulaAId ?? null, creadoPor,
      },
    });
    const q1 = q0.plus(cant);
    let v1 = v0.plus(importe);
    // Entrada que cubre un saldo negativo: el valor queda al costo de la entrada y la diferencia va al costo de lo vendido
    if (cant.gt(0) && q0.lt(0) && q1.gte(0)) {
      const objetivo = r2(q1.times(costoUnitario));
      regularizacion = objetivo.minus(v1);
      if (!regularizacion.isZero()) {
        await tx.movimientoStock.create({
          data: {
            empresaId, fecha: m.fecha, articuloId: m.articuloId, depositoId: null, tipo: 'REGULARIZACION', cantidad: 0, costoUnitario: 0, importe: regularizacion,
            origenTipo: m.origenTipo, origenId: m.origenId, origenRenglonId: m.origenRenglonId ?? null, creadoPor,
          },
        });
        v1 = objetivo;
      }
    }
    const promedio = q1.gt(0) ? v1.div(q1).toDecimalPlaces(6) : prom;
    await tx.articulo.update({ where: { id: m.articuloId }, data: { stockCantidad: q1, stockValor: v1, costoPromedio: promedio } });
    return { id: mov.id, importe, costoUnitario, regularizacion, advertencia };
  }
}
