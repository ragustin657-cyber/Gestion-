import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma, ReciboSueldoRenglon } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { ContribucionesService } from './contribuciones.service';
import { importesRecibo } from './importes-recibo';
import { RENGLONES_FIJOS } from './lsd-conceptos';
import { Datos03, DatosConceptoLsd, linea, REG01, REG02, REG03, REG04, REG_CONCEPTO } from './lsd-diseno';

const D = Prisma.Decimal;
const iso8 = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const LARGOS: Record<string, number> = { '01': 35, '02': 115, '03': 51, '04': 370 };
/** Renglones fijos con cantidad: unidad del Libro (Anexo III) y factor para llevar la cantidad guardada a esa unidad. */
const CANTIDAD_FIJOS: Record<string, [string, number]> = { 200: ['D', 1], 201: ['D', 1], 300: ['A', 1], 310: ['D', 30], 320: ['D', 1], 330: ['D', 1] };

const archivo = (lineas: string[]) => Buffer.from(lineas.map((l) => `${l}\r\n`).join(''), 'latin1');

/** Archivos de importación del Libro de Sueldos Digital (spec E30). */
@Injectable()
export class LsdService {
  constructor(private readonly tenant: TenantPrisma, private readonly contribuciones: ContribucionesService) {}

  /** Asociación de conceptos (Anexo II): todos los conceptos, activos o no, y los renglones fijos del cálculo. */
  async conceptos() {
    const cs = await this.tenant.db.concepto.findMany({ orderBy: { codigo: 'asc' } });
    const datos: DatosConceptoLsd[] = [
      ...cs.map((c) => ({ codigoArca: c.codigoArca, codigo: c.codigo, descripcion: c.nombre, clase: c.clase })),
      ...RENGLONES_FIJOS.map((r) => ({ codigoArca: r.codigoArca, codigo: r.codigo, descripcion: r.nombre, clase: r.clase })),
    ];
    return { nombre: 'LSD-conceptos.txt', contenido: archivo(datos.map((d) => linea(REG_CONCEPTO, d))) };
  }

  /** Fija el primer número del Libro de una liquidación que todavía no lo tiene (spec E30 §5). */
  async fijarNumero(id: string, numero: number) {
    if (!Number.isInteger(numero) || numero < 1 || numero > 99999) throw new BadRequestException('Número inválido');
    return this.tenant.transaccion(async (tx) => {
      const l = await tx.liquidacion.findUnique({ where: { id } });
      if (!l) throw new NotFoundException('Liquidación inexistente');
      await this.bloquear(tx, l.anio, l.mes);
      if (l.numeroLsd !== null) throw new BadRequestException('La liquidación ya tiene número del Libro');
      if (await tx.liquidacion.findFirst({ where: { anio: l.anio, mes: l.mes, numeroLsd: numero } })) throw new BadRequestException(`El número ${numero} ya está usado en el período`);
      await tx.liquidacion.update({ where: { id }, data: { numeroLsd: numero } });
      return { numeroLsd: numero };
    });
  }

