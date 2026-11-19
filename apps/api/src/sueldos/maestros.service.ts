import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizarCuit, validarCuit } from '@gestion/shared';
import { Empleado, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { filasCsv, numeroAR } from '../comun/csv';
import { NumeracionService } from '../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { DatosConcepto, DatosEmpleado } from './dto';
import { codigoArcaPorDefecto, RENGLONES_FIJOS, validarCodigoArca } from './lsd-conceptos';

const D = Prisma.Decimal;
const dia = (f: Date | null) => (f ? f.toISOString().slice(0, 10) : null);
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);

/** Básico vigente de cada categoría al mes: la escala más reciente con (anio, mes) ≤ el mes. */
export async function basicosVigentes(tx: TxEmpresa, categoriaIds: string[], anio: number, mes: number): Promise<Map<string, Prisma.Decimal>> {
  const escalas = await tx.escala.findMany({ where: { categoriaId: { in: categoriaIds }, OR: [{ anio: { lt: anio } }, { anio, mes: { lte: mes } }] }, orderBy: [{ anio: 'desc' }, { mes: 'desc' }] });
  const r = new Map<string, Prisma.Decimal>();
  for (const e of escalas) if (!r.has(e.categoriaId)) r.set(e.categoriaId, new D(e.basico));
  return r;
}

/** Tope indemnizatorio del convenio vigente en el período (la vigencia más reciente ≤ período). */
export async function topeVigente(tx: TxEmpresa, convenioId: string, anio: number, mes: number): Promise<Prisma.Decimal | null> {
  const t = await tx.topeIndemnizatorio.findFirst({ where: { convenioId, OR: [{ desdeAnio: { lt: anio } }, { desdeAnio: anio, desdeMes: { lte: mes } }] }, orderBy: [{ desdeAnio: 'desc' }, { desdeMes: 'desc' }] });
  return t?.importe ?? null;
}

export const empleadoSalida = (e: Empleado) => ({ ...e, fechaIngreso: dia(e.fechaIngreso), fechaEgreso: dia(e.fechaEgreso) });

@Injectable()
export class MaestrosSueldosService {
  constructor(private readonly tenant: TenantPrisma, private readonly numeracion: NumeracionService) {}

  async convenios() {
    return this.tenant.db.convenio.findMany({ orderBy: { nombre: 'asc' }, include: { categorias: { orderBy: { orden: 'asc' } } } });
  }

  crearConvenio(d: { nombre: string; codigo: string; horasMensuales: number }) {
    return this.tenant.db.convenio.create({ data: { ...d, empresaId: this.tenant.empresaId } });
  }

  async modificarConvenio(id: string, d: { nombre: string; codigo: string; horasMensuales: number; activo?: boolean }) {
    if (!(await this.tenant.db.convenio.findUnique({ where: { id } }))) throw new NotFoundException('Convenio inexistente');
    return this.tenant.db.convenio.update({ where: { id }, data: d });
  }

  async crearCategoria(d: { convenioId: string; nombre: string; orden: number }) {
    if (!(await this.tenant.db.convenio.findUnique({ where: { id: d.convenioId } }))) throw new BadRequestException('Convenio inexistente');
    return this.tenant.db.categoria.create({ data: { ...d, empresaId: this.tenant.empresaId } });
  }

  async modificarCategoria(id: string, d: { nombre: string; orden: number; activa?: boolean }) {
    if (!(await this.tenant.db.categoria.findUnique({ where: { id } }))) throw new NotFoundException('Categoría inexistente');
    return this.tenant.db.categoria.update({ where: { id }, data: { nombre: d.nombre, orden: d.orden, activa: d.activa } });
  }

  /** Categorías del convenio con su básico vigente en el mes (null si no hay escala). */
  topeVigente(tx: TxEmpresa, convenioId: string, anio: number, mes: number) { return topeVigente(tx, convenioId, anio, mes); }

  async topes(convenioId: string | undefined, anio?: number, mes?: number) {
    if (!convenioId) throw new BadRequestException('Indique el convenio');
    const topes = (await this.tenant.db.topeIndemnizatorio.findMany({ where: { convenioId }, orderBy: [{ desdeAnio: 'desc' }, { desdeMes: 'desc' }] })).map((t) => ({ ...t, importe: t.importe.toFixed(2) }));
    const vigente = anio && mes ? (await this.topeVigente(this.tenant.db, convenioId, anio, mes))?.toFixed(2) ?? null : undefined;
    return { topes, ...(vigente !== undefined ? { vigente } : {}) };
  }

