import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { filasCsv, numeroAR } from '../comun/csv';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { repartir } from './calculo';
import { mesesDelEjercicio, mesTexto, mmaaaa, PresupuestosService } from './presupuestos.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const RESULTADOS = ['RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO'];

/** Texto de una celda de Excel (resultado de fórmulas incluido). */
function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v && 'result' in v) return celda((v as { result: unknown }).result);
  if (typeof v === 'object' && v && 'richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  return String(v);
}

@Injectable()
export class CargaPresupuestoService {
  constructor(private readonly tenant: TenantPrisma, private readonly presupuestos: PresupuestosService) {}

  repartir(id: string, d: { cuentaContableId: string; centroCostoId?: string | null; total: number }) {
    return this.tenant.transaccion(async (tx) => {
      const { ejercicio } = await this.presupuestos.presupuesto(tx, id, true);
      const meses = mesesDelEjercicio(ejercicio);
      await this.presupuestos.validarLinea(tx, ejercicio, { cuentaContableId: d.cuentaContableId, centroCostoId: d.centroCostoId, meses: [] });
      await this.presupuestos.reemplazarLinea(tx, id, d.cuentaContableId, d.centroCostoId ?? null, repartir(new D(d.total), meses));
      return this.presupuestos.grilla(id, tx);
    });
  }

  /** Reemplaza el presupuesto por el real del ejercicio anterior (mes i → mes i) con un % de ajuste; negativos en 0. */
  desdeReal(id: string, ajustePct: number) {
    return this.tenant.transaccion(async (tx) => {
      const { ejercicio } = await this.presupuestos.presupuesto(tx, id, true);
      const anterior = await tx.ejercicio.findFirst({ where: { hasta: { lt: ejercicio.desde } }, orderBy: { hasta: 'desc' } });
      if (!anterior) throw new BadRequestException('No hay un ejercicio anterior');
      const mesesAnt = mesesDelEjercicio(anterior), meses = mesesDelEjercicio(ejercicio);
      const filas = await tx.$queryRaw<{ cuentaId: string; centroId: string | null; anio: number; mes: number; debe: Prisma.Decimal; haber: Prisma.Decimal; tipo: string }[]>`
        SELECT r."cuentaContableId" AS "cuentaId", r."centroCostoId" AS "centroId", EXTRACT(YEAR FROM a."fecha")::int AS anio, EXTRACT(MONTH FROM a."fecha")::int AS mes,
               SUM(r."debe") AS debe, SUM(r."haber") AS haber, c."tipo"::text AS tipo
        FROM "AsientoRenglon" r JOIN "Asiento" a ON a."id" = r."asientoId" JOIN "CuentaContable" c ON c."id" = r."cuentaContableId"
        WHERE a."empresaId" = ${this.tenant.empresaId}::uuid AND a."ejercicioId" = ${anterior.id}::uuid
          AND a."tipo" NOT IN ('REFUNDICION', 'CIERRE', 'APERTURA') AND a."origenTipo" <> 'AJUSTE_INFLACION'
          AND c."tipo" IN ('RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO')
        GROUP BY 1, 2, 3, 4, 7`;
      const factor = new D(1).plus(new D(ajustePct).div(100));
      await tx.presupuestoImporte.deleteMany({ where: { presupuestoId: id } });
      const data: Prisma.PresupuestoImporteCreateManyInput[] = [];
      for (const f of filas) {
        const i = mesesAnt.indexOf(mesTexto(f.anio, f.mes));
        if (i < 0 || i >= meses.length) continue;
        const real = f.tipo === 'RESULTADO_POSITIVO' ? new D(f.haber).minus(f.debe) : new D(f.debe).minus(f.haber);
        const importe = real.times(factor).toDecimalPlaces(2);
        if (importe.lte(0)) continue;
        const m = meses[i];
        data.push({ empresaId: this.tenant.empresaId, presupuestoId: id, cuentaContableId: f.cuentaId, centroCostoId: f.centroId, anio: Number(m.slice(0, 4)), mes: Number(m.slice(5, 7)), importe });
      }
      if (data.length) await tx.presupuestoImporte.createMany({ data });
      return this.presupuestos.grilla(id, tx);
    });
  }