  private bloquear(tx: TxEmpresa, anio: number, mes: number) {
    return tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `lsd:${this.tenant.empresaId}:${anio}:${mes}`);
  }

  /** Archivo de importación de una liquidación cerrada (Anexo III, registros 01 a 04; spec E30 §3 a §6). */
  async liquidacion(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const l = await tx.liquidacion.findUnique({ where: { id } });
      if (!l) throw new NotFoundException('Liquidación inexistente');
      if (l.estado !== 'CERRADA') throw new BadRequestException('Solo se descarga el Libro de una liquidación cerrada');
      // Número del Libro: se asigna en la primera descarga y no cambia (serializado por empresa y período)
      await this.bloquear(tx, l.anio, l.mes);
      let numero = (await tx.liquidacion.findUniqueOrThrow({ where: { id } })).numeroLsd;
      if (numero === null) {
        const max = await tx.liquidacion.aggregate({ where: { anio: l.anio, mes: l.mes }, _max: { numeroLsd: true } });
        numero = (max._max.numeroLsd ?? 0) + 1;
        await tx.liquidacion.update({ where: { id }, data: { numeroLsd: numero } });
      }
      const [empresa, param, vigentes] = await Promise.all([
        tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), this.contribuciones.parametros(tx, l.anio, l.mes), this.contribuciones.vigentes(tx, l.anio, l.mes),
      ]);
      const recibos = (await tx.reciboSueldo.findMany({ where: { liquidacionId: id }, include: { renglones: { orderBy: { orden: 'asc' } } } })).sort((a, b) => a.cuil.localeCompare(b.cuil));
      const empleados = new Map((await tx.empleado.findMany({ where: { id: { in: recibos.map((r) => r.empleadoId) } } })).map((e) => [e.id, e]));
      const sucursales = new Map((await tx.sucursal.findMany()).map((x) => [x.id, x.nombre]));
      const conceptos = new Map((await tx.concepto.findMany()).map((c) => [c.id, c]));
      const fijos = new Map(RENGLONES_FIJOS.map((r) => [r.codigo, r]));
      // En el SAC, los días trabajados del registro 04 son los de la mensual del período (ARCA toma la última liquidación)
      const diasMensual = new Map<string, number>();
      if (l.tipo === 'SAC') {
        const m = await tx.liquidacion.findFirst({ where: { anio: l.anio, mes: l.mes, tipo: 'MENSUAL' } });
        if (m) for (const r of await tx.reciboSueldo.findMany({ where: { liquidacionId: m.id }, select: { empleadoId: true, diasTrabajados: true } })) diasMensual.set(r.empleadoId, r.diasTrabajados);
      }
      const scvo = vigentes.some((c) => c.codigo === 'SCVO' && c.importeFijo.gt(0));
      const ini = new Date(Date.UTC(l.anio, l.mes - 1, 1));
      const esSac = l.tipo === 'SAC';
      const esFinal = l.tipo === 'FINAL';
      const lineas: string[] = [linea(REG01, { cuit: empresa.cuit.replace(/\D/g, ''), periodo: `${l.anio}${String(l.mes).padStart(2, '0')}`, numero, cantidad04: recibos.length })];
      for (const r of recibos) {
        const e = empleados.get(r.empleadoId)!;
        const quien = `${r.apellido}, ${r.nombre}`;
        try {
          const forma = r.formaPago ?? e.formaPago;
          const cbu = (e.cbu ?? '').trim();
          if (forma === 'TRANSFERENCIA' && !/^\d{22}$/.test(cbu)) throw new Error('falta el CBU (22 dígitos) para la acreditación en cuenta');
          const ingresoEnMes = e.fechaIngreso >= ini;
          lineas.push(linea(REG02, {
            cuil: r.cuil.replace(/\D/g, ''), legajo: String(r.legajo), dependencia: e.sucursalId ? sucursales.get(e.sucursalId) ?? '' : '', cbu: forma === 'TRANSFERENCIA' ? cbu : '',
            diasTope: esFinal || (l.tipo === 'MENSUAL' && ingresoEnMes) ? r.diasTrabajados : 0, fechaPago: iso8(l.fechaPago), formaPago: forma === 'TRANSFERENCIA' ? '3' : '1',
          }));
          for (const x of r.renglones.filter((y) => !new D(y.importe).isZero())) lineas.push(linea(REG03, this.renglon03(r.cuil, x, conceptos, fijos, esFinal)));
          const im = importesRecibo(r, l, param, conceptos, { esSac, esFinal });
          lineas.push(linea(REG04, {
            cuil: r.cuil.replace(/\D/g, ''), conyuge: e.conyuge, hijos: e.cantidadHijos, cct: e.trabajadorConvencionado, scvo, tipoEmpresa: empresa.tipoEmpresaSicoss,
            situacion: e.codigoSituacion, condicion: e.codigoCondicion, actividad: e.codigoActividad, modalidad: e.codigoModalidad, siniestrado: e.codigoSiniestrado,
            zona: e.codigoZona ?? empresa.codigoZonaSicoss, diaInicio: ingresoEnMes ? e.fechaIngreso.getUTCDate() : 1, dias: esSac ? diasMensual.get(e.id) ?? 0 : r.diasTrabajados,
            obraSocial: e.codigoObraSocial, adherentes: e.adherentesObraSocial, remuneracionBruta: im.remuneracionTotal,
            imponible1: im.imponible1, imponible2: im.imponible2, imponible3: im.imponible3, imponible4: im.imponible4, imponible5: im.imponible5, imponible8: im.imponible8, imponible9: im.imponible9,
            base10: im.imponible11, detraccion: im.detraccion,
          }));
        } catch (err) {
          if (err instanceof BadRequestException) throw err;
          throw new BadRequestException(`${quien}: ${(err as Error).message}`);
        }
      }
      // Controles del diseño: largo de cada línea y cantidad de registros 04
      for (const x of lineas) if (x.length !== LARGOS[x.slice(0, 2)]) throw new InternalServerErrorException(`Error interno: registro ${x.slice(0, 2)} de largo ${x.length}`);
      if (lineas.filter((x) => x.startsWith('04')).length !== recibos.length) throw new InternalServerErrorException('Error interno: cantidad de registros 04');
      return { nombre: `LSD-${empresa.cuit.replace(/\D/g, '')}-${l.anio}${String(l.mes).padStart(2, '0')}-${numero}.txt`, contenido: archivo(lineas), numero };
    }, { timeout: 60000 });
  }

  /** Registro 03 de un renglón (spec E30 §4.1 y §4.2). */
  private renglon03(cuil: string, x: ReciboSueldoRenglon, conceptos: Map<string, { codigo: string; tipo: string }>, fijos: Map<string, unknown>, esFinal: boolean): Datos03 {
    const c = x.conceptoId ? conceptos.get(x.conceptoId) : undefined;
    // El SAC de la final se informa con el código propio 201 (SAC proporcional, 120003)
    const codigo = c ? c.codigo : x.codigo === '200' && esFinal ? '201' : x.codigo;
    if (!c && !fijos.has(codigo)) throw new Error(`el renglón ${x.codigo} no tiene código ARCA`);
    const importe = new D(x.importe);
    const positivo = importe.gt(0);
    const dc = x.clase === 'DESCUENTO' ? (positivo ? 'D' : 'C') : positivo ? 'C' : 'D';
    let unidad = '';
    let factor = 1;
    if (c?.tipo === 'HORAS_EXTRA') unidad = 'H';
    else if (c?.tipo === 'VACACIONES' && positivo) unidad = 'D';
    else if (!c && CANTIDAD_FIJOS[codigo]) [unidad, factor] = CANTIDAD_FIJOS[codigo];
    const cantidad = unidad && x.cantidad !== null ? new D(x.cantidad).times(factor) : null;
    return { cuil: cuil.replace(/\D/g, ''), codigo, cantidad, unidad: cantidad ? unidad : '', importe: importe.abs(), dc };
  }
}
