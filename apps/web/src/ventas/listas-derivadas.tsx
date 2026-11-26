import { Badge, Button, Checkbox, Group, Modal, NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { REDONDEOS } from './precios';

/** Listas de precios derivadas y desde el costo (E52). */

export type BaseLista = 'MANUAL' | 'LISTA' | 'COSTO';
export interface ReglaForm { base: BaseLista; listaBaseId: string | null; porcentaje: string | number; redondeo: string }
export const reglaVacia = (): ReglaForm => ({ base: 'MANUAL', listaBaseId: null, porcentaje: '', redondeo: '0.01' });
export const cuerpoRegla = (r: ReglaForm) => ({
  base: r.base, listaBaseId: r.base === 'LISTA' ? r.listaBaseId : null, porcentaje: r.base === 'MANUAL' ? 0 : Number(r.porcentaje) || 0, redondeo: r.redondeo,
});
const BASES = [{ value: 'MANUAL', label: 'Manual' }, { value: 'LISTA', label: 'Otra lista' }, { value: 'COSTO', label: 'Costo' }];

export function CamposRegla({ regla, onChange, listas }: { regla: ReglaForm; onChange: (r: ReglaForm) => void; listas: { id: string; nombre: string }[] }) {
  return (
    <Stack gap="xs">
      <Select label="Base" allowDeselect={false} data={BASES} value={regla.base} onChange={(v) => onChange({ ...regla, base: (v ?? 'MANUAL') as BaseLista })} />
      {regla.base === 'LISTA' && <Select label="Lista base" data={listas.map((l) => ({ value: l.id, label: l.nombre }))} value={regla.listaBaseId} onChange={(v) => onChange({ ...regla, listaBaseId: v })} />}
      {regla.base === 'LISTA' && <NumberInput label="Porcentaje (+ recargo / − descuento)" decimalScale={2} decimalSeparator="," value={regla.porcentaje} onChange={(v) => onChange({ ...regla, porcentaje: v })} />}
      {regla.base === 'COSTO' && <NumberInput label="Margen sobre el costo (%)" min={0} decimalScale={2} decimalSeparator="," value={regla.porcentaje} onChange={(v) => onChange({ ...regla, porcentaje: v })} />}
      {regla.base !== 'MANUAL' && <Select label="Redondeo" allowDeselect={false} data={REDONDEOS} value={regla.redondeo} onChange={(v) => onChange({ ...regla, redondeo: v ?? '1' })} />}
    </Stack>
  );
}

export interface FilaRecalculo { articuloId: string; codigo: string; descripcion: string; actual: string | null; nuevo: string | null; variacionPct: string | null; motivo: string | null; margen?: string; origenMargen?: 'ARTICULO' | 'RUBRO' | 'LISTA' }
export const elegidosIniciales = (filas: FilaRecalculo[]) => new Set(filas.filter((f) => !f.motivo && f.nuevo).map((f) => f.articuloId));
/** Sin `articuloIds` si se eligieron todas las que se recalculan. */
export const cuerpoRecalculo = (filas: FilaRecalculo[], elegidos: Set<string>) => {
  const todos = elegidosIniciales(filas);
  return todos.size === elegidos.size && [...todos].every((x) => elegidos.has(x)) ? {} : { articuloIds: [...elegidos] };
};

const ORIGEN_MARGEN = { ARTICULO: 'Artículo', RUBRO: 'Rubro', LISTA: 'Lista' } as const;

/** E56: márgenes por rubro de una lista desde el costo (vacío = usa el de la lista). */
export function ModalMargenesRubro({ listaId, nombre, abierto, onCerrar }: { listaId: string; nombre: string; abierto: boolean; onCerrar: () => void }) {
  const op = useOperacion();
  const datos = useQuery({ queryKey: ['/ventas/listas/margenes-rubro', listaId], queryFn: () => api<{ rubroId: string; nombre: string; margenPct: string | null }[]>(`/ventas/listas/${listaId}/margenes-rubro`), enabled: abierto });
  const [m, setM] = useState<Record<string, string | number>>({});
  useEffect(() => { if (datos.data) setM(Object.fromEntries(datos.data.map((r) => [r.rubroId, r.margenPct === null ? '' : Number(r.margenPct)]))); }, [datos.data]);
  const guardar = async () => {
    const margenes = Object.entries(m).filter(([, v]) => v !== '' && v !== null).map(([rubroId, v]) => ({ rubroId, margenPct: Number(v) }));
    if (await op.ejecutar(() => api(`/ventas/listas/${listaId}/margenes-rubro`, { metodo: 'PUT', body: { margenes } }), () => 'Márgenes por rubro guardados')) onCerrar();
  };
  return (
    <Modal opened={abierto} onClose={onCerrar} title={`Márgenes por rubro de ${nombre}`}>
      <Stack gap="xs">
        {!datos.data?.length && <Text size="sm" c="dimmed">No hay rubros de artículos activos.</Text>}
        {datos.data?.map((r) => (
          <NumberInput key={r.rubroId} label={r.nombre} placeholder="Usa el de la lista" min={0} max={1000} decimalScale={2} decimalSeparator="," suffix=" %" value={m[r.rubroId] ?? ''} onChange={(v) => setM({ ...m, [r.rubroId]: v })} />
        ))}
        {op.alerta}
        <Group justify="flex-end"><Button loading={op.enviando} onClick={() => void guardar()}>Guardar</Button></Group>
      </Stack>
    </Modal>
  );
}

export function TablaRecalculo({ filas, elegidos, onChange, moneda }: { filas: FilaRecalculo[]; elegidos: Set<string>; onChange: (s: Set<string>) => void; moneda: string }) {
  const alternar = (id: string, si: boolean) => { const n = new Set(elegidos); if (si) n.add(id); else n.delete(id); onChange(n); };
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th /><Table.Th>Artículo</Table.Th><Table.Th ta="right">Actual</Table.Th><Table.Th ta="right">Nuevo</Table.Th><Table.Th ta="right">Variación</Table.Th>{filas.some((f) => f.origenMargen) && <Table.Th>Margen</Table.Th>}<Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((f) => (
          <Table.Tr key={f.articuloId}>
            <Table.Td><Checkbox aria-label={`Recalcular ${f.codigo}`} disabled={!!f.motivo || !f.nuevo} checked={elegidos.has(f.articuloId)} onChange={(e) => alternar(f.articuloId, e.currentTarget.checked)} /></Table.Td>
            <Table.Td>{f.codigo} {f.descripcion}</Table.Td>
            <Table.Td ta="right">{f.actual ? formatoMoneda(f.actual, moneda) : '—'}</Table.Td>
            <Table.Td ta="right">{f.nuevo ? formatoMoneda(f.nuevo, moneda) : '—'}</Table.Td>
            <Table.Td ta="right">{f.variacionPct !== null ? `${Number(f.variacionPct).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %` : f.nuevo && !f.actual ? <Badge size="xs">Nuevo</Badge> : ''}</Table.Td>
            {filas.some((x) => x.origenMargen) && <Table.Td>{f.origenMargen ? `${Number(f.margen).toLocaleString('es-AR')} % (${ORIGEN_MARGEN[f.origenMargen]})` : ''}</Table.Td>}
            <Table.Td>{f.motivo && <Text size="xs" c="dimmed">{f.motivo}</Text>}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function ModalRecalculo({ listaId, nombre, moneda, abierto, onCerrar, onAplicado }: { listaId: string; nombre: string; moneda: string; abierto: boolean; onCerrar: () => void; onAplicado: () => void }) {
  const op = useOperacion();
  const q = useQuery({ queryKey: ['/ventas/listas/recalculo', listaId], queryFn: () => api<{ filas: FilaRecalculo[] }>(`/ventas/listas/${listaId}/recalculo`), enabled: abierto, gcTime: 0 });
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  useEffect(() => { if (q.data) setElegidos(elegidosIniciales(q.data.filas)); }, [q.data]);
  return (
    <Modal opened={abierto} onClose={onCerrar} size="xl" title={`Recalcular ${nombre}`}>
      <Stack>
        {q.error && <Text c="red" size="sm">{(q.error as Error).message}</Text>}
        {q.data && <TablaRecalculo filas={q.data.filas} elegidos={elegidos} onChange={setElegidos} moneda={moneda} />}
        {op.alerta}
        <Group><Button disabled={!q.data || !elegidos.size} loading={op.enviando} onClick={async () => {
          const r = await op.ejecutar(() => api<{ actualizados: number; agregados: number; aviso: string | null }>(`/ventas/listas/${listaId}/recalculo`, { metodo: 'POST', body: cuerpoRecalculo(q.data!.filas, elegidos) }),
            (x) => `Precios actualizados: ${x.actualizados} · agregados: ${x.agregados}`);
          if (r) {
            if (r.aviso) notifications.show({ color: 'yellow', message: r.aviso });
            onAplicado();
          }
        }}>Aplicar</Button></Group>
      </Stack>
    </Modal>
  );
}
