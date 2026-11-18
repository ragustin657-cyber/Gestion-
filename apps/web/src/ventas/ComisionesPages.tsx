import { Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconFileTypePdf } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { useEmpleados } from '../sueldos/comun';
import { useOperacionVentas } from './comun';

export interface Vendedor { id: string; nombre: string; tipo?: 'EMPLEADO' | 'EXTERNO'; porcentaje?: string; empleadoId?: string | null; proveedorId?: string | null; activo: boolean; empleado?: string | null; proveedor?: string | null }
interface DetalleComision { tipo: 'COBRO' | 'ANULACION' | 'RECHAZO'; fecha: string; cliente: string; comprobante: string; cobro: string; cobrado: string; neto: string; porcentaje: string; comision: string }
export interface FilaComision { vendedorId: string; nombre: string; tipo: string; renglones: number; neto: string; comision: string; liquidable: boolean; detalle: DetalleComision[] }
interface LiquidacionComisiones { id: string; numero: number; anio: number; mes: number; fecha: string; estado: 'CONFIRMADA' | 'ANULADA'; total: string; motivoAnulacion: string | null; externos: { vendedorId: string; nombre: string }[] }

export const useVendedores = () => useQuery({ queryKey: ['/ventas/vendedores'], queryFn: () => api<Vendedor[]>('/ventas/vendedores') }).data ?? [];

