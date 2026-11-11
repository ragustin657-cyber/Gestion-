import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type Asiento, type Ejercicio } from '@prisma/client';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { indicesPara, mesAnterior, mesDe } from '../../indices-inflacion/indices';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { RenglonAsiento } from '../asientos/asientos.service';
import { D, Dec, ejercicioDe } from '../consultas/saldos';
import { calcular, CuentaAjuste, mesesNecesarios, Tramo } from './calculo';
import { ConfigAjusteService } from './config.service';

export const ORIGEN_AJUSTE = 'AJUSTE_INFLACION';

export interface ResultadoAjuste {
  ejercicio: Ejercicio;
  fecha: Date;
  cuentas: CuentaAjuste[];
  renglones: RenglonAsiento[];
  recpam: string;
  avisos: string[];
}

const fechaAR = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const esFinDeMes = (f: Date) => new Date(f.getTime() + 86400000).getUTCDate() === 1;

@Injectable()
export class AjusteInflacionService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly config: ConfigAjusteService,
    private readonly conceptos: ConfigComprasService,
  ) {}

  /** Último ajuste vigente (no anulado ni contraasiento), opcionalmente de un ejercicio y hasta una fecha. */
  async ultimoVigente(tx: TxEmpresa, ejercicioId?: string, hasta?: Date): Promise<Asiento | null> {
    const ajustes = await tx.asiento.findMany({
      where: { origenTipo: ORIGEN_AJUSTE, anulaAId: null, ejercicioId, fecha: hasta ? { lte: hasta } : undefined },
      orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
    });
    const anulados = new Set((await tx.asiento.findMany({ where: { anulaAId: { in: ajustes.map((a) => a.id) } }, select: { anulaAId: true } })).map((a) => a.anulaAId));
    return ajustes.find((a) => !anulados.has(a.id)) ?? null;
  }

  /** Cálculo del ajuste al fin de mes `fecha` (spec §5). Sin efectos. */
  async calcular(tx: TxEmpresa, fecha: Date): Promise<ResultadoAjuste> {
    const config = await this.config.requerir(tx);
    if (!esFinDeMes(fecha)) throw new BadRequestException('La fecha debe ser el último día de un mes');
    const ej = await ejercicioDe(tx, fecha);
    const primero = await tx.ejercicio.findUniqueOrThrow({ where: { id: config.primerEjercicioId } });
    if (ej.numero < primero.numero) throw new BadRequestException('El ejercicio no se ajusta');
    const esPrimero = ej.id === primero.id;
    if (!esPrimero) {
      const anterior = await tx.ejercicio.findFirstOrThrow({ where: { numero: ej.numero - 1 } });
      const v = await this.ultimoVigente(tx, anterior.id);
      if (!v || v.fecha.getTime() !== anterior.hasta.getTime()) throw new BadRequestException(`Genere primero el ajuste al cierre del ejercicio ${anterior.numero}`);
    }
    const [recpamId, rnaId] = await Promise.all([this.conceptos.cuenta(tx, 'RECPAM'), this.conceptos.cuenta(tx, 'RESULTADOS_NO_ASIGNADOS')]);
    const apertura = await this.config.aperturaDe(tx, ej, config);
    const usaAsientoManual = esPrimero && config.asientoAperturaId;
    const excluirApertura = usaAsientoManual ? Prisma.sql`a."id" <> ${config.asientoAperturaId}::uuid` : Prisma.sql`a."tipo" <> 'APERTURA'`;
    const filas = await tx.$queryRaw<{ cuentaId: string; anio: number; mes: number; saldo: Prisma.Decimal; ajuste: boolean }[]>`
      SELECT r."cuentaContableId" AS "cuentaId", EXTRACT(YEAR FROM a."fecha")::int AS anio, EXTRACT(MONTH FROM a."fecha")::int AS mes,
             SUM(r."debe" - r."haber") AS saldo, (a."origenTipo" = ${ORIGEN_AJUSTE}) AS ajuste
      FROM "AsientoRenglon" r JOIN "Asiento" a ON a."id" = r."asientoId"
      WHERE a."empresaId" = ${this.tenant.empresaId}::uuid AND a."ejercicioId" = ${ej.id}::uuid AND a."fecha" <= ${fecha}
        AND a."tipo" NOT IN ('REFUNDICION', 'CIERRE') AND ${excluirApertura}
      GROUP BY 1, 2, 3, 5`;
    const movimientos = filas.filter((f) => !f.ajuste).map((f) => ({ cuentaId: f.cuentaId, mes: { anio: f.anio, mes: f.mes }, saldo: new D(f.saldo) }));
    const ajustesPrevios = new Map<string, Dec>();
    for (const f of filas.filter((x) => x.ajuste)) ajustesPrevios.set(f.cuentaId, (ajustesPrevios.get(f.cuentaId) ?? new D(0)).plus(f.saldo));
    let anticuacion: Map<string, Tramo[]> | null = null;
    if (esPrimero) {
      anticuacion = new Map();
      for (const t of await tx.anticuacionApertura.findMany({ orderBy: [{ anio: 'asc' }, { mes: 'asc' }] }))
        anticuacion.set(t.cuentaContableId, [...(anticuacion.get(t.cuentaContableId) ?? []), { mes: { anio: t.anio, mes: t.mes }, importe: new D(t.importe) }]);
    }
    const B = mesAnterior(mesDe(ej.desde));
    const M = mesDe(fecha);
    const indices = await indicesPara(tx, mesesNecesarios({ B, M, anticuacion, movimientos }));
    const cuentas = await tx.cuentaContable.findMany({ orderBy: { codigo: 'asc' } });
    cuentas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    const r = calcular({ B, M, cuentas, recpamId, rnaId, apertura, anticuacion, movimientos, ajustesPrevios, indices });
    return { ejercicio: ej, fecha, cuentas: r.cuentas, renglones: r.renglones, recpam: r.recpam.toFixed(2), avisos: r.avisos };
  }

  async previa(fecha: Date) {
    const r = await this.calcular(this.tenant.db, fecha);
    return { ...r, ejercicio: { id: r.ejercicio.id, numero: r.ejercicio.numero } };
  }

  static descripcion(fecha: Date) {
    return `Ajuste por inflación al ${fechaAR(fecha)}`;
  }
}
