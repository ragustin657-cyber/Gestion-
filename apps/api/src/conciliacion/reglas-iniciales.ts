import type { Prisma, SentidoRegla } from '@prisma/client';

/** Reglas de conciliación precargadas: el concepto del banco contiene el texto → cuenta del plan modelo. */
export const REGLAS_INICIALES: { prioridad: number; texto: string; sentido: SentidoRegla; codigoCuenta: string }[] = [
  { prioridad: 10, texto: 'PERCEP IVA', sentido: 'DEBITO', codigoCuenta: '1.1.03.002' },
  { prioridad: 20, texto: 'PERCEP IIBB', sentido: 'DEBITO', codigoCuenta: '1.1.03.003' },
  { prioridad: 30, texto: 'SIRCREB', sentido: 'DEBITO', codigoCuenta: '1.1.03.003' },
  { prioridad: 40, texto: 'LEY 25413', sentido: 'AMBOS', codigoCuenta: '5.2.05' },
  { prioridad: 50, texto: 'IMP DEB', sentido: 'DEBITO', codigoCuenta: '5.2.05' },
  { prioridad: 60, texto: 'IMP CRED', sentido: 'AMBOS', codigoCuenta: '5.2.05' },
  { prioridad: 70, texto: 'IVA', sentido: 'DEBITO', codigoCuenta: '1.1.03.001' },
  { prioridad: 80, texto: 'COMISION', sentido: 'DEBITO', codigoCuenta: '5.2.02' },
  { prioridad: 90, texto: 'MANTENIMIENTO', sentido: 'DEBITO', codigoCuenta: '5.2.02' },
  { prioridad: 100, texto: 'INTERES', sentido: 'CREDITO', codigoCuenta: '4.2.02' },
];

/** Carga las reglas iniciales en una empresa (omite las de cuentas que no existan en su plan). */
export async function cargarReglasIniciales(tx: Prisma.TransactionClient, empresaId: string): Promise<void> {
  for (const r of REGLAS_INICIALES) {
    const cuenta = await tx.cuentaContable.findFirst({ where: { empresaId, codigo: r.codigoCuenta } });
    if (cuenta) await tx.reglaConciliacion.create({ data: { empresaId, prioridad: r.prioridad, texto: r.texto, sentido: r.sentido, cuentaContableId: cuenta.id } });
  }
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ');

/** Primera regla activa (por prioridad) que coincide con la línea, o null. */
export function reglaPara<T extends { prioridad: number; texto: string; sentido: SentidoRegla; cuentaBancariaId: string | null; activa: boolean }>(
  reglas: T[], linea: { concepto: string; importe: { isNegative(): boolean } }, cuentaBancariaId: string,
): T | null {
  const concepto = normalizar(linea.concepto);
  const sentido = linea.importe.isNegative() ? 'DEBITO' : 'CREDITO';
  return [...reglas]
    .sort((a, b) => a.prioridad - b.prioridad)
    .find((r) => r.activa && (r.sentido === 'AMBOS' || r.sentido === sentido) && (!r.cuentaBancariaId || r.cuentaBancariaId === cuentaBancariaId) && concepto.includes(normalizar(r.texto))) ?? null;
}
