import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';

type TipoPartida = 'ACTIVO_INICIO' | 'PASIVO_INICIO' | 'DINAMICO';
interface Movimiento { fecha: string; asientoNumero: number | null; descripcion: string; tipo: string; importe: string; coeficiente: string; ajuste: string }
interface Partida { id: string; concepto: string; tipo: TipoPartida; fecha: string | null; importe: string }
export interface AjusteImpositivo {
  ejercicio: { numero: number; desde: string; hasta: string };
  estatico: { cuentas: { codigo: string; nombre: string; tipo: string; saldo: string }[]; activo: string; pasivo: string; manualActivo: string; manualPasivo: string; base: string; coeficiente: string; ajuste: string };
  dinamico: { movimientos: Movimiento[]; total: string };
  partidas: Partida[]; avisoApertura?: string | null; variacion36: string; corresponde: boolean; total: string; totalDj: string; aviso: string | null;
}
const NOMBRE_TIPO: Record<string, string> = { APORTE: 'Aporte', RETIRO: 'Retiro', COMPRA_EXCLUIDO: 'Compra de bien excluido', VENTA_EXCLUIDO: 'Venta de bien excluido', MANUAL: 'Partida manual' };
const TIPOS_PARTIDA = [{ value: 'ACTIVO_INICIO', label: 'Activo al inicio' }, { value: 'PASIVO_INICIO', label: 'Pasivo al inicio' }, { value: 'DINAMICO', label: 'Movimiento del ejercicio' }];
const coef = (s: string) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 6 });

/** Resumen del ajuste (E45): estático, dinámico, total y lo que va a la DJ; aviso si no corresponde. */
export function ResumenAjuste({ datos }: { datos: AjusteImpositivo }) {
  const dato = (t: string, v: string) => <Paper withBorder p="xs"><Text size="xs" c="dimmed">{t}</Text><Text fw={600}>{formatoMoneda(v)}</Text></Paper>;
  return (
    <Stack gap="xs">
      {datos.avisoApertura && <Alert color="yellow">{datos.avisoApertura}</Alert>}
      {datos.aviso && <Alert color="orange">{datos.aviso}</Alert>}
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {dato('Ajuste estático', datos.estatico.ajuste)}{dato('Ajuste dinámico', datos.dinamico.total)}{dato('Total del ajuste', datos.total)}{dato('Para la DJ', datos.totalDj)}
      </SimpleGrid>
      <Text size="xs" c="dimmed">{`Variación del IPC de los últimos 36 meses: ${Number(datos.variacion36).toLocaleString('es-AR', { minimumFractionDigits: 2 })} % ${datos.corresponde ? '(corresponde aplicar el ajuste)' : ''} · positivo = ganancia, negativo = pérdida`}</Text>
    </Stack>
  );
}

function TablaEstatico({ datos }: { datos: AjusteImpositivo }) {
  const e = datos.estatico;
  const fila = (t: string, v: string) => <Table.Tr><Table.Th>{t}</Table.Th><Table.Th ta="right">{formatoMoneda(v)}</Table.Th></Table.Tr>;
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Cuenta computable al inicio</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {e.cuentas.map((c) => <Table.Tr key={c.codigo}><Table.Td>{`${c.codigo} ${c.nombre}`} <Badge size="xs" variant="light">{c.tipo === 'ACTIVO' ? 'Activo' : 'Pasivo'}</Badge></Table.Td><Table.Td ta="right">{formatoMoneda(c.saldo)}</Table.Td></Table.Tr>)}
        {fila('Activo computable', e.activo)}{fila('Pasivo computable', e.pasivo)}{fila('Partidas manuales de activo', e.manualActivo)}{fila('Partidas manuales de pasivo', e.manualPasivo)}
        {fila('Base (activo − pasivo)', e.base)}
        <Table.Tr><Table.Th>{`Coeficiente ${coef(e.coeficiente)} · ajuste estático`}</Table.Th><Table.Th ta="right">{formatoMoneda(e.ajuste)}</Table.Th></Table.Tr>
      </Table.Tbody>
    </Table>
  );
}

export function TablaDinamico({ datos }: { datos: AjusteImpositivo }) {
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Asiento</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Coeficiente</Table.Th><Table.Th ta="right">Ajuste</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {datos.dinamico.movimientos.map((m, i) => (
          <Table.Tr key={i}>
            <Table.Td>{formatoFecha(m.fecha)}</Table.Td><Table.Td>{NOMBRE_TIPO[m.tipo] ?? m.tipo}</Table.Td><Table.Td>{m.asientoNumero ?? ''}</Table.Td><Table.Td>{m.descripcion}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(m.importe)}</Table.Td><Table.Td ta="right">{coef(m.coeficiente)}</Table.Td><Table.Td ta="right">{formatoMoneda(m.ajuste)}</Table.Td>
          </Table.Tr>
        ))}
        {!datos.dinamico.movimientos.length && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed" ta="center">Sin movimientos en el ejercicio</Text></Table.Td></Table.Tr>}
      </Table.Tbody>
      <Table.Tfoot><Table.Tr><Table.Th colSpan={6}>Ajuste dinámico</Table.Th><Table.Th ta="right">{formatoMoneda(datos.dinamico.total)}</Table.Th></Table.Tr></Table.Tfoot>
    </Table>
  );
}

