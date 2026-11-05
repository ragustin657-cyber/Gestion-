import { Button, Group, Modal, Stack, Table, Text } from '@mantine/core';

export interface Diferencia { renglon: number; tipo: 'PRECIO' | 'CANTIDAD'; esperado: string; facturado: string; diferenciaPct: string }

/** Muestra las diferencias del control de 3 vías y permite aceptarlas. */
export function DiferenciasModal({ diferencias, onAceptar, onVolver, enviando }: {
  diferencias: Diferencia[] | null; onAceptar: () => void; onVolver: () => void; enviando?: boolean;
}) {
  return (
    <Modal opened={!!diferencias} onClose={onVolver} title="Hay diferencias con la orden de compra" size="lg">
      <Stack>
        <Text size="sm">Los siguientes renglones superan las tolerancias configuradas. Si las aceptás, quedan registradas en la auditoría.</Text>
        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr><Table.Th>Renglón</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Esperado</Table.Th><Table.Th ta="right">Facturado</Table.Th><Table.Th ta="right">Diferencia</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(diferencias ?? []).map((d, i) => (
              <Table.Tr key={i}>
                <Table.Td>{d.renglon + 1}</Table.Td>
                <Table.Td>{d.tipo}</Table.Td>
                <Table.Td ta="right">{Number(d.esperado).toLocaleString('es-AR')}</Table.Td>
                <Table.Td ta="right">{Number(d.facturado).toLocaleString('es-AR')}</Table.Td>
                <Table.Td ta="right">{`${Number(d.diferenciaPct).toLocaleString('es-AR', { minimumFractionDigits: 2 })} %`}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="flex-end">
          <Button variant="default" onClick={onVolver}>Volver</Button>
          <Button color="orange" loading={enviando} onClick={onAceptar}>Aceptar diferencias y guardar</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
