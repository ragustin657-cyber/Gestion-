import { Checkbox, Radio, ScrollArea, Table, Text } from '@mantine/core';
import { formatoFecha, formatoMoneda } from '../compras/formato';

export interface ChequeFila {
  id: string;
  banco: string;
  numero: string;
  libradorNombre: string;
  fechaPago: string;
  monedaCodigo: string;
  importe: string;
  caja?: { nombre: string; sucursal: string } | null;
}

/** Tabla de cheques de terceros con selección (múltiple con casillas o simple con radio) y total seleccionado. */
export function SelectorCheques({ cheques, seleccion, onChange, multiple = true }: {
  cheques: ChequeFila[]; seleccion: string[]; onChange: (ids: string[]) => void; multiple?: boolean;
}) {
  const alternar = (id: string) => {
    if (!multiple) return onChange([id]);
    onChange(seleccion.includes(id) ? seleccion.filter((x) => x !== id) : [...seleccion, id]);
  };
  const elegidos = cheques.filter((c) => seleccion.includes(c.id));
  const total = elegidos.reduce((s, c) => s + Number(c.importe), 0);
  const moneda = elegidos[0]?.monedaCodigo ?? cheques[0]?.monedaCodigo ?? 'ARS';
  return (
    <>
      <ScrollArea>
        <Table withTableBorder striped miw={640}>
          <Table.Thead>
            <Table.Tr><Table.Th w={36} /><Table.Th>Banco</Table.Th><Table.Th>Número</Table.Th><Table.Th>Librador</Table.Th><Table.Th>Fecha de pago</Table.Th><Table.Th>Caja</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {cheques.map((c) => {
              const etiqueta = `Cheque ${c.numero} ${c.banco}`;
              return (
                <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => alternar(c.id)}>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {multiple
                      ? <Checkbox aria-label={etiqueta} checked={seleccion.includes(c.id)} onChange={() => alternar(c.id)} />
                      : <Radio aria-label={etiqueta} checked={seleccion.includes(c.id)} onChange={() => alternar(c.id)} />}
                  </Table.Td>
                  <Table.Td>{c.banco}</Table.Td><Table.Td>{c.numero}</Table.Td><Table.Td>{c.libradorNombre}</Table.Td>
                  <Table.Td>{formatoFecha(c.fechaPago)}</Table.Td><Table.Td>{c.caja ? `${c.caja.nombre} (${c.caja.sucursal})` : '—'}</Table.Td>
                  <Table.Td ta="right">{formatoMoneda(c.importe, c.monedaCodigo)}</Table.Td>
                </Table.Tr>
              );
            })}
            {!cheques.length && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" size="sm" ta="center">No hay cheques disponibles</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Text size="sm" fw={600} ta="right" mt={4} data-testid="total-seleccionado">Total seleccionado: {formatoMoneda(total, moneda)}</Text>
    </>
  );
}
