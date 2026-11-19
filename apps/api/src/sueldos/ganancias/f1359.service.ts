import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { linea } from '../lsd-diseno';
import { AnualGananciasService } from './anual.service';
import { DatosCertificado, pdfCertificados } from './certificado-pdf';
import { DatosF1359Empleado } from './f1359-datos';
import { DatosCabecera, F1359_01, LARGOS_F1359, REGISTROS_EMPLEADO } from './f1359-diseno';
import { SinTablaGanancias } from './tablas';

const D = Prisma.Decimal;
const mm = (n: number) => String(n).padStart(2, '0');
const ddmmaaaa = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const iguales = (a: string, b: Prisma.Decimal) => new D(a).minus(b).abs().lte(0.005);

/** Presentaciones F.1359 v2.0 (anual, final y distracto) y certificados (spec E32 §6 a §8). */
@Injectable()
export class F1359Service {
  constructor(private readonly tenant: TenantPrisma, private readonly anuales: AnualGananciasService) {}

  /** Controles del manual sobre los importes de un empleado (un fallo es un error del programa). */
  private controlar(d: DatosF1359Empleado) {
    const s = (xs: string[]) => xs.reduce((t, x) => t.plus(x), new D(0));
    const r05 = Object.entries(d.r05).filter(([k]) => k !== 'total').map(([, v]) => v);
    const errores = [
      !iguales(d.r03.total, s([d.r03.bruta, d.r03.sac1, d.r03.sac2, d.r03.otrosBruta])) && 'total gravado',
      !iguales(d.r04.totalExento, s([d.r04.asignaciones, d.r04.intereses, d.r04.indemnizaciones, d.r04.cursos, d.r04.indumentaria])) && 'total exento',
      !iguales(d.r05.total, s(r05)) && 'total deducciones generales',
      !iguales(d.r06.totalCargas, s([d.r06.conyuge, d.r06.hijos, d.r06.incapacitados])) && 'total cargas',
      !iguales(d.r06.total, s([d.r06.gni, d.r06.especial, d.r06.totalCargas])) && 'total art. 30',
      !iguales(d.r08.sujeta, D.max(new D(d.r03.total).minus(d.r05.total).minus(d.r06.total), 0)) && 'remuneración sujeta',
      !iguales(d.r08.subtotal, new D(d.r08.determinado).minus(d.r08.retenido)) && 'subtotal',
      !iguales(d.r08.saldo, new D(d.r08.subtotal).minus(d.r07.total)) && 'saldo',
    ].filter(Boolean);
    if (errores.length) throw new InternalServerErrorException(`Error interno en el F.1359 de ${d.cuil}: ${errores.join(', ')}`);
  }

  private async archivo(cab: DatosCabecera, items: { empleadoId: string; datos: DatosF1359Empleado }[], periodoNombre: string) {
    const datos = items.map((x) => x.datos);
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    cab.cuit = empresa.cuit.replace(/\D/g, '');
    // El manual no admite «Total deducciones generales» en cero (empleado sin aportes): ARCA rechazaría el archivo (E33)
    const sinGenerales = items.filter((x) => new D(x.datos.r05.total).isZero());
    if (sinGenerales.length) {
      // Por los empleados de las filas (el CUIL del archivo puede haber cambiado después del cierre); sin empleado, el CUIL (E34)
      const emps = new Map((await this.tenant.db.empleado.findMany({ where: { id: { in: sinGenerales.map((x) => x.empleadoId) } } })).map((e) => [e.id, e]));
      const nombres = sinGenerales.map((x) => ({ e: emps.get(x.empleadoId), cuil: x.datos.cuil }))
        .sort((a, b) => (a.e?.legajo ?? Infinity) - (b.e?.legajo ?? Infinity)).map(({ e, cuil }) => (e ? `${e.apellido}, ${e.nombre}` : cuil));
      throw new BadRequestException(`El F.1359 no admite deducciones generales en cero (sin aportes): ${nombres.join(', ')}`);
    }
    const lineas = [linea(F1359_01, cab)];
    for (const d of [...datos].sort((a, b) => a.cuil.localeCompare(b.cuil))) {
      this.controlar(d);
      for (const reg of REGISTROS_EMPLEADO) lineas.push(linea(reg, d));
    }
    for (const l of lineas) if (l.length !== LARGOS_F1359[l.slice(0, 2)]) throw new InternalServerErrorException(`Error interno: registro ${l.slice(0, 2)} de largo ${l.length}`);
    return { nombre: `F1359.${cab.cuit}.${periodoNombre}.0000.txt`, contenido: Buffer.from(lineas.map((l) => `${l}\r\n`).join(''), 'latin1') };
  }

