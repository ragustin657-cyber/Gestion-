import { Button, Group, Modal, Paper, Select, Stack, Table, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useTodasLasCuentas } from '../contabilidad/comun';
import { useOperacion } from '../tesoreria/comun';
import { Rubro, useRubros } from './comun';

type Form = { id?: string; nombre: string; cuentaOrigenId: string | null; cuentaAmortizacionId: string | null; cuentaGastoId: string | null; vidaUtilMeses: string };
const vacio: Form = { nombre: '', cuentaOrigenId: null, cuentaAmortizacionId: null, cuentaGastoId: null, vidaUtilMeses: '60' };

export function RubrosPage() {
  const qc = useQueryClient();
  const rubros = useRubros();
  const cuentas = useTodasLasCuentas();
  const op = useOperacion();
  const [form, setForm] = useState<Form | null>(null);
  const editar = (r: Rubro) => setForm({ id: r.id, nombre: r.nombre, cuentaOrigenId: r.cuentaOrigenId ?? null, cuentaAmortizacionId: r.cuentaAmortizacionId ?? null, cuentaGastoId: r.cuentaGastoId ?? null, vidaUtilMeses: String(r.vidaUtilMeses) });
  const guardar = async () => {
    if (!form) return;
    const body = { nombre: form.nombre, cuentaOrigenId: form.cuentaOrigenId, cuentaAmortizacionId: form.cuentaAmortizacionId, cuentaGastoId: form.cuentaGastoId, vidaUtilMeses: Number(form.vidaUtilMeses) };
    const r = await op.ejecutar(() => api(form.id ? `/bienes-uso/rubros/${form.id}` : '/bienes-uso/rubros', { metodo: form.id ? 'PUT' : 'POST', body }), () => 'Rubro guardado');
    if (r) { setForm(null); void qc.invalidateQueries({ queryKey: ['/bienes-uso/rubros'] }); }
  };
  const cuenta = (c?: { codigo: string; nombre: string }) => (c ? `${c.codigo} ${c.nombre}` : '');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Rubros de bienes de uso</Title>
        <Button size="xs" onClick={() => setForm({ ...vacio })}>Nuevo rubro</Button>
      </Group>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Rubro</Table.Th><Table.Th>Valor de origen</Table.Th><Table.Th>Amortización acumulada</Table.Th><Table.Th>Gasto</Table.Th><Table.Th ta="right">Vida útil (meses)</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(rubros.data ?? []).map((r) => (
            <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => editar(r)}>
              <Table.Td>{r.nombre}</Table.Td><Table.Td>{cuenta(r.cuentaOrigen)}</Table.Td><Table.Td>{cuenta(r.cuentaAmortizacion)}</Table.Td><Table.Td>{cuenta(r.cuentaGasto)}</Table.Td><Table.Td ta="right">{r.vidaUtilMeses}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? 'Modificar rubro' : 'Nuevo rubro'} size="lg">
        {form && <Stack>
          <TextInput label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.currentTarget.value })} />
          <Select label="Cuenta de valor de origen" searchable data={cuentas} value={form.cuentaOrigenId} onChange={(v) => setForm({ ...form, cuentaOrigenId: v })} />
          <Select label="Cuenta de amortización acumulada" searchable data={cuentas} value={form.cuentaAmortizacionId} onChange={(v) => setForm({ ...form, cuentaAmortizacionId: v })} />
          <Select label="Cuenta de gasto de amortización" searchable data={cuentas} value={form.cuentaGastoId} onChange={(v) => setForm({ ...form, cuentaGastoId: v })} />
          <TextInput label="Vida útil (meses)" inputMode="numeric" value={form.vidaUtilMeses} onChange={(e) => setForm({ ...form, vidaUtilMeses: e.currentTarget.value })} />
          {op.alerta}
          <Group><Button loading={op.enviando} onClick={() => void guardar()}>Guardar</Button></Group>
        </Stack>}
      </Modal>
    </Paper>
  );
}
