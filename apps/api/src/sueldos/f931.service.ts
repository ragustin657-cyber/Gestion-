import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { ContribucionesService } from './contribuciones.service';
import { DatosF931, lineaF931 } from './f931-diseno';
import { importesRecibo } from './importes-recibo';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const mmaaaa = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;

/** Archivo de importación de SICOSS con las liquidaciones cerradas del mes (spec E19 §5, §9.3). */
@Injectable()
export class F931Service {
  constructor(private readonly tenant: TenantPrisma, private readonly contribuciones: ContribucionesService) {}

  async generar(anio: number, mes: number): Promise<{ nombre: string; contenido: Buffer }> {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Mes inválido');
    const db = this.tenant.db;
    const liqs = await db.liquidacion.findMany({ where: { anio, mes } });
    const mensualExistente = liqs.find((l) => l.tipo === 'MENSUAL');
    const mensual = mensualExistente?.estado === 'CERRADA' ? mensualExistente : undefined;
    const sac = liqs.find((l) => l.tipo === 'SAC' && l.estado === 'CERRADA');
    const finales = liqs.filter((l) => l.tipo === 'FINAL' && l.estado === 'CERRADA');
    // §9.4 (E20): una mensual del mes sin cerrar, o un SAC cerrado sin mensual, bloquean el archivo
    if ((mensualExistente && !mensual) || (sac && !mensual)) throw new BadRequestException(`La liquidación mensual de ${mmaaaa(anio, mes)} no está cerrada`);
    if (!mensual && !finales.length) throw new BadRequestException(`No hay liquidaciones cerradas de ${mmaaaa(anio, mes)}`);
    const cerradas = [...(mensual ? [mensual] : []), ...(sac ? [sac] : []), ...finales];
    const esFinal = new Set(finales.map((l) => l.id));
    const [empresa, param, vigentes] = await Promise.all([
      db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), this.contribuciones.parametros(db, anio, mes), this.contribuciones.vigentes(db, anio, mes),
    ]);
    const recibos = await db.reciboSueldo.findMany({ where: { liquidacionId: { in: cerradas.map((l) => l.id) } }, include: { renglones: true } });
    const empleados = new Map((await db.empleado.findMany({ where: { id: { in: recibos.map((r) => r.empleadoId) } } })).map((e) => [e.id, e]));
    const conceptos = new Map((await db.concepto.findMany()).map((c) => [c.id, c]));
    const novedades = await db.novedad.findMany({ where: { liquidacionId: { in: [...(mensual ? [mensual.id] : []), ...finales.map((l) => l.id)] }, tipo: { in: ['HORAS_EXTRA_50', 'HORAS_EXTRA_100'] } } });
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
      const liq = cerradas.find((x) => x.id === r.liquidacionId)!;
      const im = importesRecibo(r, liq, param, conceptos, { esSac, esFinal: esFinal.has(r.liquidacionId) });
      for (const k of ['remuneracionTotal', 'imponible1', 'imponible2', 'imponible3', 'imponible4', 'imponible5', 'imponible8', 'imponible9', 'imponible11', 'detraccion', 'noRemunerativo', 'sueldoAdicionales', 'sac', 'horasExtrasImporte'] as const) d[k] = d[k].plus(im[k]);
      if (!im.vacaciones.isZero()) d.vacaciones = (d.vacaciones ?? new D(0)).plus(im.vacaciones);
      if (!esSac) d.diasTrabajados = r.diasTrabajados;
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
