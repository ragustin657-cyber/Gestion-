import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { mesDe } from './calculo';
import { amortizacionImpositiva, BienImpositivo, ejerciciosFiscales, mesesQueActualiza, ResultadoImpositivo } from './impositiva';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const TOTALES = ['cuota', 'noDeducible', 'deducible', 'contable', 'diferencia', 'valorResidual'] as const;
type Totales = Record<(typeof TOTALES)[number], Dec>;
const vacio = (): Totales => Object.fromEntries(TOTALES.map((k) => [k, new D(0)])) as Totales;
const texto = (t: Totales) => Object.fromEntries(TOTALES.map((k) => [k, t[k].toFixed(2)])) as Record<(typeof TOTALES)[number], string>;
const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** Vida útil de los inmuebles sin vida impositiva cargada: 2 % anual (art. 83). */
const VIDA_INMUEBLES = 50;

@Injectable()
export class PlanillaImpositivaService {
  constructor(private readonly tenant: TenantPrisma) {}

  /** Planilla de amortización impositiva de un ejercicio (spec E44 §4): calculada al vuelo, sin asientos. */
  async planilla(q: { ejercicioId?: string }) {
    const db = this.tenant.db;
    if (!q.ejercicioId) throw new BadRequestException('Indique el ejercicio');
    const ej = await db.ejercicio.findUnique({ where: { id: q.ejercicioId } });
    if (!ej) throw new NotFoundException('Ejercicio no encontrado');
    const bienes = await db.bienUso.findMany({
      where: { fechaAlta: { lte: ej.hasta }, OR: [{ fechaBaja: null }, { fechaBaja: { gte: ej.desde } }] },
      include: { rubro: true, amortizaciones: { where: { proceso: { estado: 'VIGENTE' } } } }, orderBy: { numero: 'asc' },
    });
    const config = await db.configImpuestos.findFirst();
    const delSistema = (await db.ejercicio.findMany({ orderBy: { desde: 'asc' } })).map((e) => ({ desde: e.desde, hasta: e.hasta }));
    const desde = bienes.reduce((m, b) => (b.fechaAlta < m ? b.fechaAlta : m), ej.desde);
    const ejercicios = ejerciciosFiscales(delSistema, desde);
    const ejercicio = { desde: ej.desde, hasta: ej.hasta };

    const avisoVida = new Set<string>();
    const sinTerreno: string[] = [];
    const datos = bienes.map((b) => {
      const tipo = b.rubro.tipoImpositivo;
      let vida = b.vidaUtilImpositivaAnios ?? b.rubro.vidaUtilImpositivaAnios;
      if (vida == null) {
        if (tipo === 'INMUEBLE') vida = VIDA_INMUEBLES;
        else { vida = Math.ceil(b.vidaUtilMeses / 12); if (tipo !== 'NO_AMORTIZABLE') avisoVida.add(b.rubro.nombre); }
      }
      if (tipo === 'INMUEBLE' && new D(b.valorTerreno).isZero()) sinTerreno.push(`${b.numero} ${b.descripcion}`);
      const bi: BienImpositivo = { fechaAlta: b.fechaAlta, fechaBaja: b.fechaBaja, valorOrigen: new D(b.valorOrigen), valorTerreno: new D(b.valorTerreno), tipo, vidaUtilAnios: vida };
      return { b, bi };
    });

    // Índices: solo los de los bienes que se actualizan
    const necesarios = [...new Set(datos.flatMap(({ bi }) => mesesQueActualiza(bi, ejercicio, ejercicios)))];
    const indices = new Map<string, Dec>();
    if (necesarios.length) for (const i of await db.indiceInflacion.findMany()) indices.set(`${i.anio}-${String(i.mes).padStart(2, '0')}`, new D(i.valor));
    const faltan = necesarios.filter((m) => !indices.has(m)).sort();
    if (faltan.length) throw new BadRequestException(`Faltan los índices de: ${faltan.map(mmaaaa).join(', ')}`);
    const ctx = { ejercicios, indice: (m: string) => indices.get(m)!, topeAutomoviles: new D(config?.topeAutomovilesCosto ?? 20000) };

    const mesDesde = mesDe(ej.desde), mesHasta = mesDe(ej.hasta);
    const porRubro = new Map<string, { rubro: string; bienes: ReturnType<typeof fila>[]; t: Totales }>();
    const tot = vacio();
    const fila = (b: (typeof bienes)[number], vida: number, r: ResultadoImpositivo, contable: Dec) => {
      const deducible = r.cuota.minus(r.noDeducible);
      return {
        numero: b.numero, descripcion: b.descripcion, fechaAlta: dia(b.fechaAlta), fechaBaja: dia(b.fechaBaja), tipo: b.rubro.tipoImpositivo, vidaUtilAnios: vida,
        valorOrigen: new D(b.valorOrigen).toFixed(2), actualiza: r.actualiza, coeficiente: r.coeficiente.toFixed(4), valorActualizado: r.valorActualizado.toFixed(2),
        aniosAnteriores: r.aniosAnteriores, acumuladaAnterior: r.acumuladaAnterior.toFixed(2), cuota: r.cuota.toFixed(2), noDeducible: r.noDeducible.toFixed(2),
        acumuladaCierre: r.acumuladaCierre.toFixed(2), valorResidual: r.valorResidual.toFixed(2), costoComputableBaja: r.costoComputableBaja?.toFixed(2) ?? null,
        contable: contable.toFixed(2), diferencia: deducible.minus(contable).toFixed(2),
      };
    };
    for (const { b, bi } of datos) {
      const r = amortizacionImpositiva(bi, ejercicio, ctx);
      // Contable del ejercicio, nominal (decisión de la spec): procesos vigentes y la inicial si cae en el ejercicio
      // La amortización inicial es la acumulada a la carga: solo cuenta en el ejercicio si el alta es del ejercicio (como la planilla contable; revisión E44)
      const inicial = b.fechaAlta >= ej.desde ? new D(b.amortizacionInicial) : new D(0);
      const contable = b.amortizaciones.filter((a) => a.mes >= mesDesde && a.mes <= mesHasta).reduce((s, a) => s.plus(a.importe), inicial);
      const g = porRubro.get(b.rubroId) ?? { rubro: b.rubro.nombre, bienes: [], t: vacio() };
      g.bienes.push(fila(b, bi.vidaUtilAnios, r, contable));
      const deducible = r.cuota.minus(r.noDeducible);
      for (const t of [g.t, tot]) {
        t.cuota = t.cuota.plus(r.cuota); t.noDeducible = t.noDeducible.plus(r.noDeducible); t.deducible = t.deducible.plus(deducible);
        t.contable = t.contable.plus(contable); t.diferencia = t.diferencia.plus(deducible.minus(contable)); t.valorResidual = t.valorResidual.plus(r.valorResidual);
      }
      porRubro.set(b.rubroId, g);
    }
    const avisos = [
      ...(avisoVida.size ? [`Se usa la vida útil contable de: ${[...avisoVida].sort().join(', ')}`] : []),
      ...(sinTerreno.length ? [`Revise el valor del terreno de: ${sinTerreno.join(', ')}`] : []),
    ];
    return {
      ejercicio: { numero: ej.numero, desde: dia(ej.desde), hasta: dia(ej.hasta) },
      filas: [...porRubro].sort((a, b) => a[1].rubro.localeCompare(b[1].rubro)).map(([rubroId, g]) => ({ rubroId, rubro: g.rubro, bienes: g.bienes, subtotal: texto(g.t) })),
      totales: texto(tot), avisos,
    };
  }
}
