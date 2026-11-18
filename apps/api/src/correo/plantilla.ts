/** Reemplaza las {variables} conocidas de una plantilla; las desconocidas quedan igual (spec E28 §3). */
export function reemplazar(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (todo, nombre: string) => (nombre in valores ? valores[nombre] : todo));
}

export const ASUNTO_POR_DEFECTO = 'Resumen de cuenta - {empresa}';
export const CUERPO_POR_DEFECTO =
  'Estimado/a {cliente}:\n\nLe enviamos adjunto su resumen de cuenta. Registra un saldo vencido de {vencido} con {diasAtraso} días de atraso, y {porVencer} por vencer.\n\nSi ya realizó el pago, por favor desestime este mensaje.\n\nSaludos,\n{empresa}';
