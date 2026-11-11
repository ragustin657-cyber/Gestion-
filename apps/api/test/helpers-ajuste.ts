import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { sesionConPlan } from './helpers';

export type Renglon = [codigo: string, debe: number, haber: number];

/** Índices del ejemplo del spec §5. */
export const INDICES_EJEMPLO = { '2025-06': 50, '2025-12': 80, '2026-01': 100, '2026-02': 110, '2026-03': 120 };

/** Empresa con plan modelo y ejercicio 2026, con utilidades para armar el escenario del ajuste por inflación. */
export async function escenarioAjuste(app: INestApplication, prisma: PrismaService) {
  const s = await sesionConPlan(app, prisma);
  const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 } });
  let numero = 9000;
  const indices = async (valores: Record<string, number>) => {
    for (const [k, valor] of Object.entries(valores)) {
      const [anio, mes] = k.split('-').map(Number);
      await prisma.indiceInflacion.upsert({ where: { anio_mes: { anio, mes } }, create: { anio, mes, valor, actualizadoPor: 'test' }, update: { valor } });
    }
  };
  const renglones = async (rs: Renglon[]) =>
    Promise.all(rs.map(async ([codigo, debe, haber]) => ({ empresaId: s.empresaId, cuentaContableId: await s.cuenta(codigo), debe, haber })));
  /** Asiento de tipo APERTURA al inicio del ejercicio (directo en la base, como lo deja el cierre del anterior). */
  const apertura = async (rs: Renglon[], ejercicioId = ej.id, fecha = ej.desde) =>
    prisma.asiento.create({
      data: {
        empresaId: s.empresaId, numero: numero++, fecha, descripcion: 'Apertura', origenTipo: 'APERTURA', origenId: ejercicioId,
        creadoPor: 'test', tipo: 'APERTURA', ejercicioId, renglones: { create: await renglones(rs) },
      },
    });
  /** Asiento manual por API. */
  const asiento = async (fecha: string, rs: Renglon[]) => {
    const r = await s.http.post('/api/contabilidad/asientos', {
      fecha, descripcion: 'Prueba',
      renglones: await Promise.all(rs.map(async ([codigo, debe, haber]) => ({ cuentaContableId: await s.cuenta(codigo), ...(debe ? { debe } : { haber }) }))),
    });
    if (r.status !== 201) throw new Error(`asiento ${fecha}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { id: string };
  };
  const config = (d: Record<string, unknown>) => s.http.put('/api/contabilidad/ajuste-inflacion/config', { primerEjercicioId: ej.id, ...d });
  return { s, ej, indices, apertura, asiento, config };
}

/** El ejemplo completo del spec §5, configurado (anticuación incluida). */
export async function escenarioEjemplo(app: INestApplication, prisma: PrismaService, anticuacion = true) {
  const e = await escenarioAjuste(app, prisma);
  await e.indices(INDICES_EJEMPLO);
  await e.apertura([['1.2.01.002', 600, 0], ['1.1.01.002', 400, 0], ['3.1.01', 0, 1000]]);
  await e.asiento('2026-02-15', [['1.1.01.002', 220, 0], ['4.1.01', 0, 220]]);
  await e.asiento('2026-03-10', [['1.2.01.001', 120, 0], ['1.1.01.002', 0, 120]]);
  const r = await e.config({
    anticuacion: anticuacion
      ? [
          { cuentaContableId: await e.s.cuenta('1.2.01.002'), tramos: [{ anio: 2025, mes: 6, importe: 600 }] },
          { cuentaContableId: await e.s.cuenta('3.1.01'), tramos: [{ anio: 2025, mes: 6, importe: -1000 }] },
        ]
      : [],
  });
  if (r.status !== 200) throw new Error(`config: ${r.status} ${JSON.stringify(r.body)}`);
  return e;
}
