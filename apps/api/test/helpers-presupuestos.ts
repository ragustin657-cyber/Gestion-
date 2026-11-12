import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { sesionConPlan } from './helpers';

export type RenglonP = [codigo: string, debe: number, haber: number, centro?: 'ROS' | 'COR'];

/** Empresa con plan, centros ROS y COR y atajos para presupuestos. */
export async function prepararPresupuestos(app: INestApplication, prisma: PrismaService) {
  const s = await sesionConPlan(app, prisma);
  const ejercicio = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 } });
  const centros = {
    ROS: (await prisma.centroCosto.create({ data: { empresaId: s.empresaId, codigo: 'ROS', nombre: 'Rosario' } })).id,
    COR: (await prisma.centroCosto.create({ data: { empresaId: s.empresaId, codigo: 'COR', nombre: 'Córdoba' } })).id,
  };
  const crear = async (nombre: string, extra: Record<string, unknown> = {}) => {
    const r = await s.http.post('/api/presupuestos', { ejercicioId: ejercicio.id, nombre, ...extra });
    if (r.status !== 201) throw new Error(`crear presupuesto: ${JSON.stringify(r.body)}`);
    return r.body as { id: string; nombre: string; vigente: boolean };
  };
  const linea = async (id: string, codigo: string, importes: Record<string, number>, centro?: 'ROS' | 'COR') =>
    s.http.put(`/api/presupuestos/${id}/lineas`, { cuentaContableId: await s.cuenta(codigo), centroCostoId: centro ? centros[centro] : null, importes });
  /** Asiento manual por API. */
  const asiento = async (fecha: string, rs: RenglonP[]) => {
    const r = await s.http.post('/api/contabilidad/asientos', {
      fecha, descripcion: 'Prueba',
      renglones: await Promise.all(rs.map(async ([codigo, debe, haber, centro]) => ({ cuentaContableId: await s.cuenta(codigo), centroCostoId: centro ? centros[centro] : null, ...(debe ? { debe } : { haber }) }))),
    });
    if (r.status !== 201) throw new Error(`asiento ${fecha}: ${JSON.stringify(r.body)}`);
    return r.body as { id: string };
  };
  return { ...s, ejercicio, centros, crear, linea, asiento };
}
