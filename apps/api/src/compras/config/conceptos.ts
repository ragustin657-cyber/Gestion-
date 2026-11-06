import type { Prisma } from '@prisma/client';

/** Conceptos contables de compras y su cuenta en el plan de cuentas modelo. */
export const CONCEPTOS_CUENTA = {
  PROVEEDORES: '2.1.01.001',
  IVA_CREDITO_FISCAL: '1.1.03.001',
  PERCEPCION_IVA: '1.1.03.002',
  PERCEPCION_IIBB: '1.1.03.003',
  IMPUESTOS_INTERNOS: '5.2.01',
  GASTO_POR_DEFECTO: '5.2.01',
  RETENCION_GANANCIAS: '2.1.02.002',
  RETENCION_IIBB: '2.1.02.004',
  ANTICIPOS_PROVEEDORES: '1.1.04.001',
  CHEQUES_DIFERIDOS: '2.1.01.002',
  DIFERENCIA_CAMBIO_POSITIVA: '4.2.01',
  DIFERENCIA_CAMBIO_NEGATIVA: '5.2.03',
  VALORES_A_DEPOSITAR: '1.1.01.003',
  TRANSFERENCIAS_A_ACREDITAR: '1.1.01.004',
  VALORES_EN_TRANSITO: '1.1.01.005',
  DEUDORES_POR_VENTAS: '1.1.02.001',
  CHEQUES_RECHAZADOS: '1.1.02.002',
  GASTOS_BANCARIOS: '5.2.02',
  DIFERENCIAS_DE_CAJA: '5.2.04',
} as const;

export type ConceptoCuenta = keyof typeof CONCEPTOS_CUENTA;
export const CONCEPTOS = Object.keys(CONCEPTOS_CUENTA) as ConceptoCuenta[];

/** Precarga las cuentas por concepto de una empresa (omite las que no existan en su plan). */
export async function cargarConfigCuentas(tx: Prisma.TransactionClient, empresaId: string): Promise<void> {
  for (const concepto of CONCEPTOS) {
    const cuenta = await tx.cuentaContable.findFirst({ where: { empresaId, codigo: CONCEPTOS_CUENTA[concepto] } });
    if (cuenta)
      await tx.configCuenta.upsert({
        where: { empresaId_concepto: { empresaId, concepto } },
        create: { empresaId, concepto, cuentaContableId: cuenta.id },
        update: {},
      });
  }
}
