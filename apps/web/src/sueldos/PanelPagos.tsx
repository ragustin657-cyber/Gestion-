import { Badge, Button, Checkbox, Group, Table } from '@mantine/core';
import { useState } from 'react';
import { formatoMoneda } from '../compras/formato';

interface ReciboPago { id: string; legajo: number; apellido: string; nombre: string; neto: string; pagado?: boolean }

/** Recibos de una liquidación cerrada para elegir cuáles pagar (los pagados quedan marcados). */
export function PanelPagos({ recibos, onPagar, deshabilitado }: { recibos: ReciboPago[]; onPagar: (reciboIds: string[]) => void; deshabilitado?: boolean }) {
  const [elegidos, setElegidos] = useState<string[]>([]);
  const pendientes = recibos.filter((r) => !r.pagado);
  const alternar = (id: string) => setElegidos((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Legajo</Table.Th><Table.Th>Empleado</Table.Th><Table.Th ta="right">Neto</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {recibos.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{!r.pagado && <Checkbox aria-label={`Elegir legajo ${r.legajo}`} checked={elegidos.includes(r.id)} onChange={() => alternar(r.id)} disabled={deshabilitado} />}</Table.Td>
              <Table.Td>{r.legajo}</Table.Td><Table.Td>{r.apellido}, {r.nombre}</Table.Td><Table.Td ta="right">{formatoMoneda(r.neto)}</Table.Td>
              <Table.Td>{r.pagado ? <Badge color="green" variant="light">Pagado</Badge> : <Badge color="yellow" variant="light">Pendiente</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="flex-end" mt="sm">
        <Button variant="light" disabled={deshabilitado || !elegidos.length} onClick={() => { onPagar(elegidos); setElegidos([]); }}>Pagar seleccionados</Button>
        <Button disabled={deshabilitado || !pendientes.length} onClick={() => onPagar(pendientes.map((r) => r.id))}>Pagar todos los pendientes</Button>
      </Group>
    </>
  );
}