  async guardarTope(d: { convenioId: string; desdeAnio: number; desdeMes: number; importe: number }) {
    if (!(await this.tenant.db.convenio.findUnique({ where: { id: d.convenioId } }))) throw new BadRequestException('Convenio inexistente');
    const actual = await this.tenant.db.topeIndemnizatorio.findFirst({ where: { convenioId: d.convenioId, desdeAnio: d.desdeAnio, desdeMes: d.desdeMes } });
    if (actual) await this.tenant.db.topeIndemnizatorio.update({ where: { id: actual.id }, data: { importe: d.importe } });
    else await this.tenant.db.topeIndemnizatorio.create({ data: { ...d, empresaId: this.tenant.empresaId } });
    return this.topes(d.convenioId);
  }

  async escalas(convenioId: string | undefined, anio: number, mes: number) {
    if (!convenioId) throw new BadRequestException('Indique el convenio');
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Mes inválido');
    const cats = await this.tenant.db.categoria.findMany({ where: { convenioId }, orderBy: { orden: 'asc' } });
    const vig = await basicosVigentes(this.tenant.db, cats.map((c) => c.id), anio, mes);
    const delMes = new Set((await this.tenant.db.escala.findMany({ where: { categoriaId: { in: cats.map((c) => c.id) }, anio, mes } })).map((e) => e.categoriaId));
    return cats.map((c) => ({ categoriaId: c.id, categoria: c.nombre, basico: vig.get(c.id)?.toFixed(2) ?? null, delMes: delMes.has(c.id) }));
  }

  async guardarEscala(d: { categoriaId: string; anio: number; mes: number; basico: number }) {
    if (!(await this.tenant.db.categoria.findUnique({ where: { id: d.categoriaId } }))) throw new BadRequestException('Categoría inexistente');
    const r = await this.tenant.db.escala.upsert({
      where: { categoriaId_anio_mes: { categoriaId: d.categoriaId, anio: d.anio, mes: d.mes } },
      create: { ...d, empresaId: this.tenant.empresaId }, update: { basico: d.basico },
    });
    return { ...r, basico: new D(r.basico).toFixed(2) };
  }

