import { Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Textarea, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { Clase, CLASES, Concepto, TIPOS_CONCEPTO, useConceptos } from './comun';

type Form = { id?: string; codigo: string; nombre: string; clase: Clase; tipo: string; parametros: string; orden: number; soloAfiliados: boolean; activo: boolean };
const vacio: Form = { codigo: '', nombre: '', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: '{ "importe": 0 }', orden: 300, soloAfiliados: false, activo: true };

/** Parámetros en una línea: "porcentaje: 11 · base: REMUNERATIVO". */
const resumenParametros = (p: Record<string, unknown>) => Object.entries(p).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');

export function ConceptosPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const conceptos = useConceptos();
  const editable = puede('sueldos.liquidar');
  const [form, setForm] = useState<Form | null>(null);
  const editar = (c: Concepto) => setForm({ ...c, parametros: JSON.stringify(c.parametros, null, 2) });
  const guardar = async () => {
    if (!form) return;
    let parametros: unknown;
    try { parametros = JSON.parse(form.parametros || '{}'); } catch { op.setError('Parámetros inválidos: deben estar en formato JSON'); return; }
    const { id, ...d } = form;
    const r = await op.ejecutar(() => api(id ? `/sueldos/conceptos/${id}` : '/sueldos/conceptos', { metodo: id ? 'PUT' : 'POST', body: { ...d, parametros } }), () => 'Concepto guardado');
    if (r) { setForm(null); void qc.invalidateQueries({ queryKey: ['/sueldos/conceptos'] }); }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Conceptos de liquidación</Title>
        {editable && <Button size="xs" onClick={() => setForm({ ...vacio })}>Nuevo concepto</Button>}
      </Group>
      {errorConsulta(conceptos.error)}
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Código</Table.Th><Table.Th>Concepto</Table.Th><Table.Th>Clase</Table.Th><Table.Th>Cálculo</Table.Th><Table.Th>Parámetros</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(conceptos.data ?? []).map((c) => (
            <Table.Tr key={c.id} style={{ cursor: editable ? 'pointer' : undefined }} onClick={() => editable && editar(c)}>
              <Table.Td>{c.codigo}</Table.Td><Table.Td>{c.nombre}{c.soloAfiliados ? ' (solo afiliados)' : ''}</Table.Td><Table.Td>{CLASES[c.clase]}</Table.Td>
              <Table.Td>{TIPOS_CONCEPTO[c.tipo] ?? c.tipo}</Table.Td><Table.Td>{resumenParametros(c.parametros)}</Table.Td>
              <Table.Td>{c.activo ? <Badge color="green" variant="light">Activo</Badge> : <Badge color="gray" variant="light">Inactivo</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? 'Editar concepto' : 'Nuevo concepto'}>
        {form && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.currentTarget.value })} />
              <TextInput label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.currentTarget.value })} />
              <Select label="Clase" data={Object.entries(CLASES).map(([value, label]) => ({ value, label }))} value={form.clase} onChange={(v) => setForm({ ...form, clase: (v ?? 'REMUNERATIVO') as Clase })} />
              <Select label="Cálculo" data={Object.entries(TIPOS_CONCEPTO).map(([value, label]) => ({ value, label }))} value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v ?? 'FIJO' })} />
              <NumberInput label="Orden" value={form.orden} onChange={(v) => setForm({ ...form, orden: Number(v) || 0 })} />
            </SimpleGrid>
            <Textarea label="Parámetros (JSON)" autosize minRows={3} value={form.parametros} onChange={(e) => setForm({ ...form, parametros: e.currentTarget.value })} />
            <Checkbox label="Solo afiliados al sindicato" checked={form.soloAfiliados} onChange={(e) => setForm({ ...form, soloAfiliados: e.currentTarget.checked })} />
            <Checkbox label="Activo" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.currentTarget.checked })} />
            {op.alerta}
            <Group justify="flex-end"><Button onClick={guardar} loading={op.enviando}>Guardar</Button></Group>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
