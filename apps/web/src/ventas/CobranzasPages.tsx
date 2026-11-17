import { Alert, Badge, Button, Chip, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { useOperacionVentas } from './comun';

type Estado = 'CUMPLIDA' | 'INCUMPLIDA' | 'PENDIENTE';
export interface FilaAgenda {
  terceroId: string; cliente: string; vencido: string; porVencer: string; aFavor: string; dias: number;
  ultimaGestion: { fecha: string; medio: string; nota: string } | null; proximaAccion: string | null; accionAtrasada: boolean;
  promesa: { fecha: string; importe: string; estado: Estado } | null;
}
interface Gestion { id: string; fecha: string; medio: string; nota: string; proximaAccion: string | null; promesaFecha: string | null; promesaImporte: string | null; promesaEstado: Estado | null; creadoEn: string }
interface Ficha {
  cliente: { id: string; razonSocial: string; cuit: string; telefono: string | null; email: string | null };
  vencido: string; porVencer: string; aFavor: string; dias: number;
  comprobantes: { movimientoId: string; descripcion: string; fecha: string; fechaVencimiento: string; dias: number; importe: string; saldo: string; vencido: boolean }[];
  gestiones: Gestion[];
}
export interface DatosGestionWeb { medio: string; fecha: string; nota: string; proximaAccion: string | null; promesaFecha: string | null; promesaImporte: number | null }

const MEDIOS: Record<string, string> = { LLAMADO: 'Llamado', MAIL: 'Mail', WHATSAPP: 'WhatsApp', VISITA: 'Visita', OTRO: 'Otro' };
const ESTADOS: Record<Estado, { texto: string; color: string }> = { CUMPLIDA: { texto: 'Cumplida', color: 'green' }, INCUMPLIDA: { texto: 'Incumplida', color: 'red' }, PENDIENTE: { texto: 'Pendiente', color: 'blue' } };
const corto = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function BadgePromesa({ estado }: { estado: Estado }) {
  return <Badge color={ESTADOS[estado].color} variant="light">{ESTADOS[estado].texto}</Badge>;
}

/** Agenda: clientes vencidos con su última gestión, próxima acción y promesa. */
export function TablaAgenda({ clientes, onElegir }: { clientes: FilaAgenda[]; onElegir: (terceroId: string) => void }) {
  return (
    <Table withTableBorder striped highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Cliente</Table.Th><Table.Th ta="right">Vencido</Table.Th><Table.Th ta="right">Días</Table.Th><Table.Th>Última gestión</Table.Th><Table.Th>Próxima acción</Table.Th><Table.Th>Promesa</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {clientes.map((c) => (
          <Table.Tr key={c.terceroId} style={{ cursor: 'pointer' }} onClick={() => onElegir(c.terceroId)}>
            <Table.Td>{c.cliente}{Number(c.aFavor) < 0 && <Text size="xs" c="dimmed">{`${formatoMoneda(-Number(c.aFavor))} a favor sin aplicar`}</Text>}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(c.vencido)}</Table.Td>
            <Table.Td ta="right">{c.dias}</Table.Td>
            <Table.Td>{c.ultimaGestion ? `${formatoFecha(c.ultimaGestion.fecha)} ${MEDIOS[c.ultimaGestion.medio]}: ${corto(c.ultimaGestion.nota)}` : '—'}</Table.Td>
            <Table.Td>{c.proximaAccion ? <Group gap={4}><Text size="sm" c={c.accionAtrasada ? 'red' : undefined}>{formatoFecha(c.proximaAccion)}</Text>{c.accionAtrasada && <Badge color="red" variant="light" size="xs">Atrasada</Badge>}</Group> : '—'}</Table.Td>
            <Table.Td>{c.promesa ? <Group gap={4}><Text size="sm">{`${formatoFecha(c.promesa.fecha)} ${formatoMoneda(c.promesa.importe)}`}</Text><BadgePromesa estado={c.promesa.estado} /></Group> : '—'}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Registrar una gestión: medio, fecha, nota, próxima acción y promesa opcional. */
export function FormGestion({ onGuardar, enviando }: { onGuardar: (d: DatosGestionWeb) => void; enviando?: boolean }) {
  const inicial = { medio: 'LLAMADO', fecha: hoy(), nota: '', proximaAccion: '', promesaFecha: '', promesaImporte: '' as number | string };
  const [v, setV] = useState(inicial);
  const conPromesa = !!v.promesaFecha || v.promesaImporte !== '';
  const promesaValida = !conPromesa || (!!v.promesaFecha && Number(v.promesaImporte) > 0);
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select label="Medio" data={Object.entries(MEDIOS).map(([value, label]) => ({ value, label }))} value={v.medio} onChange={(x) => setV({ ...v, medio: x ?? 'LLAMADO' })} allowDeselect={false} />
        <TextInput type="date" label="Fecha" value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.currentTarget.value })} />
        <TextInput type="date" label="Próxima acción" value={v.proximaAccion} onChange={(e) => setV({ ...v, proximaAccion: e.currentTarget.value })} />
      </SimpleGrid>
      <Textarea label="Nota" autosize minRows={2} value={v.nota} onChange={(e) => setV({ ...v, nota: e.currentTarget.value })} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput type="date" label="Fecha de la promesa" value={v.promesaFecha} onChange={(e) => setV({ ...v, promesaFecha: e.currentTarget.value })} />
        <NumberInput label="Importe prometido" min={0} decimalScale={2} decimalSeparator="," thousandSeparator="." value={v.promesaImporte} onChange={(x) => setV({ ...v, promesaImporte: x })} />
      </SimpleGrid>
      <Group justify="flex-end">
        <Button loading={enviando} disabled={!v.nota.trim() || !promesaValida} onClick={() => {
          onGuardar({ medio: v.medio, fecha: v.fecha, nota: v.nota.trim(), proximaAccion: v.proximaAccion || null, promesaFecha: conPromesa ? v.promesaFecha : null, promesaImporte: conPromesa ? Number(v.promesaImporte) : null });
        }}>Registrar gestión</Button>
      </Group>
    </Stack>
  );
}

export function AgendaCobranzasPage() {
  const navegar = useNavigate();
  const [filtros, setFiltros] = useState<string[]>([]);
  const [minDias, setMinDias] = useState<number | string>('');
  const [busqueda, setBusqueda] = useState('');
  const query = { soloHoy: filtros.includes('hoy') ? 'true' : undefined, incumplidas: filtros.includes('incumplidas') ? 'true' : undefined, minDias: minDias === '' ? undefined : minDias, q: busqueda || undefined };
  const q = useQuery({ queryKey: ['/ventas/cobranzas', query], queryFn: () => api<{ clientes: FilaAgenda[] }>('/ventas/cobranzas', { query }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Cobranzas</Title>
        <Group>
          <Chip.Group multiple value={filtros} onChange={setFiltros}>
            <Chip value="hoy">Acciones para hoy</Chip>
            <Chip value="incumplidas">Promesas incumplidas</Chip>
          </Chip.Group>
          <NumberInput aria-label="Mínimo de días de atraso" placeholder="Mín. días" w={110} min={0} value={minDias} onChange={setMinDias} />
          <TextInput aria-label="Buscar cliente" placeholder="Buscar cliente" value={busqueda} onChange={(e) => setBusqueda(e.currentTarget.value)} />
        </Group>
      </Group>
      {q.data && !q.data.clientes.length && <Text c="dimmed">No hay clientes con deuda vencida{filtros.length || minDias !== '' || busqueda ? ' con esos filtros' : ''}.</Text>}
      {!!q.data?.clientes.length && <TablaAgenda clientes={q.data.clientes} onElegir={(id) => navegar(`/ventas/cobranzas/${id}`)} />}
    </Paper>
  );
}

export function FichaCobranzaPage() {
  const { terceroId } = useParams();
  const { puede } = useAuth();
  const op = useOperacionVentas();
  const navegar = useNavigate();
  const q = useQuery({ queryKey: ['/ventas/cobranzas', terceroId], queryFn: () => api<Ficha>(`/ventas/cobranzas/${terceroId}`) });
  const [form, setForm] = useState(0);
  const f = q.data;
  if (!f) return null;
  const gestionar = puede('cobranzas.gestionar');
  const hoyIso = hoy();
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <div>
            <Title order={3}>{f.cliente.razonSocial}</Title>
            <Text size="sm" c="dimmed">{`CUIT ${f.cliente.cuit}${f.cliente.telefono ? ` · Tel. ${f.cliente.telefono}` : ''}${f.cliente.email ? ` · ${f.cliente.email}` : ''}`}</Text>
          </div>
          <Button variant="subtle" onClick={() => navegar('/ventas/cobranzas')}>Volver a la agenda</Button>
        </Group>
        <Group mt="sm" gap="xl">
          <Text><b>Vencido</b> {formatoMoneda(f.vencido)} ({f.dias} días)</Text>
          <Text><b>Por vencer</b> {formatoMoneda(f.porVencer)}</Text>
          {Number(f.aFavor) < 0 && <Text c="orange"><b>A favor sin aplicar</b> {formatoMoneda(-Number(f.aFavor))}</Text>}
        </Group>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Comprobantes pendientes</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Comprobante</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Vence</Table.Th><Table.Th ta="right">Días</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {f.comprobantes.map((c) => (
              <Table.Tr key={c.movimientoId} c={c.vencido ? 'red' : undefined}>
                <Table.Td>{c.descripcion}</Table.Td><Table.Td>{formatoFecha(c.fecha)}</Table.Td><Table.Td>{formatoFecha(c.fechaVencimiento)}</Table.Td>
                <Table.Td ta="right">{c.dias}</Table.Td><Table.Td ta="right">{formatoMoneda(c.importe)}</Table.Td><Table.Td ta="right">{formatoMoneda(c.saldo)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {gestionar && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="sm">Registrar gestión</Title>
          {op.error && <Alert color="red" mb="sm">{op.error}</Alert>}
          <FormGestion key={form} enviando={op.enviando} onGuardar={async (d) => {
            if (await op.ejecutar(() => api(`/ventas/cobranzas/${terceroId}/gestiones`, { metodo: 'POST', body: d }), () => 'Gestión registrada')) setForm((n) => n + 1);
          }} />
        </Paper>
      )}
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Gestiones</Title>
        {!f.gestiones.length && <Text c="dimmed">Sin gestiones registradas.</Text>}
        <Stack gap="xs">
          {f.gestiones.map((g) => (
            <Paper key={g.id} withBorder p="xs" radius="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="sm" fw={500}>{`${formatoFecha(g.fecha)} · ${MEDIOS[g.medio]}`}</Text>
                  <Text size="sm">{g.nota}</Text>
                  <Group gap="md" mt={4}>
                    {g.proximaAccion && <Text size="xs" c="dimmed">{`Próxima acción: ${formatoFecha(g.proximaAccion)}`}</Text>}
                    {g.promesaFecha && g.promesaImporte && <Group gap={4}><Text size="xs">{`Promesa: ${formatoMoneda(g.promesaImporte)} el ${formatoFecha(g.promesaFecha)}`}</Text>{g.promesaEstado && <BadgePromesa estado={g.promesaEstado} />}</Group>}
                  </Group>
                </div>
                {gestionar && g.creadoEn.slice(0, 10) === hoyIso && (
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => { if (window.confirm('¿Eliminar la gestión?')) void op.ejecutar(() => api(`/ventas/cobranzas/gestiones/${g.id}`, { metodo: 'DELETE' }), () => 'Gestión eliminada'); }}>Eliminar</Button>
                )}
              </Group>
            </Paper>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
