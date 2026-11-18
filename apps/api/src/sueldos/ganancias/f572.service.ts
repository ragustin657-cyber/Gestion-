import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { DatosF572, ErrorF572, leerF572, TIPOS_DEDUCCION_VALIDOS } from './f572-xml';

const mes = z.number().int().min(1).max(12);
const monto = z.union([z.string(), z.number()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, 'Importe inválido').transform((v) => v.toFixed(2));
/** F.572 cargado o corregido a mano (spec E31 §4). */
export const esquemaDatosF572 = z.object({
  cargas: z.array(z.object({ parentesco: z.enum(['CONYUGE', 'HIJO', 'HIJO_INCAPACITADO', 'OTRO']), documento: z.string().max(20).default(''), nombre: z.string().max(100).default(''), mesDesde: mes, mesHasta: mes, porcentaje: z.union([z.literal(50), z.literal(100)]) })).default([]),
  otrosEmpleadores: z.array(z.object({ cuit: z.string().max(13).default(''), nombre: z.string().max(100).default(''), meses: z.array(z.object({ mes, bruta: monto, aportes: monto, retenido: monto })) })).default([]),
  deducciones: z.array(z.object({ tipo: z.enum(TIPOS_DEDUCCION_VALIDOS as [string, ...string[]]), codigo: z.string().max(10).default(''), prestador: z.string().max(100).default(''), meses: z.array(z.object({ mes, importe: monto })) })).default([]),
});
export const esquemaAcumulado = z.object({ bruta: z.number().min(0), aportes: z.number().min(0), retenido: z.number().min(0) });

const json = (d: DatosF572) => d as unknown as Prisma.InputJsonValue;

/** F.572 web (SiRADIG) de cada empleado y acumulado previo de Ganancias (spec E31 §4 y §6). */
@Injectable()
export class F572Service {
  constructor(private readonly tenant: TenantPrisma) {}

  async importar(archivos: { nombre: string; contenido: Buffer }[], confirmar: boolean) {
    const db = this.tenant.db;
    const empresa = await db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const cuitEmpresa = empresa.cuit.replace(/\D/g, '');
    const empleados = await db.empleado.findMany();
    const importados: { archivo: string; empleado: string; avisos: string[] }[] = [];
    const omitidos: { archivo: string; motivo: string }[] = [];
    const pendientes: { archivo: string; empleado: string }[] = [];
    for (const a of archivos) {
      try {
        const f = leerF572(a.contenido.toString('utf8'));
        const e = empleados.find((x) => x.cuil.replace(/\D/g, '') === f.cuil);
        if (!e) { omitidos.push({ archivo: a.nombre, motivo: `Empleado inexistente (CUIL ${f.cuil})` }); continue; }
        const quien = `${e.apellido}, ${e.nombre}`;
        if (f.cuitAgente !== cuitEmpresa) { omitidos.push({ archivo: a.nombre, motivo: `El F.572 de ${quien} está dirigido a otro empleador (CUIT ${f.cuitAgente})` }); continue; }
        const actual = await db.f572.findUnique({ where: { empleadoId_anio: { empleadoId: e.id, anio: f.anio } } });
        if (actual && actual.origen === 'IMPORTADO' && !actual.modificadoAMano && f.nroPresentacion <= actual.nroPresentacion) { omitidos.push({ archivo: a.nombre, motivo: `Presentación ${f.nroPresentacion} ya importada` }); continue; }
        // Una corrección manual no se pisa sin confirmación
        if (actual?.modificadoAMano && !confirmar) { pendientes.push({ archivo: a.nombre, empleado: quien }); continue; }
        const datos = { nroPresentacion: f.nroPresentacion, fecha: f.fecha ? new Date(f.fecha) : null, origen: 'IMPORTADO', modificadoAMano: false, datos: json(f.datos) };
        await db.f572.upsert({ where: { empleadoId_anio: { empleadoId: e.id, anio: f.anio } }, update: datos, create: { ...datos, empresaId: this.tenant.empresaId, empleadoId: e.id, anio: f.anio } });
        importados.push({ archivo: a.nombre, empleado: quien, avisos: f.avisos });
      } catch (err) {
        if (!(err instanceof ErrorF572)) throw err;
        omitidos.push({ archivo: a.nombre, motivo: err.message });
      }
    }
    return { importados, omitidos, pendientes };
  }

  private async empleado(empleadoId: string) {
    if (!(await this.tenant.db.empleado.findUnique({ where: { id: empleadoId } }))) throw new NotFoundException('Empleado inexistente');
  }

  async ver(empleadoId: string, anio: number) {
    await this.empleado(empleadoId);
    const f = await this.tenant.db.f572.findUnique({ where: { empleadoId_anio: { empleadoId, anio } } });
    return f ? { anio, nroPresentacion: f.nroPresentacion, fecha: f.fecha?.toISOString().slice(0, 10) ?? null, origen: f.origen, modificadoAMano: f.modificadoAMano, datos: f.datos as unknown as DatosF572 } : null;
  }

  async guardar(empleadoId: string, anio: number, datos: DatosF572) {
    await this.empleado(empleadoId);
    for (const c of datos.cargas) if (c.mesDesde > c.mesHasta) throw new BadRequestException('El mes desde de una carga de familia no puede ser posterior al mes hasta');
    await this.tenant.db.f572.upsert({
      where: { empleadoId_anio: { empleadoId, anio } },
      update: { datos: json(datos), modificadoAMano: true },
      create: { empresaId: this.tenant.empresaId, empleadoId, anio, origen: 'MANUAL', modificadoAMano: true, datos: json(datos) },
    });
    return this.ver(empleadoId, anio);
  }

  async verAcumulado(empleadoId: string, anio: number) {
    await this.empleado(empleadoId);
    const a = await this.tenant.db.acumuladoGanancias.findUnique({ where: { empleadoId_anio: { empleadoId, anio } } });
    return { bruta: (a?.bruta ?? new Prisma.Decimal(0)).toFixed(2), aportes: (a?.aportes ?? new Prisma.Decimal(0)).toFixed(2), retenido: (a?.retenido ?? new Prisma.Decimal(0)).toFixed(2) };
  }

  async guardarAcumulado(empleadoId: string, anio: number, d: z.infer<typeof esquemaAcumulado>) {
    await this.empleado(empleadoId);
    await this.tenant.db.acumuladoGanancias.upsert({ where: { empleadoId_anio: { empleadoId, anio } }, update: d, create: { ...d, empresaId: this.tenant.empresaId, empleadoId, anio } });
    return this.verAcumulado(empleadoId, anio);
  }
}
