import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { sesionConPlan } from './helpers';

/** Empresa con plan (y Comercio precargado) y atajos de sueldos. */
export async function prepararSueldos(app: INestApplication, prisma: PrismaService) {
  const s = await sesionConPlan(app, prisma);
  const convenio = await prisma.convenio.findFirstOrThrow({ where: { empresaId: s.empresaId } });
  const categoria = async (nombre: string) => prisma.categoria.findFirstOrThrow({ where: { empresaId: s.empresaId, nombre } });
  const escala = async (cat: string, mes: string, basico: number) => {
    const r = await s.http.put('/api/sueldos/escalas', { categoriaId: (await categoria(cat)).id, anio: Number(mes.slice(0, 4)), mes: Number(mes.slice(5, 7)), basico });
    if (r.status !== 200) throw new Error(`escala: ${JSON.stringify(r.body)}`);
  };
  let n = 0;
  const empleado = async (d: Record<string, unknown> = {}) => {
    const cuils = ['20-17254359-7', '27-28033514-8', '20-12345678-6', '20-30110222-5'];
    const r = await s.http.post('/api/sueldos/empleados', {
      apellido: 'Pérez', nombre: `Juan ${++n}`, cuil: cuils[(n - 1) % cuils.length], domicilio: 'San Martín 100', fechaIngreso: '2021-03-01',
      categoriaId: (await categoria(String(d.categoria ?? 'Vendedor B'))).id, afiliadoSindicato: true, obraSocial: 'OSECAC', formaPago: 'TRANSFERENCIA', ...d,
    });
    if (r.status !== 201) throw new Error(`empleado: ${JSON.stringify(r.body)}`);
    return r.body as { id: string; legajo: number };
  };
  return { ...s, convenio, categoria, escala, empleado };
}
