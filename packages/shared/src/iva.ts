/** Alícuotas de IVA vigentes en Argentina (porcentaje). */
export const ALICUOTAS_IVA = [0, 2.5, 5, 10.5, 21, 27] as const;
export type AlicuotaIva = (typeof ALICUOTAS_IVA)[number];
export const esAlicuotaIva = (n: number): n is AlicuotaIva => (ALICUOTAS_IVA as readonly number[]).includes(n);
