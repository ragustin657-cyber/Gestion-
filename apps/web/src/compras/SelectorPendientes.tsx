import { Checkbox, ScrollArea, Table, Text, TextInput } from '@mantine/core';
import { ReactNode } from 'react';

export interface FilaPendiente { clave: string; pendiente: string; columnas: ReactNode[] }
export type Seleccion = Record<string, string>;

/** Tabla de pendientes con selección y cantidad editable (por defecto, el pendiente). */
export function SelectorPendientes({ titulos, filas, seleccion, onChange }: {
  titulos: string[]; filas: FilaPendiente[]; seleccion: Seleccion; onChange: (s: Seleccion) => void;
}) {
  if (!filas.length) return <Text c="dimmed" size="sm">No hay pendientes para este proveedor.</Text>;
  const todos = filas.every((f) => f.clave in seleccion);
  return (
    <ScrollArea>
      <Table withTableBorder striped miw={600}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}>
              <Checkbox aria-label="Seleccionar todos" checked={todos} onChange={() => onChange(todos ? {} : Object.fromEntries(filas.map((f) => [f.clave, String(Number(f.pendiente))])))} />
            </Table.Th>
            {titulos.map((t) => <Table.Th key={t}>{t}</Table.Th>)}
            <Table.Th ta="right">Pendiente</Table.Th>
            <Table.Th w={110}>Cantidad</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filas.map((f) => {
            const marcado = f.clave in seleccion;
            return (
              <Table.Tr key={f.clave}>
                <Table.Td>
                  <Checkbox aria-label="Seleccionar" checked={marcado} onChange={() => {
                    const s = { ...seleccion };
                    if (marcado) delete s[f.clave];
                    else s[f.clave] = String(Number(f.pendiente));
                    onChange(s);
                  }} />
                </Table.Td>
                {f.columnas.map((c, i) => <Table.Td key={i}>{c}</Table.Td>)}
                <Table.Td ta="right">{Number(f.pendiente).toLocaleString('es-AR')}</Table.Td>
                <Table.Td>
                  <TextInput size="xs" aria-label="Cantidad a tomar" disabled={!marcado} value={seleccion[f.clave] ?? ''} inputMode="decimal"
                    onChange={(e) => onChange({ ...seleccion, [f.clave]: e.currentTarget.value.replace(',', '.') })} />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
