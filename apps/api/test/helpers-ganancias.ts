import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tabla de Ganancias de prueba (valores anuales simples, E31). */
export const TABLA_PRUEBA = {
  gni: 1200000, deduccionEspecial: 4800000, conyuge: 1200000, hijo: 600000, hijoIncapacitado: 1200000,
  topes: { hipotecario: 120000, seguroMuerte: 60000, seguroMixto: 60000, seguroRetiro: 60000, sepelio: 12000 },
  tramos: [{ desde: 0, hasta: 1200000, fijo: 0, porcentaje: 5 }, { desde: 1200000, hasta: 2400000, fijo: 60000, porcentaje: 10 }, { desde: 2400000, hasta: null, fijo: 180000, porcentaje: 15 }],
};

/** F.572 de ejemplo con CUIL, CUIT del agente, número y deducciones extra reemplazables. */
const PLANTILLA = readFileSync(join(__dirname, 'fixtures/f572-ejemplo.xml'), 'utf8');
export const f572 = (o: { cuil?: string; cuit?: string; nro?: number; extra?: string } = {}) =>
  PLANTILLA.replace('{CUIL}', o.cuil ?? '20172543597').replace('{CUIT}', o.cuit ?? '30712345671').replace('{NRO}', String(o.nro ?? 1)).replace('{EXTRA}', o.extra ?? '');