  /** Importa escalas (Categoría; MM/AAAA; Básico) de un CSV o XLSX. Todo o nada. */
  async importarEscalas(convenioId: string | undefined, contenido: Buffer | undefined, nombre: string) {
    if (!convenioId) throw new BadRequestException('Indique el convenio');
    if (!contenido?.length) throw new BadRequestException('Adjunte el archivo');
    let filas: { celdas: string[]; numerico: boolean; sep?: string }[] = [];
    if (/\.xlsx$/i.test(nombre)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(contenido as unknown as ArrayBuffer);
      wb.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
        const v = (row.values as unknown[]).slice(1);
        const txt = (x: unknown) => (x instanceof Date ? `${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}` : x === null || x === undefined ? '' : String(typeof x === 'object' && 'result' in (x as object) ? (x as { result: unknown }).result : x));
        filas[row.number - 1] = { celdas: v.map((x) => txt(x).trim()), numerico: typeof v[2] === 'number' };
      });
      filas = Array.from(filas, (f) => f ?? { celdas: [], numerico: false });
    } else filas = filasCsv(contenido.toString('utf8')).map((f) => ({ celdas: [...f].map((x) => x.trim()), numerico: false, sep: f.sep }));
    return this.tenant.transaccion(async (tx) => {
      const cats = new Map((await tx.categoria.findMany({ where: { convenioId } })).map((c) => [c.nombre.toLowerCase(), c]));
      const errores: { linea: number; mensaje: string }[] = [];
      const datos: { categoriaId: string; anio: number; mes: number; basico: Prisma.Decimal }[] = [];
      filas.forEach((f, i) => {
        const [cat = '', periodo = '', importe = ''] = f.celdas;
        if (!cat && !periodo) return;
        if (i === 0 && !/\d/.test(importe)) return; // encabezado
        const linea = i + 1;
        const c = cats.get(cat.toLowerCase());
        if (!c) return errores.push({ linea, mensaje: `Categoría inexistente: ${cat}` });
        const m = /^(\d{2})\/(\d{4})$/.exec(periodo) ?? /^(\d{4})-(\d{2})$/.exec(periodo);
        if (!m) return errores.push({ linea, mensaje: `Período inválido: ${periodo}` });
        const [anio, mes] = periodo.includes('/') ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
        const n = numeroAR(importe, f.numerico || (f.sep === ',' && !importe.includes(',')));
        if (n === null || mes < 1 || mes > 12) return errores.push({ linea, mensaje: `Básico inválido: ${importe}` });
        datos.push({ categoriaId: c.id, anio, mes, basico: new D(n).toDecimalPlaces(2) });
      });
      if (errores.length) throw new BadRequestException({ statusCode: 400, message: 'El archivo tiene errores: no se importó nada', errores });
      for (const d of datos)
        await tx.escala.upsert({ where: { categoriaId_anio_mes: { categoriaId: d.categoriaId, anio: d.anio, mes: d.mes } }, create: { ...d, empresaId: this.tenant.empresaId }, update: { basico: d.basico } });
      return { importadas: datos.length };
    });
  }

  async empleados() {
    const es = await this.tenant.db.empleado.findMany({ orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }] });
    const cats = new Map((await this.tenant.db.categoria.findMany()).map((c) => [c.id, c.nombre]));
    return es.map((e) => ({ ...empleadoSalida(e), categoria: cats.get(e.categoriaId) ?? '' }));
  }

  private async validarEmpleado(tx: TxEmpresa, d: Partial<DatosEmpleado>, id?: string) {
    if (d.cuil !== undefined) {
      if (!validarCuit(d.cuil)) throw new BadRequestException('CUIL inválido');
      const otro = await tx.empleado.findFirst({ where: { cuil: normalizarCuit(d.cuil), ...(id ? { id: { not: id } } : {}) } });
      if (otro) throw new BadRequestException(`Ya existe el legajo ${otro.legajo} con ese CUIL`);
    }
    if (d.categoriaId && !(await tx.categoria.findUnique({ where: { id: d.categoriaId } }))) throw new BadRequestException('Categoría inexistente');
    if (d.fechaIngreso && d.fechaEgreso && d.fechaEgreso < d.fechaIngreso) throw new BadRequestException('El egreso no puede ser anterior al ingreso');
  }

  private datos(d: Partial<DatosEmpleado>) {
    const { fechaIngreso, fechaEgreso, cuil, ...resto } = d;
    return {
      ...resto, ...(cuil !== undefined ? { cuil: normalizarCuit(cuil) } : {}),
      ...(fechaIngreso ? { fechaIngreso: aFecha(fechaIngreso) } : {}), ...(fechaEgreso !== undefined ? { fechaEgreso: fechaEgreso ? aFecha(fechaEgreso) : null } : {}),
    };
  }

  crearEmpleado(d: DatosEmpleado) {
    return this.tenant.transaccion(async (tx) => {
      await this.validarEmpleado(tx, d);
      const legajo = await this.numeracion.siguiente(tx, 'LEGAJO', 0);
      const e = await tx.empleado.create({ data: { ...(this.datos(d) as Prisma.EmpleadoUncheckedCreateInput), legajo, empresaId: this.tenant.empresaId } });
      return empleadoSalida(e);
    });
  }

  modificarEmpleado(id: string, d: Partial<DatosEmpleado>) {
    return this.tenant.transaccion(async (tx) => {
      const actual = await tx.empleado.findUnique({ where: { id } });
      if (!actual) throw new NotFoundException('Empleado inexistente');
      await this.validarEmpleado(tx, { fechaIngreso: dia(actual.fechaIngreso)!, ...d }, id);
      if (d.fechaEgreso !== undefined && (d.fechaEgreso ?? null) !== dia(actual.fechaEgreso) && (await tx.egresoEmpleado.count({ where: { empleadoId: id } })))
        throw new BadRequestException('La fecha de egreso se cambia desde la liquidación final');
      return empleadoSalida(await tx.empleado.update({ where: { id }, data: this.datos(d) as Prisma.EmpleadoUncheckedUpdateInput }));
    });
  }

  conceptos() {
    return this.tenant.db.concepto.findMany({ orderBy: [{ orden: 'asc' }, { codigo: 'asc' }] });
  }

  private async validarCuentaConcepto(cuentaContableId: string | null | undefined) {
    if (!cuentaContableId) return;
    const c = await this.tenant.db.cuentaContable.findUnique({ where: { id: cuentaContableId } });
    if (!c || !c.imputable || !c.activa) throw new BadRequestException('Cuenta contable inválida: debe ser imputable y activa');
  }

  /** Avisos de configuración de los conceptos (E22 §2.16). */
  async avisosConceptos(): Promise<string[]> {
    const vac = await this.tenant.db.concepto.findMany({ where: { tipo: 'VACACIONES', activo: true } });
    const pago = vac.some((c) => (c.parametros as Record<string, unknown>)?.descuenta !== true);
    const descuento = vac.some((c) => (c.parametros as Record<string, unknown>)?.descuenta === true);
    const avisos = pago && descuento ? [] : ['Faltan los conceptos de vacaciones (pago y descuento): las vacaciones no se liquidan'];
    // Ganancias de cuarta (E31 §6): descuentos manuales de ganancias cargados antes del cálculo automático
    const viejos = await this.tenant.db.concepto.findMany({ where: { activo: true, clase: 'DESCUENTO', tipo: { notIn: ['GANANCIAS', 'GANANCIAS_AJUSTE'] }, nombre: { contains: 'ganancia', mode: 'insensitive' } }, orderBy: { codigo: 'asc' } });
    for (const c of viejos) avisos.push(`El concepto ${c.codigo} ${c.nombre} parece una retención de Ganancias cargada a mano: sume lo retenido en el acumulado previo de cada empleado y desactívelo`);
    const porDefecto = await this.tenant.db.concepto.findMany({ where: { activo: true, exentoGanancias: true, rubroExentoPorDefecto: true }, orderBy: { codigo: 'asc' } });
    if (porDefecto.length) avisos.push(`Revise el rubro exento de Ganancias de los conceptos ${porDefecto.map((c) => `${c.codigo} ${c.nombre}`).join(', ')}`);
    return avisos;
  }

  async crearConcepto(d: DatosConcepto) {
    if (await this.tenant.db.concepto.findFirst({ where: { codigo: d.codigo } })) throw new BadRequestException(`Ya existe el concepto ${d.codigo}`);
    this.validarCodigoLibre(d.codigo);
    await this.validarCuentaConcepto(d.cuentaContableId);
    const codigoArca = d.codigoArca || codigoArcaPorDefecto(d);
    this.validarArca(codigoArca, d.clase);
    this.validarRubro(d);
    return this.tenant.db.concepto.create({ data: { ...d, rubroExentoGanancias: d.exentoGanancias ? d.rubroExentoGanancias : null, codigoArca, parametros: d.parametros as Prisma.InputJsonValue, empresaId: this.tenant.empresaId } });
  }

  async modificarConcepto(id: string, d: DatosConcepto) {
    const actual = await this.tenant.db.concepto.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Concepto inexistente');
    if (d.codigo !== actual.codigo) this.validarCodigoLibre(d.codigo);
    if (await this.tenant.db.configuracionSueldos.findFirst({ where: { conceptoComisionesId: id } })) {
      // Solo se bloquea pasar de activo a inactivo (uno que ya estaba inactivo se puede editar), E29 §2.2
      if (actual.activo && d.activo === false)
        throw new BadRequestException('Es el concepto de comisiones de vendedores: elija otro en la configuración de sueldos antes de desactivarlo');
      // Tiene que seguir sirviendo para las comisiones (E29 §2.1)
      if (d.tipo !== 'FIJO' || d.clase === 'DESCUENTO' || d.convenioId || d.soloAfiliados)
        throw new BadRequestException('Es el concepto de comisiones de vendedores: debe seguir siendo fijo, sin convenio, para todos los empleados y no de descuento');
    }
    await this.validarCuentaConcepto(d.cuentaContableId);
    // Sin código ARCA se conserva el actual; si cambió la clase y ya no corresponde, se toma el de defecto
    const codigoArca = d.codigoArca || (validarCodigoArca(actual.codigoArca, d.clase) ? codigoArcaPorDefecto(d) : actual.codigoArca);
    this.validarArca(codigoArca, d.clase);
    this.validarRubro(d);
    return this.tenant.db.concepto.update({ where: { id }, data: { ...d, rubroExentoGanancias: d.exentoGanancias ? d.rubroExentoGanancias : null, rubroExentoPorDefecto: false, codigoArca, parametros: d.parametros as Prisma.InputJsonValue } });
  }

  /** Los códigos de los renglones fijos del cálculo (SAC y final) no se usan en conceptos: chocarían en el Libro (revisión E30). */
  private validarCodigoLibre(codigo: string) {
    if (RENGLONES_FIJOS.some((r) => r.codigo === codigo.trim())) throw new BadRequestException(`El código ${codigo.trim()} está reservado para los renglones del cálculo (SAC y liquidación final)`);
  }

  /** Un concepto exento de Ganancias necesita su rubro del registro 04 del F.1359 (E32 §7). */
  private validarRubro(d: DatosConcepto) {
    if (d.exentoGanancias && !d.rubroExentoGanancias) throw new BadRequestException('Elija el rubro exento de Ganancias');
  }

  private validarArca(codigo: string, clase: DatosConcepto['clase']) {
    const error = validarCodigoArca(codigo, clase);
    if (error) throw new BadRequestException(error);
  }
}
