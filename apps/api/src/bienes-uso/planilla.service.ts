import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ORIGEN_AJUSTE } from '../contabilidad/ajuste-inflacion/ajuste-inflacion.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { mesDe } from './calculo';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const CAMPOS = ['origenInicio', 'altas', 'bajas', 'origenCierre', 'amortInicio', 'amortBajas', 'amortEjercicio', 'amortCierre', 'neto'] as const;
type Campo = (typeof CAMPOS)[number];
type Importes = Record<Campo, Dec>;
const vacio = (): Importes => Object.fromEntries(CAMPOS.map((c) => [c, new D(0)])) as Importes;
const texto = (x: Importes) => Object.fromEntries(CAMPOS.map((c) => [c, x[c].toFixed(2)])) as Record<Campo, string>;
const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

@Injectable()
export class PlanillaService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Planilla anexa de bienes de uso de un ejercicio a una fecha (spec §7). */
  async planilla(q: { ejercicioId?: string; fecha?: string; reexpresar?: string }) {
    const db = this.tenant.db;
    if (!q.ejercicioId) throw new BadRequestException('Indique el ejercicio');
    const ej = await db.ejercicio.findUnique({ where: { id: q.ejercicioId } });
    if (!ej) throw new NotFoundException('Ejercicio no encontrado');
    const fecha = q.fecha ? new Date(`${q.fecha}T00:00:00Z`) : ej.hasta;
    if (Number.isNaN(fecha.getTime()) || fecha < ej.desde || fecha > ej.hasta) throw new BadRequestException('La fecha debe estar dentro del ejercicio');
    const mesDesde = mesDe(ej.desde), mesF = mesDe(fecha);
    // La amortización de un mes se registra el último día: a mitad de mes todavía no está en el Mayor
    const finDeMes = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)).getTime() === fecha.getTime();
    const hastaMes = (m: string) => (finDeMes ? m <= mesF : m < mesF);

    const bienes = await db.bienUso.findMany({
      where: { fechaAlta: { lte: fecha }, OR: [{ fechaBaja: null }, { fechaBaja: { gte: ej.desde } }] },
      include: { rubro: true, amortizaciones: { where: { proceso: { estado: 'VIGENTE' } } } }, orderBy: { numero: 'asc' },
    });

    // Reexpresión: coeficiente I(mes de la fecha) / I(mes de alta) por bien
    let aviso: string | undefined;
    let coef = (_m: string) => new D(1);
    if (q.reexpresar === 'true' && bienes.length) {
      const indices = new Map((await db.indiceInflacion.findMany()).map((i) => [`${i.anio}-${String(i.mes).padStart(2, '0')}`, new D(i.valor)]));
      const faltan = [...new Set([mesF, ...bienes.map((b) => mesDe(b.fechaAlta))])].filter((m) => !indices.has(m)).sort();
      if (faltan.length) aviso = `Faltan los índices de: ${faltan.map(mmaaaa).join(', ')}: se muestran importes nominales`;
      else coef = (m: string) => indices.get(mesF)!.div(indices.get(m)!);
    }

    const porRubro = new Map<string, { nombre: string; origenId: string; amortId: string; x: Importes }>();
    for (const b of bienes) {
      const r = porRubro.get(b.rubroId) ?? { nombre: b.rubro.nombre, origenId: b.rubro.cuentaOrigenId, amortId: b.rubro.cuentaAmortizacionId, x: vacio() };
      const k = coef(mesDe(b.fechaAlta));
      const v = new D(b.valorOrigen).times(k);
      const alInicio = b.fechaAlta < ej.desde;
      const bajaEnPeriodo = b.fechaBaja && b.fechaBaja <= fecha;
      const antes = b.amortizaciones.filter((a) => a.mes < mesDesde).reduce((s, a) => s.plus(a.importe), new D(0)).plus(alInicio ? b.amortizacionInicial : 0);
      const enEjercicio = b.amortizaciones.filter((a) => a.mes >= mesDesde && hastaMes(a.mes)).reduce((s, a) => s.plus(a.importe), new D(0)).plus(alInicio ? 0 : b.amortizacionInicial);
      if (alInicio) { r.x.origenInicio = r.x.origenInicio.plus(v); r.x.amortInicio = r.x.amortInicio.plus(antes.times(k)); }
      else r.x.altas = r.x.altas.plus(v);
      r.x.amortEjercicio = r.x.amortEjercicio.plus(enEjercicio.times(k));
      if (bajaEnPeriodo) {
        r.x.bajas = r.x.bajas.minus(v);
        r.x.amortBajas = r.x.amortBajas.minus(antes.plus(enEjercicio).times(k));
      }
      porRubro.set(b.rubroId, r);
    }
    const tot = vacio();
    const cerrar = (x: Importes) => {
      for (const c of CAMPOS) x[c] = x[c].toDecimalPlaces(2);
      x.origenCierre = x.origenInicio.plus(x.altas).plus(x.bajas);
      x.amortCierre = x.amortInicio.plus(x.amortEjercicio).plus(x.amortBajas);
      x.neto = x.origenCierre.minus(x.amortCierre);
      return x;
    };
    const filas = [...porRubro].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre)).map(([rubroId, r]) => {
      const x = cerrar(r.x);
      for (const c of CAMPOS) tot[c] = tot[c].plus(x[c]);
      return { rubroId, rubro: r.nombre, ...texto(x) };
    });

    // Control con el Mayor (nominal): saldos de las cuentas de los rubros a la fecha, sin el ajuste por inflación
    const control = { origen: new D(0), amortizacion: new D(0) };
    if (!aviso && q.reexpresar !== 'true') {
      const saldo = async (cuentaId: string) => {
        const s = await db.asientoRenglon.aggregate({ where: { cuentaContableId: cuentaId, asiento: { ejercicioId: ej.id, fecha: { lte: fecha }, origenTipo: { not: ORIGEN_AJUSTE }, tipo: { notIn: ['CIERRE', 'REFUNDICION'] } } }, _sum: { debe: true, haber: true } });
        // La apertura trae los ajustes por inflación de ejercicios anteriores: se descuentan para comparar en nominal
        const previos = await db.asientoRenglon.aggregate({ where: { cuentaContableId: cuentaId, asiento: { origenTipo: ORIGEN_AJUSTE, fecha: { lt: ej.desde } } }, _sum: { debe: true, haber: true } });
        return new D(s._sum.debe ?? 0).minus(s._sum.haber ?? 0).minus(new D(previos._sum.debe ?? 0).minus(previos._sum.haber ?? 0));
      };
      for (const [, r] of porRubro) {
        control.origen = control.origen.plus((await saldo(r.origenId)).minus(r.x.origenCierre));
        control.amortizacion = control.amortizacion.plus((await saldo(r.amortId)).neg().minus(r.x.amortCierre));
      }
    }
    return {
      ejercicio: { id: ej.id, numero: ej.numero }, fecha: fecha.toISOString().slice(0, 10), ...(aviso ? { aviso } : {}),
      filas, totales: texto(tot), control: { origen: control.origen.toFixed(2), amortizacion: control.amortizacion.toFixed(2) },
    };
  }
}
