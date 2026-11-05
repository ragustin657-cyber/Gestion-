const dv = (s: string, pesos: number[]) =>
  (10 - (pesos.reduce((t, p, i) => t + p * Number(s[i]), 0) % 10)) % 10;

/** Valida un CBU de 22 dígitos con sus dos dígitos verificadores (algoritmo BCRA). */
export function validarCbu(s: string): boolean {
  const c = (s ?? '').replace(/\s/g, '');
  if (!/^\d{22}$/.test(c)) return false;
  return (
    dv(c.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]) === Number(c[7]) &&
    dv(c.slice(8, 21), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) === Number(c[21])
  );
}