type FormValores = { concepto: string; tipo: TipoPartida; fecha: string; importe: number | string };
/** Partida manual: la fecha solo para los movimientos del ejercicio (dinámicas). */
export function FormPartida({ inicial, onGuardar }: { inicial: FormValores; onGuardar: (v: FormValores) => Promise<boolean> }) {
  const [v, setV] = useState(inicial);
  return (
    <Stack>
      <TextInput label="Concepto" value={v.concepto} onChange={(e) => setV({ ...v, concepto: e.currentTarget.value })} />
      <Select label="Tipo de partida" allowDeselect={false} data={TIPOS_PARTIDA} value={v.tipo} onChange={(t) => setV({ ...v, tipo: (t ?? 'ACTIVO_INICIO') as TipoPartida })} />
      {v.tipo === 'DINAMICO' && <TextInput label="Fecha" type="date" value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.currentTarget.value })} />}
      <NumberInput label="Importe" description={v.tipo === 'DINAMICO' ? 'Positivo: retiro o compra de bien excluido (ajuste positivo). Negativo: aporte o venta.' : 'Con signo: suma o resta al saldo al inicio.'}
        decimalScale={2} thousandSeparator="." decimalSeparator="," value={v.importe} onChange={(x) => setV({ ...v, importe: x })} />
      <Group><Button onClick={() => void onGuardar(v)}>Guardar partida</Button></Group>
    </Stack>
  );
}

export function AjusteImpositivoPage() {
  const qc = useQueryClient();
  const { puede } = useAuth();
  const op = useOperacion();
  const ejercicios = useQuery({ queryKey: ['/contabilidad/ejercicios'], queryFn: () => api<{ id: string; numero: number; hasta: string; estado: string }[]>('/contabilidad/ejercicios') });
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<{ id: string | null; valores: FormValores } | null>(null);
  useEffect(() => {
    if (!ejercicioId && ejercicios.data?.length) setEjercicioId((ejercicios.data.find((x) => x.estado === 'ABIERTO') ?? ejercicios.data[0]).id);
  }, [ejercicios.data, ejercicioId]);
  const q = useQuery({ queryKey: ['/impuestos/ajuste-inflacion', ejercicioId], queryFn: () => api<AjusteImpositivo>('/impuestos/ajuste-inflacion', { query: { ejercicioId: ejercicioId ?? '' } }), enabled: !!ejercicioId });
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['/impuestos/ajuste-inflacion'] });
  const guardar = async (v: FormValores) => {
    if (!edicion) return false;
    const body = { ejercicioId, concepto: v.concepto, tipo: v.tipo, fecha: v.tipo === 'DINAMICO' ? v.fecha || null : null, importe: Number(v.importe) };
    const ok = await op.ejecutar(() => api(edicion.id ? `/impuestos/ajuste-inflacion/partidas/${edicion.id}` : '/impuestos/ajuste-inflacion/partidas', { metodo: edicion.id ? 'PUT' : 'POST', body }), () => 'Partida guardada');
    if (ok) { setEdicion(null); refrescar(); }
    return !!ok;
  };
  const eliminar = async (id: string) => {
    if (await op.ejecutar(() => api(`/impuestos/ajuste-inflacion/partidas/${id}`, { metodo: 'DELETE' }), () => 'Partida eliminada')) refrescar();
  };
  const editable = puede('impuestos.presentar');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Ajuste por inflación impositivo</Title>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} disabled={!ejercicioId}
          onClick={() => void descargar('/impuestos/ajuste-inflacion', { ejercicioId: ejercicioId ?? '', formato: 'xlsx' }, `ajuste-impositivo-${q.data?.ejercicio.hasta ?? ''}.xlsx`)}>Excel</Button>
      </Group>
      <Select label="Ejercicio" w={220} mb="md" allowDeselect={false} value={ejercicioId} onChange={setEjercicioId}
        data={(ejercicios.data ?? []).map((e) => ({ value: e.id, label: `Ejercicio ${e.numero} (${e.hasta.slice(0, 4)})` }))} />
      {errorConsulta(q.error)}
      {!edicion && op.alerta}
      {q.data && <Stack>
        <ResumenAjuste datos={q.data} />
        <Title order={5}>Estático</Title>
        <TablaEstatico datos={q.data} />
        <Title order={5}>Dinámico</Title>
        <TablaDinamico datos={q.data} />
        <Group justify="space-between"><Title order={5}>Partidas manuales</Title>
          {editable && <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEdicion({ id: null, valores: { concepto: '', tipo: 'ACTIVO_INICIO', fecha: '', importe: '' } })}>Nueva partida</Button>}</Group>
        <Table withTableBorder>
          <Table.Tbody>
            {q.data.partidas.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.concepto}</Table.Td><Table.Td>{TIPOS_PARTIDA.find((t) => t.value === p.tipo)?.label}</Table.Td><Table.Td>{p.fecha ? formatoFecha(p.fecha) : ''}</Table.Td><Table.Td ta="right">{formatoMoneda(p.importe)}</Table.Td>
                <Table.Td>{editable && <Group gap={4}>
                  <Button size="compact-xs" variant="subtle" onClick={() => setEdicion({ id: p.id, valores: { concepto: p.concepto, tipo: p.tipo, fecha: p.fecha ?? '', importe: Number(p.importe) } })}>Editar</Button>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => void eliminar(p.id)}>Eliminar</Button>
                </Group>}</Table.Td>
              </Table.Tr>
            ))}
            {!q.data.partidas.length && <Table.Tr><Table.Td><Text size="sm" c="dimmed">Sin partidas manuales. Úselas para las diferencias de valuación impositiva y los movimientos que no surgen del Mayor.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Stack>}
      <Modal opened={!!edicion} onClose={() => setEdicion(null)} title={edicion?.id ? 'Modificar partida' : 'Nueva partida'}>
        {edicion && <FormPartida inicial={edicion.valores} onGuardar={guardar} />}
        {edicion && op.alerta}
      </Modal>
    </Paper>
  );
}
