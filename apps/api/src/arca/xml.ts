import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: true, trimValues: true });

/** Lee un XML a objeto (sin prefijos de namespace, todos los valores como texto). */
export const leerXml = (xml: string): Record<string, any> => parser.parse(xml);

export const escaparXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Siempre un arreglo, aunque el XML traiga uno solo o ninguno. */
export const lista = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
