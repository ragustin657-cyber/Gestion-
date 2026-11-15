import { Badge, Button, Checkbox, Group, Modal, Paper, Select, SimpleGrid, Stack, Table, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha } from '../compras/formato';
import { useCentrosCosto } from '../contabilidad/comun';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { Empleado, formatoCuil, useConvenios, useEmpleados } from './comun';

type Form = {
  id?: string; apellido: string; nombre: string; cuil: string; domicilio: string; fechaIngreso: string; fechaEgreso: string; categoriaId: string | null; centroCostoId: string | null;
  afiliadoSindicato: boolean; obraSocial: string; formaPago: 'EFECTIVO' | 'TRANSFERENCIA'; cbu: string; activo: boolean;
};
const vacio: Form = { apellido: '', nombre: '', cuil: '', domicilio: '', fechaIngreso: '', fechaEgreso: '', categoriaId: null, centroCostoId: null, afiliadoSindicato: true, obraSocial: '', formaPago: 'TRANSFERENCIA', cbu: '', activo: true };

export function EmpleadosPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const empleados = useEmpleados();
  const convenios = useConvenios();
  const centros = useCentrosCosto();
  const [form, setForm] = useState<Form | null>(null);
  const editable = puede('sueldos.liquidar');
  const categorias = (convenios.data ?? []).flatMap((c) => c.categorias.filter((x) => x.activa).map((x) => ({ value: x.id, label: `${c.nombre} · ${x.nombre}` })));
  const editar = (e: Empleado) => setForm({ ...vacio, ...e, cuil: formatoCuil(e.cuil), fechaEgreso: e.fechaEgreso ?? '', cbu: e.cbu ?? '' });
  const guardar = async () => {
    if (!form) return;
    const { id, ...d } = form;
    const body = { ...d, fechaEgreso: d.fechaEgreso || null, cbu: d.cbu || null, centroCostoId: d.centroCostoId || null };
    const r = await op.ejecutar(() => api(id ? `/sueldos/empleados/${id}` : '/sueldos/empleados', { metodo: id ? 'PUT' : 'POST', body }), () => 'Empleado guardado');
    if (r) { setForm(null); void qc.invalidateQueries({ queryKey: ['/sueldos/empleados'] }); }
  };
  const campo = (k: keyof Form, etiqueta: string, tipo = 'text') => form && (
    <TextInput label={etiqueta} type={tipo} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.currentTarget.value })} />
  );
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Empleados</Title>
        {editable && <Button size="xs" onClick={() => setForm({ ...vacio })}>Nuevo empleado</Button>}
      </Group>
      {errorConsulta(empleados.error)}
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Legajo</Table.Th><Table.Th>Apellido y nombre</Table.Th><Table.Th>CUIL</Table.Th><Table.Th>Categoría</Table.Th><Table.Th>Ingreso</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(empleados.data ?? []).map((e) => (
            <Table.Tr key={e.id} style={{ cursor: editable ? 'pointer' : undefined }} onClick={() => editable && editar(e)}>
              <Table.Td>{e.legajo}</Table.Td><Table.Td>{e.apellido}, {e.nombre}</Table.Td><Table.Td>{formatoCuil(e.cuil)}</Table.Td><Table.Td>{e.categoria}</Table.Td>
              <Table.Td>{formatoFecha(e.fechaIngreso)}</Table.Td>
              <Table.Td>{e.activo && !e.fechaEgreso ? <Badge color="green" variant="light">Activo</Badge> : <Badge color="gray" variant="light">{e.fechaEgreso ? `Egreso ${formatoFecha(e.fechaEgreso)}` : 'Inactivo'}</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? 'Editar empleado' : 'Nuevo empleado'}>
        {form && (
          <Stack>
            <SimpleGrid cols={2}>
              {campo('apellido', 'Apellido')}{campo('nombre', 'Nombre')}{campo('cuil', 'CUIL')}{campo('domicilio', 'Domicilio')}
              {campo('fechaIngreso', 'Fecha de ingreso', 'date')}{campo('fechaEgreso', 'Fecha de egreso', 'date')}
              <Select label="Categoría" data={categorias} value={form.categoriaId} onChange={(v) => setForm({ ...form, categoriaId: v })} searchable />
              <Select label="Centro de costo" clearable data={centros} value={form.centroCostoId} onChange={(v) => setForm({ ...form, centroCostoId: v })} />
              {campo('obraSocial', 'Obra social')}
              <Select label="Forma de pago" data={[{ value: 'TRANSFERENCIA', label: 'Transferencia bancaria' }, { value: 'EFECTIVO', label: 'Efectivo' }]} value={form.formaPago} onChange={(v) => setForm({ ...form, formaPago: (v ?? 'TRANSFERENCIA') as Form['formaPago'] })} />
              {campo('cbu', 'CBU')}
            </SimpleGrid>
            <Checkbox label="Afiliado al sindicato" checked={form.afiliadoSindicato} onChange={(e) => setForm({ ...form, afiliadoSindicato: e.currentTarget.checked })} />
            {form.id && <Checkbox label="Activo" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.currentTarget.checked })} />}
            {op.alerta}
            <Group justify="flex-end"><Button onClick={guardar} loading={op.enviando}>Guardar</Button></Group>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
