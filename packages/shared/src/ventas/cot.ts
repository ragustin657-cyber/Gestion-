/** E57: tablas del COT de ARBA. */

/** Provincias con la letra de la tabla de ARBA. */
export const PROVINCIAS_ARBA: Record<string, string> = {
  B: 'Buenos Aires', C: 'Ciudad de Buenos Aires', K: 'Catamarca', H: 'Chaco', U: 'Chubut', X: 'Córdoba', W: 'Corrientes', E: 'Entre Ríos',
  P: 'Formosa', Y: 'Jujuy', L: 'La Pampa', F: 'La Rioja', M: 'Mendoza', N: 'Misiones', Q: 'Neuquén', R: 'Río Negro', A: 'Salta',
  J: 'San Juan', D: 'San Luis', Z: 'Santa Cruz', S: 'Santa Fe', G: 'Santiago del Estero', V: 'Tierra del Fuego', T: 'Tucumán',
};

/** Unidades de medida de la tabla del COT de ARBA (a verificar contra el instructivo vigente). */
export const UNIDADES_ARBA: Record<string, string> = {
  '1': 'Kilogramos', '2': 'Litros', '3': 'Metros', '4': 'Metros cuadrados', '5': 'Metros cúbicos', '6': 'Toneladas', '7': 'Unidades', '8': 'Pares', '9': 'Docenas',
};

export const esProvinciaArba = (p: string) => Object.prototype.hasOwnProperty.call(PROVINCIAS_ARBA, p);
export const esUnidadArba = (u: string) => Object.prototype.hasOwnProperty.call(UNIDADES_ARBA, u);
