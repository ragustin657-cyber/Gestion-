import { Checkbox, Group, ScrollArea, Table, Text, TextInput } from '@mantine/core';
import { formatoFecha, formatoMoneda } from '../compras/formato';

export interface Pendiente {
  movimientoId: string; comprobante: string; fecha: string; fechaVencimiento: string; monedaCodigo: string;
  saldo: string; comprometido: string; disponible: string;
}
/** movimientoId → importe a cancelar (texto, en la moneda del comprobante). */
export type SeleccionImputaciones = Record<string, string>;

const aNumero = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));

/** Total a cancelar en pesos según la selección y la cotización del dólar. */
export function totalSeleccion(pendientes: Pendiente[], seleccion: SeleccionImputaciones, cotizacion: string): number {
  return pendientes.reduce((s, p) => {
    if (!(p.movimientoId in seleccion)) return s;
    const imp = aNumero(seleccion[p.movimientoId]);
    return s + (p.monedaCodigo === 'USD' ? imp * aNumero(cotizacion) : imp);
  }, 0);
}

export function SelectorComprobantes({ pendientes, seleccion, onChange, cotizacion, soloLectura }: {
  pendientes: Pendiente[]; seleccion: SeleccionImputaciones; onChange: (s: SeleccionImputaciones) => void; cotizacion: string; soloLectura?: boolean;
}) {
  if (!pendientes.length) return <Text c="dimmed" size="sm">El proveedor no tiene comprobantes pendientes.</Text>;
  const todos = pendientes.every((p) => p.movimientoId in seleccion);
  const total = totalSeleccion(pendientes, seleccion, cotizacion);
  return (
    <>
      <ScrollArea>
        <Table withTableBorder striped miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40}>
                <Checkbox aria-label="Seleccionar todos" checked={todos} disabled={soloLectura}
                  onChange={() => onChange(todos ? {} : Object.fromEntries(pendientes.map((p) => [p.movimientoId, String(Number(p.disponible))])))} />
              </Table.Th>
              <Table.Th>Comprobante</Table.Th><Table.Th>Vencimiento</Table.Th><Table.Th ta="right">Saldo</Table.Th>
              <Table.Th ta="right">En otras OP</Table.Th><Table.Th ta="right">Disponible</Table.Th><Table.Th w={150}>A cancelar</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pendientes.map((p) => {
              const marcado = p.movimientoId in seleccion;
              const excede = marcado && Math.abs(aNumero(seleccion[p.movimientoId])) > Math.abs(Number(p.disponible));
              return (
                <Table.Tr key={p.movimientoId}>
                  <Table.Td>
                    <Checkbox aria-label="Seleccionar" checked={marcado} disabled={soloLectura} onChange={() => {
                      const s = { ...seleccion };
                      if (marcado) delete s[p.movimientoId];
                      else s[p.movimientoId] = String(Number(p.disponible));
                      onChange(s);
                    }} />
                  </Table.Td>
                  <Table.Td>{p.comprobante}</Table.Td>
                  <Table.Td>{formatoFecha(p.fechaVencimiento)}</Table.Td>
                  <Table.Td ta="right">{formatoMoneda(p.saldo, p.monedaCodigo)}</Table.Td>
                  <Table.Td ta="right">{Number(p.comprometido) ? formatoMoneda(p.comprometido, p.monedaCodigo) : ''}</Table.Td>
                  <Table.Td ta="right">{formatoMoneda(p.disponible, p.monedaCodigo)}</Table.Td>
                  <Table.Td>
                    <TextInput size="xs" aria-label="Importe a cancelar" inputMode="decimal" disabled={!marcado || soloLectura}
                      value={seleccion[p.movimientoId] ?? ''} error={excede ? 'Supera el disponible' : undefined}
                      onChange={(e) => onChange({ ...seleccion, [p.movimientoId]: e.currentTarget.value.replace(',', '.') })} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify="flex-end" mt="xs">
        <Text fw={700} data-testid="total-cancelar">Total a cancelar: {formatoMoneda(total)}</Text>
      </Group>
    </>
  );
}
