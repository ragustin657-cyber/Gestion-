import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { ContribucionesService } from './contribuciones.service';
import { DatosF931, lineaF931 } from './f931-diseno';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const mmaaaa = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
const TIPOS_SUELDO = ['BASICO', 'ANTIGUEDAD', 'PORCENTAJE', 'AUSENCIA', 'FIJO'];

/** Archivo de importación de SICOSS con las liquidaciones cerradas del mes (spec E19 §5, §9.3). */
@Injectable()
export class F931Service {
  constructor(private readonly tenant: TenantPrisma, private readonly contribuciones: ContribucionesService) {}

  async generar(anio: number, mes: number): Promise<{ nombre: string; contenido: Buffer }> {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Mes inválido');
    const db = this.tenant.db;
    const liqs = await db.liquidacion.findMany({ where: { anio, mes } });
    const mensual = liqs.find((l) => l.tipo === 'MENSUAL' && l.estado === 'CERRADA');
    const sac = liqs.find((l) => l.tipo === 'SAC' && l.estado === 'CERRADA');
    if (sac && !mensual) throw new BadRequestException(`La liquidación mensual de ${mmaaaa(anio, mes)} no está cerrada`);
    if (!mensual) throw new BadRequestException(`No hay liquidaciones cerradas de ${mmaaaa(anio, mes)}`);
    const cerradas = [mensual, ...(sac ? [sac] : [])];
    const [empresa, param, vigentes] = await Promise.all([
      db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), this.contribuciones.parametros(db, anio, mes), this.contribuciones.vigentes(db, anio, mes),
    ]);
    const recibos = await db.reciboSueldo.findMany({ where: { liquidacionId: { in: cerradas.map((l) => l.id) } }, include: { renglones: true } });
    const empleados = new Map((await db.empleado.findMany({ where: { id: { in: recibos.map((r) => r.empleadoId) } } })).map((e) => [e.id, e]));
    const conceptos = new Map((await db.concepto.findMany()).map((c) => [c.id, c]));
    const novedades = await db.novedad.findMany({ where: { liquidacionId: mensual.id, tipo: { in: ['HORAS_EXTRA_50', 'HORAS_EXTRA_100'] } } });
    const scvo = vigentes.some((c) => c.codigo === 'SCVO' && c.importeFijo.gt(0));
    const ini = new Date(Date.UTC(anio, mes - 1, 1));
    const cero = () => new D(0);
    const porEmpleado = new Map<string, DatosF931 & { legajo: number }>();
    for (const r of recibos) {
      const e = empleados.get(r.empleadoId)!;
      const esSac = r.liquidacionId === sac?.id;
      let d = porEmpleado.get(e.id);
      if (!d) {
        d = {
          legajo: e.legajo, cuil: e.cuil, apellidoNombre: `${e.apellido} ${e.nombre}`, conyuge: e.conyuge, cantidadHijos: e.cantidadHijos, codigoSituacion: e.codigoSituacion, codigoCondicion: e.codigoCondicion,
          codigoActividad: e.codigoActividad, codigoZona: e.codigoZona ?? empresa.codigoZonaSicoss, codigoModalidad: e.codigoModalidad, codigoObraSocial: e.codigoObraSocial, adherentes: e.adherentesObraSocial,
          codigoSiniestrado: e.codigoSiniestrado, regimen: e.regimen, diaInicioRevista: e.fechaIngreso >= ini ? e.fechaIngreso.getUTCDate() : 1, convencionado: e.trabajadorConvencionado,
          localidad: empresa.domicilio ?? '', tipoEmpresa: empresa.tipoEmpresaSicoss, scvo,
          remuneracionTotal: cero(), imponible1: cero(), imponible2: cero(), imponible3: cero(), imponible4: cero(), imponible5: cero(), imponible8: cero(), imponible9: cero(), imponible11: cero(),
          sueldoAdicionales: cero(), sac: cero(), horasExtrasImporte: cero(), noRemunerativo: cero(), detraccion: cero(), diasTrabajados: 0,
          horasExtras: Math.round(novedades.filter((n) => n.empleadoId === e.id).reduce((s, n) => s + Number(n.cantidad ?? 0), 0)),
        };
        porEmpleado.set(e.id, d);
      }
      const rem = D.max(new D(r.totalRemunerativo), 0);
      const tope = param.baseMaxima ? (esSac ? param.baseMaxima.div(2) : param.baseMaxima) : null;
      const conTope = tope ? D.min(rem, tope) : rem;
      const det = D.min(rem, r2(esSac ? param.detraccion.div(2) : param.detraccion.times(r.diasTrabajados).div(30)));
      d.remuneracionTotal = d.remuneracionTotal.plus(rem).plus(r.totalNoRemunerativo);
      d.imponible1 = d.imponible1.plus(conTope); d.imponible4 = d.imponible4.plus(conTope); d.imponible5 = d.imponible5.plus(conTope);
      for (const k of ['imponible2', 'imponible3', 'imponible8', 'imponible9'] as const) d[k] = d[k].plus(rem);
      d.imponible11 = d.imponible11.plus(rem.minus(det));
      d.detraccion = d.detraccion.plus(det);
      d.noRemunerativo = d.noRemunerativo.plus(r.totalNoRemunerativo);
      if (!esSac) d.diasTrabajados = r.diasTrabajados;
      for (const x of r.renglones.filter((y) => y.clase === 'REMUNERATIVO')) {
        if (x.codigo === '200' && !x.conceptoId) { d.sac = d.sac.plus(x.importe); continue; }
        const tipo = x.conceptoId ? conceptos.get(x.conceptoId)?.tipo : undefined;
        if (tipo === 'HORAS_EXTRA') d.horasExtrasImporte = d.horasExtrasImporte.plus(x.importe);
        else if (tipo && TIPOS_SUELDO.includes(tipo)) d.sueldoAdicionales = d.sueldoAdicionales.plus(x.importe);
      }
    }
    const lineas = [...porEmpleado.values()].sort((a, b) => a.cuil.localeCompare(b.cuil)).map((d) => {
      let l: string;
      try { l = lineaF931(d, d.legajo); } catch (e) { throw new BadRequestException((e as Error).message); }
      if (l.length !== 499) throw new InternalServerErrorException(`Error interno: línea de largo ${l.length}`);
      return l;
    });
    return { nombre: `F931-${anio}${String(mes).padStart(2, '0')}.txt`, contenido: Buffer.from(lineas.map((l) => `${l}\r\n`).join(''), 'latin1') };
  }
}