  private async filas(anio: number, distracto: boolean) {
    const l = await this.tenant.db.liquidacionAnualGanancias.findUnique({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio } } });
    if (!distracto && l?.estado !== 'CERRADA') throw new BadRequestException(`Cierre la liquidación anual de ${anio} antes de descargar el F.1359`);
    return l ? this.tenant.db.liquidacionAnualGananciasEmpleado.findMany({ where: { anualId: l.id, distracto } }) : [];
  }

  async anual(anio: number) {
    const fs = await this.filas(anio, false);
    return this.archivo({ cuit: '', periodo: `${anio}00`, tipo: 1 }, fs.map((x) => ({ empleadoId: x.empleadoId, datos: x.f1359 as unknown as DatosF1359Empleado })), `${anio}0000`);
  }

  async distracto(anio: number) {
    const h = hoy();
    if (h < new Date(Date.UTC(anio + 1, 0, 1)) || h > new Date(Date.UTC(anio + 1, 2, 31))) throw new BadRequestException('El F.1359 de distracto se presenta del 1/1 al 31/3');
    const fs = await this.filas(anio, true);
    if (!fs.length) throw new BadRequestException(`No hay distractos de ${anio}`);
    return this.archivo({ cuit: '', periodo: `${anio}00`, tipo: 4 }, fs.map((x) => ({ empleadoId: x.empleadoId, datos: x.f1359 as unknown as DatosF1359Empleado })), `${anio}0000`);
  }

  /** Datos de la final de un empleado, recalculados desde los recibos con las reglas vigentes (E32 §7). */
  private async datosFinal(liquidacionId: string) {
    const db = this.tenant.db;
    const l = await db.liquidacion.findUniqueOrThrow({ where: { id: liquidacionId } });
    const recibos = await db.reciboSueldo.findMany({ where: { liquidacionId } });
    const anio = l.fechaPago.getUTCFullYear();
    const out: { empleadoId: string; datos: DatosF1359Empleado }[] = [];
    for (const r of recibos) {
      try {
        const res = await this.tenant.transaccion((tx) => this.anuales.liquidacionDeEmpleado(tx, r.empleadoId, anio, { modo: 'FINAL', fechaPago: l.fechaPago, mes: l.fechaPago.getUTCMonth() + 1 }));
        out.push({ empleadoId: r.empleadoId, datos: res.f1359 });
      } catch (e) {
        if (e instanceof SinTablaGanancias) throw new BadRequestException(e.message);
        throw e;
      }
    }
    return { l, out };
  }

  async final(anio: number, mes: number) {
    const ls = await this.tenant.db.liquidacion.findMany({ where: { tipo: 'FINAL', estado: 'CERRADA', fechaPago: { gte: new Date(Date.UTC(anio, mes - 1, 1)), lt: new Date(Date.UTC(anio, mes, 1)) } } });
    if (!ls.length) throw new BadRequestException(`No hay liquidaciones finales cerradas en ${mm(mes)}/${anio}`);
    const items: { empleadoId: string; datos: DatosF1359Empleado }[] = [];
    for (const l of ls) items.push(...(await this.datosFinal(l.id)).out);
    return this.archivo({ cuit: '', periodo: `${anio}${mm(mes)}`, tipo: 2 }, items, `${anio}${mm(mes)}00`);
  }

  private async certificados(items: { empleadoId: string; datos: DatosF1359Empleado }[], anio: number, tipo: string) {
    const db = this.tenant.db;
    const empresa = await db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const emps = new Map((await db.empleado.findMany({ where: { id: { in: items.map((x) => x.empleadoId) } } })).map((e) => [e.id, e]));
    const cs: DatosCertificado[] = items.map((x) => ({ empresa, empleado: emps.get(x.empleadoId)!, anio, tipo, fecha: ddmmaaaa(hoy()), datos: x.datos }));
    return pdfCertificados(cs);
  }

  async certificadosAnual(anio: number) {
    const fs = [...(await this.filas(anio, false)), ...(await this.filas(anio, true))];
    return this.certificados(fs.map((x) => ({ empleadoId: x.empleadoId, datos: x.f1359 as unknown as DatosF1359Empleado })), anio, 'Liquidación anual');
  }

  async certificadoFinal(liquidacionId: string) {
    const { l, out } = await this.datosFinal(liquidacionId);
    if (l.tipo !== 'FINAL' || l.estado !== 'CERRADA') throw new BadRequestException('El certificado de Ganancias es de una liquidación final cerrada');
    return this.certificados(out, l.fechaPago.getUTCFullYear(), 'Liquidación final');
  }
}
