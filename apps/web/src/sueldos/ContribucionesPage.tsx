import { Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useCuentasImputables } from '../abm/opciones';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { Contribucion, DESTINOS_CONTRIBUCION, DestinoContribucion, mesTexto, pct } from './comun';

/** Contribuciones con su vigencia (una fila por vigencia). */
export function TablaContribuciones({ filas, onElegir }: { filas: Contribucion[]; onElegir?: (c: Contribucion) => void }) {
  return (
    <Table withTableBorder striped highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Código</Table.Th><Table.Th>Nombre</Table.Th><Table.Th>Destino</Table.Th><Table.Th ta="right">Alícuota</Table.Th><Table.Th ta="right">Fijo por empleado</Table.Th><Table.Th>Detracción</Table.Th><Table.Th>Desde</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((c) => (
          <Table.Tr key={c.id} style={{ cursor: onElegir ? 'pointer' : undefined }} onClick={() => onElegir?.(c)}>
            <Table.Td>{c.codigo}</Table.Td><Table.Td>{c.nombre}</Table.Td><Table.Td>{DESTINOS_CONTRIBUCION[c.destino]}</Table.Td>
            <Table.Td ta="right">{pct(c.alicuota)}</Table.Td><Table.Td ta="right">{Number(c.importeFijo) ? formatoMoneda(c.importeFijo) : ''}</Table.Td>
            <Table.Td>{c.aplicaDetraccion ? 'Sí' : 'No'}</Table.Td><Table.Td>{mesTexto(c.desdeAnio, c.desdeMes)}</Table.Td>
            <Table.Td>{c.activa ? <Badge color="green" variant="light">Activa</Badge> : <Badge color="gray" variant="light">Inactiva</Badge>}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

type Form = Omit<Contribucion, 'id' | 'alicuota' | 'importeFijo'> & { id?: string; alicuota: number; importeFijo: number };
const CUENTAS_CONFIG: [string, string][] = [['cuentaSueldosId', 'Sueldos y jornales'], ['cuentaContribucionesId', 'Contribuciones patronales'], ['cuentaSueldosAPagarId', 'Sueldos a pagar'], ['cuentaCargasSocialesId', 'Cargas sociales a pagar'], ['cuentaRetencionesSindicalesId', 'Retenciones sindicales a pagar']];

export function ContribucionesPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const editable = puede('sueldos.liquidar');
  const cuentas = useCuentasImputables();
  const contribuciones = useQuery({ queryKey: ['/sueldos/contribuciones'], queryFn: () => api<Contribucion[]>('/sueldos/contribuciones') });
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [anio, nmes] = mes.split('-').map(Number);
  const parametros = useQuery({ queryKey: ['/sueldos/parametros', mes], enabled: !!anio && !!nmes, queryFn: () => api<{ anio: number; mes: number; baseMaximaAportes: string | null; detraccion: string; aviso?: string }>('/sueldos/parametros', { query: { anio, mes: nmes } }) });
  const config = useQuery({ queryKey: ['/sueldos/configuracion'], queryFn: () => api<Record<string, string | null>>('/sueldos/configuracion') });
  const [form, setForm] = useState<Form | null>(null);
  const [param, setParam] = useState<{ base: number | ''; detraccion: number | '' }>({ base: '', detraccion: '' });
  const [cfg, setCfg] = useState<Record<string, string | null>>({});
  useEffect(() => { if (parametros.data) setParam({ base: parametros.data.baseMaximaAportes ? Number(parametros.data.baseMaximaAportes) : '', detraccion: Number(parametros.data.detraccion) }); }, [parametros.data]);
  useEffect(() => { if (config.data) setCfg(config.data); }, [config.data]);
  const refrescar = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/sueldos') });
  const guardar = async () => {
    if (!form) return;
    const { id, ...d } = form;
    if (await op.ejecutar(() => api(id ? `/sueldos/contribuciones/${id}` : '/sueldos/contribuciones', { metodo: id ? 'PUT' : 'POST', body: d }), () => 'Contribución guardada')) { setForm(null); refrescar(); }
  };
  const nuevaVigencia = (c: Contribucion) => setForm({ ...c, id: undefined, alicuota: Number(c.alicuota), importeFijo: Number(c.importeFijo), desdeAnio: anio, desdeMes: nmes });
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Title order={3}>Contribuciones patronales</Title>
          {editable && <Button size="xs" onClick={() => setForm({ codigo: '', nombre: '', destino: 'SEGURIDAD_SOCIAL', alicuota: 0, importeFijo: 0, aplicaDetraccion: false, cuentaContableId: cfg.cuentaCargasSocialesId ?? '', desdeAnio: anio, desdeMes: nmes, activa: true })}>Nueva contribución</Button>}
        </Group>
        <Alert color="yellow" mb="sm">Ajuste ART y seguro de vida a su contrato.</Alert>
        {errorConsulta(contribuciones.error)}
        <TablaContribuciones filas={contribuciones.data ?? []} onElegir={editable ? (c) => setForm({ ...c, alicuota: Number(c.alicuota), importeFijo: Number(c.importeFijo) }) : undefined} />
        <Text size="xs" c="dimmed" mt="xs">Para cambiar una alícuota desde un mes, abra la contribución y use "Nueva vigencia": las liquidaciones anteriores conservan la anterior.</Text>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Parámetros previsionales</Title>
          <TextInput type="month" aria-label="Mes de los parámetros" value={mes} onChange={(e) => setMes(e.currentTarget.value)} />
        </Group>
        {parametros.data && <Text size="sm" c="dimmed" mb="xs">{parametros.data.aviso ?? `Vigentes desde ${mesTexto(parametros.data.anio, parametros.data.mes)}`}</Text>}
        <Group align="flex-end">
          <NumberInput label="Base máxima de aportes" value={param.base} onChange={(v) => setParam({ ...param, base: v === '' ? '' : Number(v) })} decimalSeparator="," thousandSeparator="." decimalScale={2} disabled={!editable} w={220} />
          <NumberInput label="Detracción" value={param.detraccion} onChange={(v) => setParam({ ...param, detraccion: v === '' ? '' : Number(v) })} decimalSeparator="," thousandSeparator="." decimalScale={2} disabled={!editable} w={180} />
          {editable && <Button variant="light" onClick={async () => { if (await op.ejecutar(() => api('/sueldos/parametros', { metodo: 'PUT', body: { anio, mes: nmes, baseMaximaAportes: param.base === '' ? null : param.base, detraccion: param.detraccion || 0 } }), () => 'Parámetros guardados')) refrescar(); }}>Guardar para {mesTexto(anio, nmes)}</Button>}
        </Group>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Cuentas de sueldos</Title>
        <SimpleGrid cols={2}>
          {CUENTAS_CONFIG.map(([k, etiqueta]) => <Select key={k} label={etiqueta} data={cuentas} searchable value={cfg[k] ?? null} onChange={(v) => setCfg({ ...cfg, [k]: v })} disabled={!editable} />)}
        </SimpleGrid>
        {editable && <Group justify="flex-end" mt="sm"><Button variant="light" onClick={async () => { if (await op.ejecutar(() => api('/sueldos/configuracion', { metodo: 'PUT', body: Object.fromEntries(CUENTAS_CONFIG.map(([k]) => [k, cfg[k]])) }), () => 'Cuentas guardadas')) refrescar(); }}>Guardar cuentas</Button></Group>}
      </Paper>
      {op.alerta}
      <Modal opened={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? 'Editar contribución' : 'Nueva contribución'}>
        {form && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.currentTarget.value })} disabled={!!form.id} />
              <TextInput label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.currentTarget.value })} />
              <Select label="Destino" data={Object.entries(DESTINOS_CONTRIBUCION).map(([value, label]) => ({ value, label }))} value={form.destino} onChange={(v) => setForm({ ...form, destino: (v ?? 'SEGURIDAD_SOCIAL') as DestinoContribucion })} />
              <Select label="Cuenta de deuda" data={cuentas} searchable value={form.cuentaContableId || null} onChange={(v) => setForm({ ...form, cuentaContableId: v ?? '' })} />
              <NumberInput label="Alícuota %" value={form.alicuota} onChange={(v) => setForm({ ...form, alicuota: Number(v) || 0 })} decimalSeparator="," decimalScale={4} />
              <NumberInput label="Importe fijo por empleado" value={form.importeFijo} onChange={(v) => setForm({ ...form, importeFijo: Number(v) || 0 })} decimalSeparator="," thousandSeparator="." decimalScale={2} />
              <NumberInput label="Desde año" value={form.desdeAnio} onChange={(v) => setForm({ ...form, desdeAnio: Number(v) || anio })} disabled={!!form.id} />
              <NumberInput label="Desde mes" min={1} max={12} value={form.desdeMes} onChange={(v) => setForm({ ...form, desdeMes: Number(v) || 1 })} disabled={!!form.id} />
            </SimpleGrid>
            <Checkbox label="Aplica la detracción" checked={form.aplicaDetraccion} onChange={(e) => setForm({ ...form, aplicaDetraccion: e.currentTarget.checked })} />
            <Checkbox label="Activa" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.currentTarget.checked })} />
            {op.alerta}
            <Group justify="space-between">
              {form.id ? <Button variant="subtle" onClick={() => nuevaVigencia({ ...form, id: form.id!, alicuota: String(form.alicuota), importeFijo: String(form.importeFijo) })}>Nueva vigencia desde {mesTexto(anio, nmes)}</Button> : <span />}
              <Button onClick={guardar} loading={op.enviando}>Guardar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
