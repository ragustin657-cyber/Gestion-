/** Suma en centavos de los importes seleccionados (evita errores de coma flotante). */
export function sumaSeleccion(items: { id: string; importe: string }[], ids: string[]): number {
  const centavos = items.filter((i) => ids.includes(i.id)).reduce((s, i) => s + Math.round(Number(i.importe) * 100), 0);
  return centavos / 100;
}

/** Hay al menos un elemento de cada lado y las sumas coinciden al centavo. */
export function puedeConciliar(sumaLineas: number, sumaMovimientos: number, cantLineas = 1, cantMovimientos = 1): boolean {
  return cantLineas > 0 && cantMovimientos > 0 && Math.round(sumaLineas * 100) === Math.round(sumaMovimientos * 100);
}