  async exportar(id: string): Promise<{ nombre: string; contenido: Buffer }> {
    const g = await this.presupuestos.grilla(id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Presupuesto');
    const centros = new Map((await this.tenant.db.centroCosto.findMany()).map((c) => [c.id, c.codigo]));
    ws.addRow(['Cuenta', 'Centro de costo', ...g.meses.map(mmaaaa), 'Total']).font = { bold: true };
    for (const l of g.lineas) ws.addRow([l.codigo, l.centroCostoId ? centros.get(l.centroCostoId) : '', ...g.meses.map((m) => Number(l.importes[m])), Number(l.total)]);
    ws.getColumn(1).width = 14;
    return { nombre: `presupuesto-${g.presupuesto.nombre}.xlsx`.replace(/[^\w.-]+/g, '-'), contenido: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  /** Importa xlsx o csv (Cuenta, Centro de costo, una columna por mes MM/AAAA o AAAA-MM). Todo o nada. */
  async importar(id: string, contenido: Buffer | undefined, nombre: string) {
    if (!contenido?.length) throw new BadRequestException('Adjunte el archivo');
    let filas: { celdas: string[]; numerico: boolean[]; sep?: string }[];
    if (/\.xlsx$/i.test(nombre)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(contenido as unknown as ArrayBuffer);
      filas = [];
      wb.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
        const v = (row.values as unknown[]).slice(1);
        filas[row.number - 1] = { celdas: v.map((x) => celda(x).trim()), numerico: v.map((x) => typeof x === 'number' || (typeof x === 'object' && !!x && 'result' in x && typeof (x as { result: unknown }).result === 'number')) };
      });
      filas = Array.from(filas, (f) => f ?? { celdas: [], numerico: [] });
    } else {
      filas = filasCsv(contenido.toString('utf8')).map((f) => ({ celdas: [...f].map((x) => x.trim()), numerico: [], sep: f.sep }));
    }
    return this.tenant.transaccion(async (tx) => {
      const { ejercicio } = await this.presupuestos.presupuesto(tx, id, true);
      const meses = mesesDelEjercicio(ejercicio);
      const iEnc = filas.findIndex((f) => f.celdas.some((c) => c));
      if (iEnc < 0) throw new BadRequestException('El archivo está vacío');
      const columnas = filas[iEnc].celdas.map((c) => {
        const m = /^(\d{2})\/(\d{4})$/.exec(c) ?? /^(\d{4})-(\d{2})$/.exec(c);
        if (!m) return null;
        return c.includes('/') ? `${m[2]}-${m[1]}` : `${m[1]}-${m[2]}`;
      });
      const cuentas = new Map((await tx.cuentaContable.findMany()).map((c) => [c.codigo, c]));
      const centros = new Map((await tx.centroCosto.findMany({ where: { activo: true } })).map((c) => [c.codigo, c]));
      const errores: { linea: number; mensaje: string }[] = [];
      const lineas: { cuentaId: string; centroId: string | null; importes: Record<string, Dec> }[] = [];
      const vistas = new Set<string>();
      for (const m of columnas) if (m && !meses.includes(m)) errores.push({ linea: iEnc + 1, mensaje: `El mes ${mmaaaa(m)} no pertenece al ejercicio` });
      filas.forEach((f, i) => {
        if (i <= iEnc || !f.celdas.some((c) => c)) return;
        const linea = i + 1;
        const [codigo = '', centro = ''] = f.celdas;
        const c = cuentas.get(codigo);
        if (!c) return errores.push({ linea, mensaje: `Cuenta inexistente: ${codigo}` });
        if (!c.imputable || !RESULTADOS.includes(c.tipo)) return errores.push({ linea, mensaje: `La cuenta ${codigo} no es de resultados` });
        const cc = centro ? centros.get(centro) : null;
        if (centro && !cc) return errores.push({ linea, mensaje: `Centro de costo inexistente: ${centro}` });
        const clave = `${c.id}|${cc?.id ?? ''}`;
        if (vistas.has(clave)) return errores.push({ linea, mensaje: 'Línea repetida' });
        vistas.add(clave);
        const importes: Record<string, Dec> = {};
        for (const [j, m] of columnas.entries()) {
          if (!m) continue;
          const t = f.celdas[j] ?? '';
          if (!t || /^0+([.,]0+)?$/.test(t)) continue;
          const n = numeroAR(t, f.numerico[j] || f.sep === ',');
          if (n === null) return errores.push({ linea, mensaje: `Importe inválido en ${mmaaaa(m)}` });
          importes[m] = new D(n).toDecimalPlaces(2);
        }
        lineas.push({ cuentaId: c.id, centroId: cc?.id ?? null, importes });
      });
      if (errores.length) throw new BadRequestException({ statusCode: 400, message: 'El archivo tiene errores: no se importó nada', errores });
      await tx.presupuestoImporte.deleteMany({ where: { presupuestoId: id } });
      for (const l of lineas) await this.presupuestos.reemplazarLinea(tx, id, l.cuentaId, l.centroId, l.importes);
      return this.presupuestos.grilla(id, tx);
    });
  }
}
