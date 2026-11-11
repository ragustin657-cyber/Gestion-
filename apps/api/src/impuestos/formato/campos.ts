/** Campo de un registro de ancho fijo. El largo de IMPORTE incluye el separador decimal. */
export type Campo =
  | { nombre: string; largo: number; tipo: 'NUM' }
  | { nombre: string; largo: number; tipo: 'TXT' }
  | { nombre: string; largo: number; tipo: 'IMPORTE'; decimales?: number; separador: '' | ',' | '.' }
  | { nombre: string; largo: number; tipo: 'FECHA'; formato: 'AAAAMMDD' | 'DD/MM/AAAA' }
  | { nombre: string; largo: number; tipo: 'FIJO'; valor: string };

export type Valor = string | number | Date | null | undefined;
