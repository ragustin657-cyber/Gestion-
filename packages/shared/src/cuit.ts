const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const PREFIJOS = ['20', '23', '24', '27', '30', '33', '34'];

export function normalizarCuit(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

export function validarCuit(s: string): boolean {
  const c = normalizarCuit(s);
  if (c.length !== 11 || !PREFIJOS.includes(c.slice(0, 2))) return false;
  const suma = PESOS.reduce((acc, p, i) => acc + p * Number(c[i]), 0);
  let r = 11 - (suma % 11);
  if (r === 11) r = 0;
  if (r === 10) return false;
  return r === Number(c[10]);
}

export function formatearCuit(s: string): string {
  const c = normalizarCuit(s);
  if (c.length !== 11) return s;
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}
