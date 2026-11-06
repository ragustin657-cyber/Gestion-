import { ActionIcon, Button, Group, Select, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { formatoMoneda } from '../compras/formato';
import { totalesAsiento } from './asiento';

export interface RenglonEditable { cuentaContableId: string | null; centroCostoId: string | null; debe: string; haber: string; detalle: string }
export const renglonVacio = (): RenglonEditable => ({ cuentaContableId: null, centroCostoId: null, debe: '', haber: '', detalle: '' });
type Opcion = { value: string; label: string };

/** Grilla de renglones con totales en vivo; "Registrar asiento" solo si balancea y tiene al menos dos renglones. */
export function GrillaAsiento({ renglones, onChange, cuentas, centros, onRegistrar, enviando, textoBoton = 'Registrar asiento' }: {
  renglones: RenglonEditable[]; onChange: (r: RenglonEditable[]) => void; cuentas: Opcion[]; centros: Opcion[]; onRegistrar: () => void; enviando?: boolean; textoBoton?: string;
}) {
  const cambiar = (i: number, c: Partial<RenglonEditable>) => onChange(renglones.map((r, j) => (j === i ? { ...r, ...c } : r)));
  const t = totalesAsiento(renglones);
  const completos = renglones.filter((r) => r.cuentaContableId && (r.debe || r.haber)).length;
  const valido = t.diferencia === 0 && t.debe > 0 && completos >= 2 && completos === renglones.length;
  return (
    <>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th w={180}>Centro de costo</Table.Th><Table.Th w={140}>Debe</Table.Th><Table.Th w={140}>Haber</Table.Th><Table.Th>Detalle</Table.Th><Table.Th w={36} /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {renglones.map((r, i) => (
            <Table.Tr key={i}>
              <Table.Td><Select size="xs" aria-label="Cuenta" searchable data={cuentas} value={r.cuentaContableId} onChange={(v) => cambiar(i, { cuentaContableId: v })} /></Table.Td>
              <Table.Td><Select size="xs" aria-label="Centro de costo" clearable data={centros} value={r.centroCostoId} onChange={(v) => cambiar(i, { centroCostoId: v })} /></Table.Td>
              <Table.Td><TextInput size="xs" aria-label="Debe" inputMode="decimal" value={r.debe} onChange={(e) => cambiar(i, { debe: e.currentTarget.value, haber: e.currentTarget.value ? '' : r.haber })} /></Table.Td>
              <Table.Td><TextInput size="xs" aria-label="Haber" inputMode="decimal" value={r.haber} onChange={(e) => cambiar(i, { haber: e.currentTarget.value, debe: e.currentTarget.value ? '' : r.debe })} /></Table.Td>
              <Table.Td><TextInput size="xs" aria-label="Detalle" value={r.detalle} onChange={(e) => cambiar(i, { detalle: e.currentTarget.value })} /></Table.Td>
              <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar renglón" onClick={() => onChange(renglones.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr><Table.Th colSpan={2}>Totales</Table.Th><Table.Th>{formatoMoneda(t.debe)}</Table.Th><Table.Th>{formatoMoneda(t.haber)}</Table.Th><Table.Th colSpan={2} /></Table.Tr>
        </Table.Tfoot>
      </Table>
      <Group justify="space-between" mt="sm">
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => onChange([...renglones, renglonVacio()])}>Agregar renglón</Button>
        <Group>
          {t.diferencia !== 0 && <Text c="red" fw={600} data-testid="diferencia-asiento">Diferencia {formatoMoneda(Math.abs(t.diferencia))}</Text>}
          <Button disabled={!valido} loading={enviando} onClick={onRegistrar}>{textoBoton}</Button>
        </Group>
      </Group>
    </>
  );
}
