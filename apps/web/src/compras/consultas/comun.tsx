import { Group, Select, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/cliente';
import { hoy } from '../formato';

export const primeroDelMes = () => `${hoy().slice(0, 7)}-01`;
export const finDelMes = () => {
  const [a, m] = hoy().split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

export function useProveedores() {
  const q = useQuery({
    queryKey: ['/terceros', 'proveedores-consulta'],
    queryFn: () => api<{ items: { id: string; razonSocial: string }[] }>('/terceros', { query: { tipo: 'proveedor', porPagina: 200 } }),
  });
  return (q.data?.items ?? []).map((p) => ({ value: p.id, label: p.razonSocial }));
}

export function FiltroFechas({ desde, hasta, onDesde, onHasta, children }: {
  desde: string; hasta: string; onDesde: (s: string) => void; onHasta: (s: string) => void; children?: React.ReactNode;
}) {
  return (
    <Group gap="sm" wrap="wrap" align="flex-end">
      {children}
      <TextInput label="Desde" type="date" value={desde} onChange={(e) => onDesde(e.currentTarget.value)} />
      <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => onHasta(e.currentTarget.value)} />
    </Group>
  );
}

export function SelectProveedor({ value, onChange, requerido }: { value: string | null; onChange: (v: string | null) => void; requerido?: boolean }) {
  const opciones = useProveedores();
  return <Select label="Proveedor" withAsterisk={requerido} searchable clearable={!requerido} data={opciones} value={value} onChange={onChange} w={300} />;
}
