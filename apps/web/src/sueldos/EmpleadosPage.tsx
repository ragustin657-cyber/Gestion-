import { Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha } from '../compras/formato';
import { useCentrosCosto } from '../contabilidad/comun';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { Empleado, formatoCuil, useConvenios, useEmpleados } from './comun';
import { DatosBaja, DialogoBaja } from './DialogoBaja';
import { useNavigate } from 'react-router-dom';

type Form = {
  id?: string; apellido: string; nombre: string; cuil: string; domicilio: string; fechaIngreso: string; fechaEgreso: string; categoriaId: string | null; centroCostoId: string | null;
  afiliadoSindicato: boolean; obraSocial: string; formaPago: 'EFECTIVO' | 'TRANSFERENCIA'; cbu: string; activo: boolean;
  codigoSituacion: number; codigoCondicion: number; codigoActividad: number; codigoModalidad: number; codigoZona: number | null; codigoObraSocial: string;
  conyuge: boolean; cantidadHijos: number; adherentesObraSocial: number; trabajadorConvencionado: boolean;
};
const vacio: Form = { apellido: '', nombre: '', cuil: '', domicilio: '', fechaIngreso: '', fechaEgreso: '', categoriaId: null, centroCostoId: null, afiliadoSindicato: true, obraSocial: '', formaPago: 'TRANSFERENCIA', cbu: '', activo: true,
  codigoSituacion: 1, codigoCondicion: 1, codigoActividad: 49, codigoModalidad: 8, codigoZona: null, codigoObraSocial: '000000', conyuge: false, cantidadHijos: 0, adherentesObraSocial: 0, trabajadorConvencionado: true };

/** Saldos por año y períodos de vacaciones del empleado (ficha). */
function VacacionesEmpleado({ empleadoId }: { empleadoId: string }) {
  const q = useQuery({ queryKey: ['/sueldos/empleados/vacaciones', empleadoId], queryFn: () => api<{ saldos: { anio: number; corresponden: number; tomados: number; pendientes: number }[]; periodos: { id: string; anio: number; desde: string; hasta: string; dias: number; liquidado: boolean }[] }>(`/sueldos/empleados/${empleadoId}/vacaciones`) });
  if (!q.data) return null;
  return (
    <Stack gap={4}>
      <Title order={5}>Vacaciones</Title>
      {q.data.saldos.map((x) => <Text key={x.anio} size="sm">{x.anio}: corresponden {x.corresponden} · tomados {x.tomados} · pendientes <Text span c={x.pendientes < 0 ? 'red' : undefined} fw={600}>{x.pendientes}</Text></Text>)}
      {q.data.periodos.map((p) => <Text key={p.id} size="xs" c="dimmed">{formatoFecha(p.desde)} al {formatoFecha(p.hasta)} · {p.dias} días ({p.anio}){p.liquidado ? ' · pagado' : ''}</Text>)}
    </Stack>
  );
}

/** "Dar de baja" para cualquier empleado guardado: también inactivos con egreso cargado a mano (spec E20 §9.7); la API rechaza una segunda final. */
export const mostrarDarDeBaja = (f: { id?: string; activo?: boolean }) => !!f.id;

