export interface Paginado<T> {
  items: T[];
  total: number;
}

/** Lee ?pagina=&porPagina= (por defecto 1 y 50, máximo 200). */
export function paginacion(q: { pagina?: string; porPagina?: string }) {
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const porPagina = Math.min(200, Math.max(1, Number(q.porPagina) || 50));
  return { skip: (pagina - 1) * porPagina, take: porPagina };
}
