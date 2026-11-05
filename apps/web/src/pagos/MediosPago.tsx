import { ActionIcon, Button, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { formatoMoneda } from '../compras/formato';

export interface MedioEditable {
  tipo: 'TRANSFERENCIA' | 'CHEQUE' | 'EFECTIVO' | 'CHEQUE_TERCERO';
  monedaCodigo: 'ARS' | 'USD';
  importe: string;
  cuentaBancariaId?: string | null;
  cajaId?: string | null;
  chequeraId?: string | null;
  chequeNumero?: string;
  chequeFechaPago?: string;
  referencia?: string;
  /** Cheque de terceros a endosar. */
  chequeId?: string | null;
}
export interface OpcionCuenta { id: string; etiqueta: string; monedaCodigo: string }
export interface OpcionCheque extends OpcionCuenta { importe: string }

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));
/** Un medio de cheque de terceros toma importe y moneda del cheque elegido. */
export function efectivoMedio(m: MedioEditable, cheques: OpcionCheque[] = []): MedioEditable {
  if (m.tipo !== 'CHEQUE_TERCERO') return m;
  const c = cheques.find((x) => x.id === m.chequeId);
  return c ? { ...m, importe: c.importe, monedaCodigo: c.monedaCodigo as 'ARS' | 'USD' } : { ...m, importe: '0' };
}
export const pesosMedio = (medio: MedioEditable, cotizacion: string, cheques: OpcionCheque[] = []) => {
  const m = efectivoMedio(medio, cheques);
  return Math.round(num(m.importe) * (m.monedaCodigo === 'USD' ? num(cotizacion) : 1) * 100) / 100;
};

export function MediosPago({ medios, onChange, cuentas, cajas, chequeras, cotizacion, totalACubrir, chequesCartera = [] }: {
  medios: MedioEditable[]; onChange: (m: MedioEditable[]) => void; cuentas: OpcionCuenta[]; cajas: OpcionCuenta[]; chequeras: OpcionCuenta[];
  cotizacion: string; totalACubrir: string; chequesCartera?: OpcionCheque[];
}) {
  const cambiar = (i: number, c: Partial<MedioEditable>) => onChange(medios.map((m, j) => (j === i ? { ...m, ...c } : m)));
  const cubierto = medios.reduce((s, m) => s + pesosMedio(m, cotizacion, chequesCartera), 0);
  const usados = medios.map((m) => m.chequeId).filter(Boolean);
  const falta = Math.round((num(totalACubrir) - cubierto) * 100) / 100;
  const opciones = (lista: OpcionCuenta[], moneda: string) => lista.filter((x) => x.monedaCodigo === moneda).map((x) => ({ value: x.id, label: x.etiqueta }));
  return (
    <Stack gap="xs">
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr><Table.Th w={150}>Medio</Table.Th><Table.Th w={90}>Moneda</Table.Th><Table.Th>Cuenta / caja / chequera</Table.Th><Table.Th w={130}>Importe</Table.Th><Table.Th>Datos</Table.Th><Table.Th w={36} /></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {medios.map((m, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <Select size="xs" aria-label="Medio" allowDeselect={false} value={m.tipo} data={[{ value: 'TRANSFERENCIA', label: 'Transferencia' }, { value: 'CHEQUE', label: 'Cheque' }, { value: 'EFECTIVO', label: 'Efectivo' }, { value: 'CHEQUE_TERCERO', label: 'Cheque de terceros' }]}
                  onChange={(v) => cambiar(i, { tipo: (v ?? 'TRANSFERENCIA') as MedioEditable['tipo'], cuentaBancariaId: null, cajaId: null, chequeraId: null, chequeId: null })} />
              </Table.Td>
              <Table.Td>
                <Select size="xs" aria-label="Moneda" allowDeselect={false} value={efectivoMedio(m, chequesCartera).monedaCodigo} data={['ARS', 'USD']} disabled={m.tipo === 'CHEQUE_TERCERO'}
                  onChange={(v) => cambiar(i, { monedaCodigo: (v ?? 'ARS') as 'ARS' | 'USD', cuentaBancariaId: null, cajaId: null, chequeraId: null })} />
              </Table.Td>
              <Table.Td>
                {m.tipo === 'TRANSFERENCIA' && <Select size="xs" aria-label="Cuenta bancaria" data={opciones(cuentas, m.monedaCodigo)} value={m.cuentaBancariaId ?? null} onChange={(v) => cambiar(i, { cuentaBancariaId: v })} />}
                {m.tipo === 'EFECTIVO' && <Select size="xs" aria-label="Caja" data={opciones(cajas, m.monedaCodigo)} value={m.cajaId ?? null} onChange={(v) => cambiar(i, { cajaId: v })} />}
                {m.tipo === 'CHEQUE' && <Select size="xs" aria-label="Chequera" data={opciones(chequeras, m.monedaCodigo)} value={m.chequeraId ?? null} onChange={(v) => cambiar(i, { chequeraId: v })} />}
                {m.tipo === 'CHEQUE_TERCERO' && (
                  <Select size="xs" aria-label="Cheque de terceros" searchable value={m.chequeId ?? null}
                    data={chequesCartera.filter((c) => c.id === m.chequeId || !usados.includes(c.id)).map((c) => ({ value: c.id, label: `${c.etiqueta} · ${formatoMoneda(c.importe, c.monedaCodigo)}` }))}
                    onChange={(v) => cambiar(i, { chequeId: v })} />
                )}
              </Table.Td>
              <Table.Td><TextInput size="xs" aria-label="Importe del medio" inputMode="decimal" readOnly={m.tipo === 'CHEQUE_TERCERO'} value={efectivoMedio(m, chequesCartera).importe} onChange={(e) => cambiar(i, { importe: e.currentTarget.value.replace(',', '.') })} /></Table.Td>
              <Table.Td>
                {m.tipo === 'CHEQUE' ? (
                  <Group gap={4} wrap="nowrap">
                    <TextInput size="xs" aria-label="Número de cheque" placeholder="N° (vacío: próximo)" value={m.chequeNumero ?? ''} onChange={(e) => cambiar(i, { chequeNumero: e.currentTarget.value })} />
                    <TextInput size="xs" aria-label="Fecha de pago del cheque" type="date" value={m.chequeFechaPago ?? ''} onChange={(e) => cambiar(i, { chequeFechaPago: e.currentTarget.value })} />
                  </Group>
                ) : m.tipo === 'CHEQUE_TERCERO' ? null : (
                  <TextInput size="xs" aria-label="Referencia" placeholder="Referencia" value={m.referencia ?? ''} onChange={(e) => cambiar(i, { referencia: e.currentTarget.value })} />
                )}
              </Table.Td>
              <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar medio" onClick={() => onChange(medios.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />}
          onClick={() => onChange([...medios, { tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: falta > 0 ? String(falta) : '' }])}>Agregar medio</Button>
        <Stack gap={0} align="flex-end">
          <Text size="sm">Cubierto: {formatoMoneda(cubierto)} / A cubrir: {formatoMoneda(totalACubrir)}</Text>
          {falta !== 0 && <Text size="sm" c="red" fw={600} data-testid="falta-cubrir">{falta > 0 ? `Falta ${formatoMoneda(falta)}` : `Sobra ${formatoMoneda(-falta)}`}</Text>}
        </Stack>
      </Group>
    </Stack>
  );
}