export function EmpleadosPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const empleados = useEmpleados();
  const convenios = useConvenios();
  const centros = useCentrosCosto();
  const [form, setForm] = useState<Form | null>(null);
  const [baja, setBaja] = useState<Empleado | null>(null);
  const navegar = useNavigate();
  const darDeBaja = async (d: DatosBaja) => {
    const r = await op.ejecutar(() => api<{ id: string }>('/sueldos/egresos', { metodo: 'POST', body: d }), () => 'Liquidación final creada');
    if (r) { setBaja(null); setForm(null); navegar(`/sueldos/liquidaciones/${r.id}`); }
  };
  const editable = puede('sueldos.liquidar');
  const categorias = (convenios.data ?? []).flatMap((c) => c.categorias.filter((x) => x.activa).map((x) => ({ value: x.id, label: `${c.nombre} · ${x.nombre}` })));
  const editar = (e: Empleado) => setForm({ ...vacio, ...(e as Partial<Form>), cuil: formatoCuil(e.cuil), fechaEgreso: e.fechaEgreso ?? '', cbu: e.cbu ?? '' } as Form);
  const guardar = async () => {
    if (!form) return;
    const { id, ...d } = form;
    const body = { ...d, fechaEgreso: d.fechaEgreso || null, cbu: d.cbu || null, centroCostoId: d.centroCostoId || null };
    const r = await op.ejecutar(() => api(id ? `/sueldos/empleados/${id}` : '/sueldos/empleados', { metodo: id ? 'PUT' : 'POST', body }), () => 'Empleado guardado');
    if (r) { setForm(null); void qc.invalidateQueries({ queryKey: ['/sueldos/empleados'] }); }
  };
  /** Código ARCA numérico, con los valores más usados como ayuda. */
  const codigo = (k: 'codigoSituacion' | 'codigoCondicion' | 'codigoActividad' | 'codigoModalidad', etiqueta: string, opciones: [number, string][]) => form && (
    <NumberInput label={etiqueta} description={opciones.map(([, l]) => l).join(' · ')} min={0} max={999} value={form[k]} onChange={(v) => setForm({ ...form, [k]: Number(v) || 0 })} />
  );
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
            {form.id && <VacacionesEmpleado empleadoId={form.id} />}
            <Title order={5}>Datos para el F.931</Title>
            <SimpleGrid cols={3}>
              {codigo('codigoSituacion', 'Situación', [[1, '1 Activo'], [13, '13 Licencia'], [5, '5 Licencia por maternidad']])}
              {codigo('codigoCondicion', 'Condición', [[1, '1 Servicios comunes mayor de 18'], [0, '0 Jubilado']])}
              {codigo('codigoActividad', 'Actividad', [[49, '49 Actividades no clasificadas'], [1, '1 Servicios comunes']])}
              {codigo('codigoModalidad', 'Modalidad de contratación', [[8, '8 Tiempo indeterminado'], [14, '14 Nuevo período de prueba'], [102, '102 Tiempo parcial indeterminado']])}
              <NumberInput label="Zona (vacío = la de la empresa)" value={form.codigoZona ?? ''} onChange={(v) => setForm({ ...form, codigoZona: v === '' ? null : Number(v) })} min={0} max={99} />
              <TextInput label="Código de obra social (RNOS)" value={form.codigoObraSocial} maxLength={6} onChange={(e) => setForm({ ...form, codigoObraSocial: e.currentTarget.value })} />
              <NumberInput label="Cantidad de hijos" value={form.cantidadHijos} min={0} onChange={(v) => setForm({ ...form, cantidadHijos: Number(v) || 0 })} />
              <NumberInput label="Adherentes de obra social" value={form.adherentesObraSocial} min={0} onChange={(v) => setForm({ ...form, adherentesObraSocial: Number(v) || 0 })} />
            </SimpleGrid>
            <Group>
              <Checkbox label="Cónyuge" checked={form.conyuge} onChange={(e) => setForm({ ...form, conyuge: e.currentTarget.checked })} />
              <Checkbox label="Trabajador convencionado" checked={form.trabajadorConvencionado} onChange={(e) => setForm({ ...form, trabajadorConvencionado: e.currentTarget.checked })} />
            </Group>
            {form.id && <Checkbox label="Activo" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.currentTarget.checked })} />}
            {op.alerta}
            <Group justify="space-between">
              {mostrarDarDeBaja(form) ? <Button variant="subtle" color="red" onClick={() => setBaja((empleados.data ?? []).find((x) => x.id === form.id) ?? null)}>Dar de baja</Button> : <span />}
              <Button onClick={guardar} loading={op.enviando}>Guardar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!baja} onClose={() => setBaja(null)} title="Dar de baja: liquidación final">
        {baja && <><DialogoBaja empleado={baja} onConfirmar={darDeBaja} enviando={op.enviando} />{op.alerta}</>}
      </Modal>
    </Paper>
  );
}
