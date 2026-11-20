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

/** ¿La empresa tiene activo el prorrateo del crédito fiscal? (opciones de compras: no exige permiso de impuestos) */
export function useProrrateoActivo(): boolean {
  const q = useQuery({ queryKey: ['/compras/comprobantes/opciones'], queryFn: () => api<{ prorrateoIva?: boolean }>('/compras/comprobantes/opciones').catch(() => null) });
  return !!q.data?.prorrateoIva;
}

export function SelectorDestinoIva({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return <Select label="Destino del crédito de IVA" w={260} allowDeselect={false} placeholder="Gravadas (o el del comprobante asociado)" data={DESTINOS_IVA} value={value || null} disabled={disabled} onChange={(v) => onChange(v ?? 'GRAVADO')} />;
}
