import type { Prisma, TipoCuenta } from '@prisma/client';

export interface CuentaModelo {
  codigo: string;
  nombre: string;
  imputable: boolean;
  tipo: TipoCuenta;
  monetaria: boolean;
}

/** Clasificación por defecto para el ajuste por inflación: PN, resultados y bienes de uso son no monetarios. */
export function monetariaPorDefecto(codigo: string, tipo: TipoCuenta): boolean {
  if (tipo === 'PATRIMONIO_NETO' || tipo === 'RESULTADO_POSITIVO' || tipo === 'RESULTADO_NEGATIVO') return false;
  return !['1.2.01', '1.2.02', '1.1.05'].some((r) => codigo === r || codigo.startsWith(`${r}.`));
}

const c = (codigo: string, nombre: string, tipo: TipoCuenta, imputable = false): CuentaModelo => ({
  codigo, nombre, tipo, imputable, monetaria: monetariaPorDefecto(codigo, tipo),
});
const A = 'ACTIVO', P = 'PASIVO', PN = 'PATRIMONIO_NETO', RP = 'RESULTADO_POSITIVO', RN = 'RESULTADO_NEGATIVO';

/** Plan de cuentas modelo para empresas argentinas. Ordenado: cada padre antes que sus hijos. */
export const PLAN_CUENTAS_MODELO: CuentaModelo[] = [
  c('1', 'Activo', A),
  c('1.1', 'Activo corriente', A),
  c('1.1.01', 'Caja y bancos', A),
  c('1.1.01.001', 'Caja', A, true),
  c('1.1.01.002', 'Bancos cuenta corriente', A, true),
  c('1.1.01.003', 'Valores a depositar', A, true),
  c('1.1.01.004', 'Transferencias a acreditar', A, true),
  c('1.1.01.005', 'Valores en tránsito', A, true),
  c('1.1.02', 'Créditos por ventas', A),
  c('1.1.02.001', 'Deudores por ventas', A, true),
  c('1.1.02.002', 'Cheques rechazados', A, true),
  c('1.1.03', 'Créditos fiscales', A),
  c('1.1.03.001', 'IVA Crédito Fiscal', A, true),
  c('1.1.03.002', 'Percepciones IVA sufridas', A, true),
  c('1.1.03.003', 'Percepciones IIBB sufridas', A, true),
  c('1.1.03.004', 'Retenciones sufridas', A, true),
  c('1.1.03.005', 'Retenciones IVA sufridas', A, true),
  c('1.1.03.006', 'Retenciones Ganancias sufridas', A, true),
  c('1.1.03.007', 'Retenciones IIBB sufridas', A, true),
  c('1.1.03.008', 'Retenciones SUSS sufridas', A, true),
  c('1.1.04', 'Otros créditos', A),
  c('1.1.04.001', 'Anticipos a proveedores', A, true),
  c('1.1.05', 'Bienes de cambio', A),
  c('1.1.05.001', 'Mercaderías', A, true),
  c('1.2', 'Activo no corriente', A),
  c('1.2.01', 'Bienes de uso', A),
  c('1.2.01.001', 'Muebles y útiles', A, true),
  c('1.2.01.002', 'Rodados', A, true),
  c('1.2.01.003', 'Equipos de computación', A, true),
  c('1.2.02', 'Amortizaciones acumuladas de bienes de uso', A),
  c('1.2.02.001', 'Amort. acum. muebles y útiles', A, true),
  c('1.2.02.002', 'Amort. acum. rodados', A, true),
  c('1.2.02.003', 'Amort. acum. equipos de computación', A, true),
  c('2', 'Pasivo', P),
  c('2.1', 'Pasivo corriente', P),
  c('2.1.01', 'Deudas comerciales', P),
  c('2.1.01.001', 'Proveedores', P, true),
  c('2.1.01.002', 'Cheques diferidos a pagar', P, true),
  c('2.1.01.003', 'Mercadería recibida a facturar', P, true),
  c('2.1.02', 'Deudas fiscales', P),
  c('2.1.02.001', 'IVA Débito Fiscal', P, true),
  c('2.1.02.002', 'Retenciones Ganancias a depositar', P, true),
  c('2.1.02.003', 'Retenciones IVA a depositar', P, true),
  c('2.1.02.004', 'Retenciones IIBB a depositar', P, true),
  c('2.1.02.005', 'Retenciones SUSS a depositar', P, true),
  c('3', 'Patrimonio neto', PN),
  c('3.1', 'Capital', PN),
  c('3.1.01', 'Capital social', PN, true),
  c('3.1.02', 'Ajuste de capital', PN, true),
  c('3.2', 'Resultados acumulados', PN),
  c('3.2.01', 'Resultados no asignados', PN, true),
  c('3.2.02', 'Resultado del ejercicio', PN, true),
  c('4', 'Resultados positivos', RP),
  c('4.1', 'Ingresos por ventas', RP),
  c('4.1.01', 'Ventas', RP, true),
  c('4.2', 'Otros ingresos', RP),
  c('4.2.01', 'Diferencias de cambio positivas', RP, true),
  c('4.2.02', 'Intereses ganados', RP, true),
  c('4.2.03', 'Resultado por exposición a la inflación (RECPAM)', RP, true),
  c('4.2.04', 'Sobrantes de inventario', RP, true),
  c('4.2.05', 'Resultado por venta de bienes de uso', RP, true),
  c('5', 'Resultados negativos', RN),
  c('5.1', 'Costos', RN),
  c('5.1.01', 'Costo de mercaderías vendidas', RN, true),
  c('5.2', 'Gastos', RN),
  c('5.2.01', 'Gastos generales', RN, true),
  c('5.2.02', 'Gastos bancarios', RN, true),
  c('5.2.03', 'Diferencias de cambio negativas', RN, true),
  c('5.2.04', 'Diferencias de caja', RN, true),
  c('5.2.05', 'Impuesto a los débitos y créditos bancarios', RN, true),
  c('5.2.06', 'Faltantes de inventario', RN, true),
  c('5.2.07', 'Amortizaciones de bienes de uso', RN, true),
  c('5.2.08', 'Bajas de bienes de uso', RN, true),
];

