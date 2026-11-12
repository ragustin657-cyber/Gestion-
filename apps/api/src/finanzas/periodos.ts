const DIA = 86400000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dm = (f: Date) => `${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}`;
const masDias = (f: Date, n: number) => new Date(f.getTime() + n * DIA);

export type Agrupar = 'dia' | 'semana' | 'mes';

/** Períodos del flujo: el primero empieza en `desde`, el último termina en `hasta` (semanas de lunes a domingo, meses calendario). */
export function periodos(desde: Date, hasta: Date, agrupar: Agrupar): { desde: Date; hasta: Date; etiqueta: string }[] {
  const r: { desde: Date; hasta: Date; etiqueta: string }[] = [];
  let inicio = desde;
  while (inicio <= hasta) {
    let fin: Date;
    if (agrupar === 'dia') fin = inicio;
    else if (agrupar === 'semana') fin = masDias(inicio, (7 - inicio.getUTCDay()) % 7); // hasta el domingo
    else fin = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0));
    if (fin > hasta) fin = hasta;
    const etiqueta = agrupar === 'dia' ? dm(inicio) : agrupar === 'semana' ? `${dm(inicio)}–${dm(fin)}` : `${MESES[inicio.getUTCMonth()]} ${inicio.getUTCFullYear()}`;
    r.push({ desde: inicio, hasta: fin, etiqueta });
    inicio = masDias(fin, 1);
  }
  return r;
}
