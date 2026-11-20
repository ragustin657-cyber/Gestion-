import { Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';

/** Destino del crédito de IVA de una compra (E40). */
export const DESTINOS_IVA = [
  { value: 'GRAVADO', label: 'Operaciones gravadas' },
  { value: 'EXENTO', label: 'Operaciones exentas' },
  { value: 'COMUN', label: 'Uso común (prorrateo)' },
];
export const LETRA_DESTINO: Record<string, string> = { GRAVADO: 'G', EXENTO: 'E', COMUN: 'C' };

/** ¿La empresa tiene activo el prorrateo del crédito fiscal? (sin permiso para ver la configuración, se asume que no). */
export function useProrrateoActivo(): boolean {
  const q = useQuery({ queryKey: ['/impuestos/config'], queryFn: () => api<{ prorrateoIva?: boolean }>('/impuestos/config').catch(() => null) });
  return !!q.data?.prorrateoIva;
}

export function SelectorDestinoIva({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return <Select label="Destino del crédito de IVA" w={240} allowDeselect={false} data={DESTINOS_IVA} value={value} disabled={disabled} onChange={(v) => onChange(v ?? 'GRAVADO')} />;
}