/** Rubros de bienes de uso del plan modelo: nombre, cuenta de origen, de amortización acumulada y vida útil en meses. */
export const RUBROS_MODELO: [string, string, string, number][] = [
  ['Muebles y útiles', '1.2.01.001', '1.2.02.001', 120],
  ['Rodados', '1.2.01.002', '1.2.02.002', 60],
  ['Equipos de computación', '1.2.01.003', '1.2.02.003', 36],
];

/** Código del padre según la convención de puntos ('1.1.01' → '1.1'). */
export function codigoPadre(codigo: string): string | null {
  const i = codigo.lastIndexOf('.');
  return i < 0 ? null : codigo.slice(0, i);
}

/** Carga el plan modelo en una empresa (sin filtro de empresa: recibe el empresaId). */
export async function cargarPlanModelo(tx: Prisma.TransactionClient, empresaId: string): Promise<number> {
  const ids = new Map<string, string>();
  for (const c of PLAN_CUENTAS_MODELO) {
    const padre = codigoPadre(c.codigo);
    const creada = await tx.cuentaContable.create({
      data: { ...c, empresaId, padreId: padre ? ids.get(padre) : null },
    });
    ids.set(c.codigo, creada.id);
  }
  // Vínculos de ajuste por inflación
  await tx.cuentaContable.update({ where: { id: ids.get('3.1.01')! }, data: { cuentaAjusteId: ids.get('3.1.02')! } });
  // Rubros de bienes de uso precargados
  for (const [nombre, origen, amort, vidaUtilMeses] of RUBROS_MODELO)
    await tx.rubroBienUso.create({ data: { empresaId, nombre, cuentaOrigenId: ids.get(origen)!, cuentaAmortizacionId: ids.get(amort)!, cuentaGastoId: ids.get('5.2.07')!, vidaUtilMeses } });
  return PLAN_CUENTAS_MODELO.length;
}
