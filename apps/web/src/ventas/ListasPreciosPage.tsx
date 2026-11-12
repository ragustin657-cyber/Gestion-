import { ActionIcon, Button, FileButton, Group, Modal, NumberInput, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { IconHistory, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, subirArchivo } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { REDONDEOS, vistaPreviaAumento, type Redondeo } from './precios';

interface Lista { id: string; nombre: string; monedaCodigo: string; activa: boolean; porDefecto: boolean }
interface Precio { articuloId: string; codigo: string; descripcion: string; precio: string; actualizadoEn: string }

function FilaPrecio({ p, moneda, editable, guardar, borrar, historial }: { p: Precio; moneda: string; editable: boolean; guardar: (v: number) => void; borrar: () => void; historial: () => void }) {
  const [valor, setValor] = useState<string | number>(p.precio);
  useEffect(() => setValor(p.precio), [p.precio]);
  return (
    <Table.Tr>
      <Table.Td>{p.codigo}</Table.Td>
      <Table.Td>{p.descripcion}</Table.Td>
      <Table.Td>{editable
        ? <NumberInput size="xs" w={150} decimalScale={4} decimalSeparator="," thousandSeparator="." aria-label={`Precio ${p.codigo}`} value={valor} onChange={setValor} onBlur={() => { if (Number(valor) > 0 && String(Number(valor)) !== String(Number(p.precio))) guardar(Number(valor)); }} />
        : formatoMoneda(p.precio, moneda)}</Table.Td>
      <Table.Td><Text size="xs" c="dimmed">{formatoFecha(p.actualizadoEn)}</Text></Table.Td>
      <Table.Td><Group gap={2} wrap="nowrap">
        <ActionIcon variant="subtle" aria-label={`Historial ${p.codigo}`} onClick={historial}><IconHistory size={14} /></ActionIcon>
        {editable && <ActionIcon variant="subtle" color="red" aria-label={`Quitar ${p.codigo}`} onClick={borrar}><IconTrash size={14} /></ActionIcon>}
      </Group></Table.Td>
    </Table.Tr>
  );
}

export function ListasPreciosPage() {
  const { puede } = useAuth();
  const editable = puede('precios.editar');
  const qc = useQueryClient();
  const op = useOperacion();
  const listas = useQuery({ queryKey: ['/ventas/listas'], queryFn: () => api<Lista[]>('/ventas/listas') });
  const [listaId, setListaId] = useState<string | null>(null);
  const lista = listas.data?.find((l) => l.id === listaId) ?? null;
  useEffect(() => { if (!listaId && listas.data?.length) setListaId((listas.data.find((l) => l.porDefecto) ?? listas.data[0]).id); }, [listas.data, listaId]);
  const [q, setQ] = useState('');
  const precios = useQuery({ queryKey: ['/ventas/listas/precios', listaId, q], queryFn: () => api<Precio[]>(`/ventas/listas/${listaId}/precios`, { query: { q } }), enabled: !!listaId });
  const articulos = useQuery({ queryKey: ['/articulos', 'precios'], queryFn: () => api<{ items: { id: string; codigo: string; descripcion: string }[] }>('/articulos', { query: { porPagina: 500 } }), enabled: editable }).data?.items ?? [];
  const [nueva, setNueva] = useState<{ nombre: string; monedaCodigo: string; porDefecto: boolean } | null>(null);
  const [agregar, setAgregar] = useState<{ articuloId: string | null; precio: string | number }>({ articuloId: null, precio: '' });
  const [aumento, setAumento] = useState<{ porcentaje: string | number; redondeo: Redondeo } | null>(null);
  const [historial, setHistorial] = useState<Precio | null>(null);
  const hist = useQuery({ queryKey: ['/ventas/listas/historial', listaId, historial?.articuloId], queryFn: () => api<{ id: string; motivo: string; precioAnterior: string | null; precioNuevo: string | null; fecha: string; usuario: string }[]>(`/ventas/listas/${listaId}/historial`, { query: { articuloId: historial!.articuloId } }), enabled: !!historial });
  const refrescar = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/ventas/listas') });
  const moneda = lista?.monedaCodigo ?? 'ARS';

  const guardarPrecio = async (articuloId: string, precio: number) => { if (await op.ejecutar(() => api(`/ventas/listas/${listaId}/precios/${articuloId}`, { metodo: 'PUT', body: { precio } }), () => 'Precio guardado')) refrescar(); };
  const borrarPrecio = async (articuloId: string) => { if (await op.ejecutar(() => api(`/ventas/listas/${listaId}/precios/${articuloId}`, { metodo: 'DELETE' }), () => 'Precio quitado')) refrescar(); };

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Listas de precios</Title>
        {editable && <Button variant="light" onClick={() => setNueva({ nombre: '', monedaCodigo: 'ARS', porDefecto: false })}>Nueva lista</Button>}
      </Group>
      {errorConsulta(listas.error)}
      <Group align="flex-end" mb="md">
        <Select label="Lista" w={260} data={(listas.data ?? []).map((l) => ({ value: l.id, label: `${l.nombre} (${l.monedaCodigo})${l.porDefecto ? ' · por defecto' : ''}${l.activa ? '' : ' · inactiva'}` }))} value={listaId} onChange={setListaId} />
        <TextInput label="Buscar" w={220} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        {editable && lista && <>
          <Button variant="default" onClick={() => setAumento({ porcentaje: '', redondeo: '1' })}>Aumentar precios</Button>
          <FileButton accept=".csv,.xlsx,text/csv" onChange={async (f) => { if (f && (await op.ejecutar(() => subirArchivo<{ creados: number; actualizados: number }>(`/ventas/listas/${listaId}/importar`, {}, f), (x) => `Creados: ${x.creados} · Actualizados: ${x.actualizados}`))) refrescar(); }}>
            {(props) => <Button variant="default" {...props}>Importar</Button>}
          </FileButton>
          {!lista.porDefecto && <Button variant="subtle" onClick={async () => { if (await op.ejecutar(() => api(`/ventas/listas/${lista.id}`, { metodo: 'PATCH', body: { porDefecto: true } }), () => 'Lista por defecto actualizada')) void qc.invalidateQueries({ queryKey: ['/ventas/listas'] }); }}>Usar por defecto</Button>}
        </>}
      </Group>
      {op.alerta}
      {editable && lista && (
        <Group align="flex-end" mb="sm">
          <Select label="Artículo" w={320} searchable data={articulos.map((a) => ({ value: a.id, label: `${a.codigo} ${a.descripcion}` }))} value={agregar.articuloId} onChange={(v) => setAgregar({ ...agregar, articuloId: v })} />
          <NumberInput label={`Precio (${moneda})`} w={160} decimalScale={4} decimalSeparator="," thousandSeparator="." value={agregar.precio} onChange={(v) => setAgregar({ ...agregar, precio: v })} />
          <Button variant="light" disabled={!agregar.articuloId || !(Number(agregar.precio) > 0)} onClick={async () => { await guardarPrecio(agregar.articuloId!, Number(agregar.precio)); setAgregar({ articuloId: null, precio: '' }); }}>Agregar</Button>
        </Group>
      )}
      {lista && (
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Código</Table.Th><Table.Th>Artículo</Table.Th><Table.Th>Precio ({moneda})</Table.Th><Table.Th>Actualizado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(precios.data ?? []).map((p) => <FilaPrecio key={p.articuloId} p={p} moneda={moneda} editable={editable} guardar={(v) => void guardarPrecio(p.articuloId, v)} borrar={() => void borrarPrecio(p.articuloId)} historial={() => setHistorial(p)} />)}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={!!nueva} onClose={() => setNueva(null)} title="Nueva lista de precios">
        {nueva && <Stack>
          <TextInput label="Nombre" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.currentTarget.value })} />
          <Select label="Moneda" data={['ARS', 'USD']} allowDeselect={false} value={nueva.monedaCodigo} onChange={(v) => setNueva({ ...nueva, monedaCodigo: v ?? 'ARS' })} />
          <Switch label="Lista por defecto" checked={nueva.porDefecto} onChange={(e) => setNueva({ ...nueva, porDefecto: e.currentTarget.checked })} />
          <Button disabled={!nueva.nombre.trim()} onClick={async () => { const r = await op.ejecutar(() => api<Lista>('/ventas/listas', { metodo: 'POST', body: nueva }), () => 'Lista creada'); if (r) { setNueva(null); setListaId(r.id); void qc.invalidateQueries({ queryKey: ['/ventas/listas'] }); } }}>Crear</Button>
        </Stack>}
      </Modal>
      <Modal opened={!!aumento} onClose={() => setAumento(null)} title={`Aumentar precios de ${lista?.nombre ?? ''}`}>
        {aumento && <Stack>
          <NumberInput label="Porcentaje" description="Negativo para bajar" decimalScale={2} decimalSeparator="," value={aumento.porcentaje} onChange={(v) => setAumento({ ...aumento, porcentaje: v })} />
          <Select label="Redondeo" data={REDONDEOS} allowDeselect={false} value={aumento.redondeo} onChange={(v) => setAumento({ ...aumento, redondeo: (v ?? '1') as Redondeo })} />
          {Number(aumento.porcentaje) !== 0 && (
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Antes</Table.Th><Table.Th>Después</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{vistaPreviaAumento(precios.data ?? [], Number(aumento.porcentaje), aumento.redondeo).map((x) => <Table.Tr key={x.codigo}><Table.Td>{x.codigo}</Table.Td><Table.Td>{formatoMoneda(x.antes, moneda)}</Table.Td><Table.Td>{formatoMoneda(x.despues, moneda)}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
          )}
          <Text size="xs" c="dimmed">Se aplica a todos los artículos de la lista ({precios.data?.length ?? 0}).</Text>
          <Button disabled={!Number(aumento.porcentaje)} onClick={async () => { if (await op.ejecutar(() => api<{ actualizados: number }>(`/ventas/listas/${listaId}/aumento`, { metodo: 'POST', body: { porcentaje: Number(aumento.porcentaje), redondeo: aumento.redondeo } }), (x) => `${x.actualizados} precios actualizados`)) { setAumento(null); refrescar(); } }}>Aplicar</Button>
        </Stack>}
      </Modal>
      <Modal opened={!!historial} onClose={() => setHistorial(null)} title={`Historial de ${historial?.codigo ?? ''}`}>
        <Table>
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Motivo</Table.Th><Table.Th>Antes</Table.Th><Table.Th>Después</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(hist.data ?? []).map((h) => <Table.Tr key={h.id}><Table.Td>{formatoFecha(h.fecha)}</Table.Td><Table.Td>{h.motivo}</Table.Td><Table.Td>{h.precioAnterior ? formatoMoneda(h.precioAnterior, moneda) : '—'}</Table.Td><Table.Td>{h.precioNuevo ? formatoMoneda(h.precioNuevo, moneda) : '—'}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Modal>
    </Paper>
  );
}
