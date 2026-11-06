import { Badge, Button, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { Linea, Movimiento, Sugerencia } from './tipos';

const NIVEL = { EXACTA: { etiqueta: 'Exacta', color: 'green' }, PROBABLE: { etiqueta: 'Probable', color: 'yellow' }, AGRUPADA: { etiqueta: 'Agrupada', color: 'blue' } };

export function SugerenciasModal({ sugerencias, lineas, movimientos, abierto, onCerrar, onAplicar, enviando }: {
  sugerencias: Sugerencia[]; lineas: Linea[]; movimientos: Movimiento[]; abierto: boolean; onCerrar: () => void; onAplicar: (s: Sugerencia[]) => void; enviando: boolean;
}) {
  const [elegidas, setElegidas] = useState<number[]>([]);
  useEffect(() => setElegidas(sugerencias.map((s, i) => (s.preseleccionada ? i : -1)).filter((i) => i >= 0)), [sugerencias]);
  const desc = (ids: string[], lista: { id: string; fecha: string; importe: string }[], texto: (x: never) => string) =>
    ids.map((id) => lista.find((x) => x.id === id)).filter(Boolean).map((x) => `${formatoFecha(x!.fecha)} ${texto(x as never)} ${formatoMoneda(x!.importe)}`).join(' + ');
  return (
    <Modal opened={abierto} onClose={onCerrar} title="Coincidencias encontradas" size="xl">
      {!sugerencias.length ? <Text c="dimmed">No se encontraron coincidencias.</Text> : (
        <Stack>
          <ScrollArea>
            <Table withTableBorder striped miw={720}>
              <Table.Thead><Table.Tr><Table.Th w={36} /><Table.Th>Nivel</Table.Th><Table.Th>Extracto</Table.Th><Table.Th>Sistema</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {sugerencias.map((s, i) => (
                  <Table.Tr key={i}>
                    <Table.Td><Checkbox aria-label={`Coincidencia ${i + 1}`} checked={elegidas.includes(i)} onChange={() => setElegidas(elegidas.includes(i) ? elegidas.filter((x) => x !== i) : [...elegidas, i])} /></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={NIVEL[s.nivel].color}>{NIVEL[s.nivel].etiqueta}</Badge></Table.Td>
                    <Table.Td><Text size="xs">{desc(s.lineas, lineas, (l: Linea) => l.concepto)}</Text></Table.Td>
                    <Table.Td><Text size="xs">{desc(s.movimientos, movimientos, (m: Movimiento) => `${m.descripcion}${m.referencia ? ` (${m.referencia})` : ''}`)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group justify="flex-end">
            <Button loading={enviando} disabled={!elegidas.length} onClick={() => onAplicar(elegidas.map((i) => sugerencias[i]))}>Aplicar ({elegidas.length})</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