/** Selector de vendedor: solo los activos (más el elegido, aunque esté inactivo) y "Sin vendedor". */
export function SelectorVendedor({ vendedores, value, onChange, disabled, w = 220 }: { vendedores: Vendedor[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; w?: number }) {
  const data = [{ value: '', label: 'Sin vendedor' }, ...vendedores.filter((v) => v.activo || v.id === value).map((v) => ({ value: v.id, label: v.nombre }))];
  return <Select label="Vendedor" w={w} data={data} value={value ?? ''} onChange={(v) => onChange(v || null)} disabled={disabled} allowDeselect={false} />;
}

const TIPOS: Record<string, string> = { EMPLEADO: 'Empleado', EXTERNO: 'Externo' };
/** Porcentaje del vendedor en el mes: el único de sus renglones, o "varios" si cambió entre facturas. */
const porcentaje = (detalle: { porcentaje: string }[]) => {
  const distintos = [...new Set(detalle.map((d) => Number(d.porcentaje)))];
  return distintos.length === 1 ? distintos[0].toLocaleString('es-AR', { minimumFractionDigits: 2 }) : distintos.length ? 'varios' : '';
};
const TIPOS_RENGLON: Record<string, string> = { COBRO: 'Cobro', ANULACION: 'Cobro anulado', RECHAZO: 'Cheque rechazado' };

/** Comisiones pendientes del mes por vendedor, con el detalle desplegable. */
export function TablaComisiones({ vendedores, puedeLiquidar, onConfirmar, enviando }: { vendedores: FilaComision[]; puedeLiquidar: boolean; onConfirmar: () => void; enviando?: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const hayLiquidables = vendedores.some((v) => v.liquidable);
  return (
    <Stack>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th w={30} /><Table.Th>Vendedor</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Renglones</Table.Th><Table.Th ta="right">Neto cobrado</Table.Th><Table.Th ta="right">%</Table.Th><Table.Th ta="right">Comisión</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {vendedores.map((v) => (
            <Fragment key={v.vendedorId}>
              <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setAbierto(abierto === v.vendedorId ? null : v.vendedorId)}>
                <Table.Td>{abierto === v.vendedorId ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</Table.Td>
                <Table.Td>{v.nombre}</Table.Td><Table.Td>{TIPOS[v.tipo] ?? v.tipo}</Table.Td><Table.Td ta="right">{v.renglones}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(v.neto)}</Table.Td>
                <Table.Td ta="right">{porcentaje(v.detalle)}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(v.comision)}{!v.liquidable && <Text size="xs" c="dimmed">Queda para el mes siguiente</Text>}</Table.Td>
              </Table.Tr>
              {abierto === v.vendedorId && (
                <Table.Tr><Table.Td colSpan={7}>
                  <Table withRowBorders={false} fz="xs">
                    <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Cobro</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Cobrado</Table.Th><Table.Th ta="right">Neto</Table.Th><Table.Th ta="right">%</Table.Th><Table.Th ta="right">Comisión</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>
                      {v.detalle.map((d, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{formatoFecha(d.fecha)}</Table.Td><Table.Td>{d.cliente}</Table.Td><Table.Td>{d.comprobante}</Table.Td><Table.Td>{d.cobro}</Table.Td><Table.Td>{TIPOS_RENGLON[d.tipo]}</Table.Td>
                          <Table.Td ta="right">{formatoMoneda(d.cobrado)}</Table.Td><Table.Td ta="right">{formatoMoneda(d.neto)}</Table.Td><Table.Td ta="right">{Number(d.porcentaje).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</Table.Td><Table.Td ta="right">{formatoMoneda(d.comision)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.Td></Table.Tr>
              )}
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        {hayLiquidables ? <span /> : <Text c="dimmed">Sin comisiones para liquidar</Text>}
        {puedeLiquidar && <Button disabled={!hayLiquidables} loading={enviando} onClick={onConfirmar}>Confirmar liquidación</Button>}
      </Group>
    </Stack>
  );
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function ComisionesPage() {
  const { puede } = useAuth();
  const op = useOperacionVentas();
  const [anio, setAnio] = useState(Number(hoy().slice(0, 4)));
  const [mes, setMes] = useState(Number(hoy().slice(5, 7)));
  const vendedores = useVendedores();
  const consulta = useQuery({ queryKey: ['/ventas/comisiones', anio, mes], queryFn: () => api<{ vendedores: FilaComision[] }>('/ventas/comisiones', { query: { anio, mes } }) });
  const historial = useQuery({ queryKey: ['/ventas/comisiones/liquidaciones'], queryFn: () => api<LiquidacionComisiones[]>('/ventas/comisiones/liquidaciones') });
  const [pdf, setPdf] = useState<LiquidacionComisiones | null>(null);
  const mm = (l: { anio: number; mes: number }) => `${String(l.mes).padStart(2, '0')}/${l.anio}`;
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={3}>Comisiones de {String(mes).padStart(2, '0')}/{anio}</Title>
          <Group>
            <Select aria-label="Mes" w={140} data={MESES.map((m, i) => ({ value: String(i + 1), label: m }))} value={String(mes)} onChange={(v) => setMes(Number(v) || mes)} allowDeselect={false} />
            <NumberInput aria-label="Año" w={100} value={anio} onChange={(v) => setAnio(Number(v) || anio)} min={2000} max={2100} />
          </Group>
        </Group>
        {op.error && <Alert color="red" mb="sm">{op.error}</Alert>}
        <TablaComisiones vendedores={consulta.data?.vendedores ?? []} puedeLiquidar={puede('comisiones.liquidar')} enviando={op.enviando}
          onConfirmar={() => void op.ejecutar(() => api<{ numero: number }>('/ventas/comisiones', { metodo: 'POST', body: { anio, mes } }), (r) => `Liquidación de comisiones N° ${r.numero} confirmada`)} />
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Liquidaciones</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Mes</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(historial.data ?? []).map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>{l.numero}</Table.Td><Table.Td>{mm(l)}</Table.Td><Table.Td ta="right">{formatoMoneda(l.total)}</Table.Td>
                <Table.Td>{l.estado === 'ANULADA' ? <Badge color="gray" variant="light">Anulada</Badge> : <Badge color="green" variant="light">Confirmada</Badge>}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    {l.externos.length > 0 && <Button size="compact-xs" variant="subtle" leftSection={<IconFileTypePdf size={14} />} onClick={() => setPdf(l)}>PDF</Button>}
                    {puede('comisiones.liquidar') && l.estado === 'CONFIRMADA' && (
                      <Button size="compact-xs" variant="subtle" color="red" disabled={op.enviando} onClick={() => {
                        const motivo = window.prompt(`Motivo de la anulación de las comisiones de ${mm(l)}`);
                        if (motivo) void op.ejecutar(() => api(`/ventas/comisiones/liquidaciones/${l.id}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Liquidación de comisiones anulada');
                      }}>Anular</Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={!!pdf} onClose={() => setPdf(null)} title="Liquidación para el vendedor externo">
        <Stack>
          {(pdf?.externos ?? []).map((v) => (
            <Button key={v.vendedorId} variant="light" leftSection={<IconFileTypePdf size={14} />} onClick={() => void descargar(`/ventas/comisiones/liquidaciones/${pdf!.id}/pdf`, { vendedorId: v.vendedorId }, `comisiones-${pdf!.anio}-${pdf!.mes}-${v.nombre}.pdf`).catch(() => op.setError(`No se pudo descargar el PDF de ${v.nombre}`))}>{v.nombre}</Button>
          ))}
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Maestro de vendedores. */
export function VendedoresPage() {
  const op = useOperacionVentas();
  const vendedores = useVendedores();
  const empleados = useEmpleados().data ?? [];
  const proveedores = useQuery({ queryKey: ['/terceros', 'proveedores', 'vendedores'], queryFn: () => api<{ items: { id: string; razonSocial: string }[] }>('/terceros', { query: { tipo: 'proveedor', activo: 'true', porPagina: 200 } }) }).data?.items ?? [];
  const [form, setForm] = useState<{ id?: string; nombre: string; tipo: 'EMPLEADO' | 'EXTERNO'; porcentaje: number | string; empleadoId: string | null; proveedorId: string | null; activo: boolean } | null>(null);
  const guardar = async () => {
    if (!form) return;
    const body = { nombre: form.nombre, tipo: form.tipo, porcentaje: Number(form.porcentaje), empleadoId: form.tipo === 'EMPLEADO' ? form.empleadoId : null, proveedorId: form.tipo === 'EXTERNO' ? form.proveedorId : null, activo: form.activo };
    if (await op.ejecutar(() => api(form.id ? `/ventas/vendedores/${form.id}` : '/ventas/vendedores', { metodo: form.id ? 'PUT' : 'POST', body }), () => 'Vendedor guardado')) setForm(null);
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md"><Title order={3}>Vendedores</Title><Button size="xs" onClick={() => { op.setError(''); setForm({ nombre: '', tipo: 'EMPLEADO', porcentaje: '', empleadoId: null, proveedorId: null, activo: true }); }}>Nuevo vendedor</Button></Group>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Nombre</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Empleado o proveedor</Table.Th><Table.Th ta="right">Comisión</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {vendedores.map((v) => (
            <Table.Tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => { op.setError(''); setForm({ id: v.id, nombre: v.nombre, tipo: v.tipo ?? 'EMPLEADO', porcentaje: Number(v.porcentaje), empleadoId: v.empleadoId ?? null, proveedorId: v.proveedorId ?? null, activo: v.activo }); }}>
              <Table.Td>{v.nombre}</Table.Td><Table.Td>{TIPOS[v.tipo ?? '']}</Table.Td><Table.Td>{v.empleado ?? v.proveedor}</Table.Td>
              <Table.Td ta="right">{Number(v.porcentaje).toLocaleString('es-AR', { minimumFractionDigits: 2 })} %</Table.Td>
              <Table.Td>{v.activo ? <Badge color="green" variant="light">Activo</Badge> : <Badge color="gray" variant="light">Inactivo</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar vendedor' : 'Nuevo vendedor'}>
        {form && (
          <Stack>
            <TextInput label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.currentTarget.value })} />
            <Select label="Tipo" data={[{ value: 'EMPLEADO', label: 'Empleado (cobra en el recibo de sueldo)' }, { value: 'EXTERNO', label: 'Externo (factura su comisión)' }]} value={form.tipo} onChange={(v) => setForm({ ...form, tipo: (v ?? 'EMPLEADO') as 'EMPLEADO' | 'EXTERNO' })} allowDeselect={false} />
            {form.tipo === 'EMPLEADO'
              ? <Select label="Empleado" searchable data={empleados.map((e) => ({ value: e.id, label: `${e.apellido}, ${e.nombre}` }))} value={form.empleadoId} onChange={(v) => setForm({ ...form, empleadoId: v })} />
              : <Select label="Proveedor" searchable data={proveedores.map((p) => ({ value: p.id, label: p.razonSocial }))} value={form.proveedorId} onChange={(v) => setForm({ ...form, proveedorId: v })} />}
            <NumberInput label="Comisión (%)" min={0} max={100} decimalScale={2} decimalSeparator="," value={form.porcentaje} onChange={(v) => setForm({ ...form, porcentaje: v })} />
            <Checkbox label="Activo" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.currentTarget.checked })} />
            {op.error && <Alert color="red">{op.error}</Alert>}
            <Button onClick={() => void guardar()} loading={op.enviando} disabled={!form.nombre || form.porcentaje === ''}>Guardar</Button>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
