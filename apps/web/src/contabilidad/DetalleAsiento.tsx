import { Anchor, Badge, Group, Modal, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { TIPOS_ASIENTO } from './asiento';

export interface AsientoVista {
  id: string; numero: number; numeroDefinitivo: number | null; fecha: string; tipo: string; descripcion: string; anulaAId: string | null; version: number;
  origen: { tipo: string; id: string; ruta: string | null };
  renglones: { cuenta: { id: string; codigo: string; nombre: string }; centroCosto: { codigo: string } | null; debe: string; haber: string; detalle: string | null }[];
  anuladoPor?: { id: string; numero: number } | null;
}

export const numeroAsiento = (a: { numero: number; numeroDefinitivo: number | null }) => (a.numeroDefinitivo ? `N° ${a.numeroDefinitivo}` : `Provisorio ${a.numero}`);

export function ContenidoAsiento({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['/contabilidad/asientos', id], queryFn: () => api<AsientoVista>(`/contabilidad/asientos/${id}`) });
  if (!q.data) return errorConsulta(q.error) ?? <Text c="dimmed">Cargando…</Text>;
  const a = q.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={700}>{numeroAsiento(a)} · {formatoFecha(a.fecha)}</Text>
        <Badge variant="light">{TIPOS_ASIENTO[a.tipo] ?? a.tipo}</Badge>
      </Group>
      <Text>{a.descripcion}</Text>
      {a.origen.ruta && a.origen.tipo !== 'MANUAL' && <Anchor component={Link} to={a.origen.ruta}>Ver comprobante de origen</Anchor>}
      {a.anuladoPor && <Text c="red" size="sm">Anulado por el asiento {a.anuladoPor.numero}</Text>}
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th>C. costo</Table.Th><Table.Th>Detalle</Table.Th><Table.Th ta="right">Debe</Table.Th><Table.Th ta="right">Haber</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {a.renglones.map((r, i) => (
            <Table.Tr key={i}><Table.Td>{r.cuenta.codigo} {r.cuenta.nombre}</Table.Td><Table.Td>{r.centroCosto?.codigo ?? ''}</Table.Td><Table.Td>{r.detalle ?? ''}</Table.Td>
              <Table.Td ta="right">{r.debe !== '0' ? formatoMoneda(r.debe) : ''}</Table.Td><Table.Td ta="right">{r.haber !== '0' ? formatoMoneda(r.haber) : ''}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export function DetalleAsiento({ id, onCerrar }: { id: string | null; onCerrar: () => void }) {
  return <Modal opened={!!id} onClose={onCerrar} title="Asiento" size="xl">{id && <ContenidoAsiento id={id} />}</Modal>;
}

export function AsientoPage() {
  const { id } = useParams();
  return <ContenidoAsiento id={id!} />;
}
