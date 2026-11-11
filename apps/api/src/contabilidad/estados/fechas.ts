/** La misma fecha un año antes; el 29/02 pasa al 28/02 (no al 01/03). */
export function unAnioAntes(d: Date): Date {
  const anio = d.getUTCFullYear() - 1, mes = d.getUTCMonth();
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(d.getUTCDate(), ultimo)));
}
