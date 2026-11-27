/** E58: tablas de la factura de exportación (WSFEX). A verificar contra los parámetros de ARCA (FEXGetPARAM_*). */

export const TIPOS_EXPORTACION = { BIENES: 'Exportación de bienes', SERVICIOS: 'Servicios', OTROS: 'Otros' } as const;
/** Código de Tipo_expo de WSFEX. */
export const TIPO_EXPO_FEX = { BIENES: 1, SERVICIOS: 2, OTROS: 4 } as const;
export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export const IDIOMAS_FEX: Record<number, string> = { 1: 'Español', 2: 'Inglés', 3: 'Portugués' };
/** Países de destino (código de la tabla de ARCA; selección de los más comunes, a verificar). */
export const PAISES_FEX: Record<number, string> = {
  200: 'Argentina', 202: 'Bolivia', 203: 'Brasil', 204: 'Canadá', 205: 'Colombia', 206: 'Costa Rica', 208: 'Chile', 210: 'Ecuador', 211: 'El Salvador',
  212: 'Estados Unidos', 218: 'México', 221: 'Paraguay', 222: 'Perú', 225: 'Uruguay', 226: 'Venezuela', 410: 'Alemania', 412: 'Austria', 413: 'Bélgica',
  418: 'España', 419: 'Francia', 426: 'Reino Unido', 429: 'Italia', 438: 'Países Bajos', 440: 'Portugal', 444: 'Suiza', 310: 'China', 320: 'Japón',
  308: 'Corea del Sur', 315: 'India', 501: 'Australia',
};
