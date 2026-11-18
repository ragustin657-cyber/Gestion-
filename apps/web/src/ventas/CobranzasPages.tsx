import { Alert, Badge, Button, Checkbox, Chip, Modal, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { useOperacionVentas } from './comun';

type Estado = 'CUMPLIDA' | 'INCUMPLIDA' | 'PENDIENTE';
export interface FilaAgenda {
  terceroId: string; cliente: string; vencido: string; porVencer: string; aFavor: string; dias: number;
  ultimaGestion: { fecha: string; medio: string; nota: string } | null; proximaAccion: string | null; accionAtrasada: boolean;
  promesa: { fecha: string; importe: string; estado: Estado } | null;
}
interface Gestion { id: string; fecha: string; medio: string; nota: string; proximaAccion: string | null; promesaFecha: string | null; promesaImporte: string | null; promesaEstado: Estado | null; creadoEn: string; eliminable: boolean; usuario: string }
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
export function TablaAgenda({ clientes, onElegir, seleccion, onSeleccion }: { clientes: FilaAgenda[]; onElegir: (terceroId: string) => void; seleccion?: string[]; onSeleccion?: (ids: string[]) => void }) {
  const conSeleccion = !!onSeleccion && !!seleccion;
  return (
    <Table withTableBorder striped highlightOnHover>
      <Table.Thead><Table.Tr>{conSeleccion && <Table.Th w={36} />}<Table.Th>Cliente</Table.Th><Table.Th ta="right">Vencido</Table.Th><Table.Th ta="right">Por vencer</Table.Th><Table.Th ta="right">Días</Table.Th><Table.Th>Última gestión</Table.Th><Table.Th>Próxima acción</Table.Th><Table.Th>Promesa</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {clientes.map((c) => (
          <Table.Tr key={c.terceroId} style={{ cursor: 'pointer' }} onClick={() => onElegir(c.terceroId)}>
            {conSeleccion && (
              <Table.Td onClick={(e) => e.stopPropagation()}>
                <Checkbox aria-label={`Seleccionar ${c.cliente}`} checked={seleccion!.includes(c.terceroId)} onChange={(e) => onSeleccion!(e.currentTarget.checked ? [...seleccion!, c.terceroId] : seleccion!.filter((x) => x !== c.terceroId))} />
              </Table.Td>
            )}
            <Table.Td>{c.cliente}{Number(c.aFavor) < 0 && <Text size="xs" c="dimmed">{`${formatoMoneda(-Number(c.aFavor))} a favor sin aplicar`}</Text>}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(c.vencido)}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(c.porVencer)}</Table.Td>
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

export interface ResultadoMasivo { enviados: { terceroId: string; cliente: string; destinatario: string }[]; omitidos: { terceroId: string; cliente: string; motivo: string }[] }

/** Resultado del envío masivo: cuántos salieron y por qué se omitieron los demás. */
export function ResultadoEnvio({ enviados, omitidos }: ResultadoMasivo) {
  return (
    <Alert color={omitidos.length ? 'yellow' : 'green'} title={`${enviados.length} ${enviados.length === 1 ? 'enviado' : 'enviados'}`}>
      {omitidos.length > 0 && <Text size="sm" fw={500}>{`${omitidos.length} sin enviar:`}</Text>}
      {omitidos.map((o) => <Text key={o.terceroId} size="sm">{`${o.cliente || o.terceroId}: ${o.motivo}`}</Text>)}
    </Alert>
  );
}

export function AgendaCobranzasPage() {
  const navegar = useNavigate();
  const { puede } = useAuth();
  const op = useOperacionVentas();
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ResultadoMasivo | null>(null);
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
      {puede('cobranzas.gestionar') && !!q.data?.clientes.length && (
        <Group mb="sm">
          <Button size="xs" variant="light" disabled={!seleccion.length || seleccion.length > 50} loading={op.enviando} onClick={async () => {
            const r = await op.ejecutar(() => api<ResultadoMasivo>('/ventas/cobranzas/mail', { metodo: 'POST', body: { terceroIds: seleccion } }), (x) => `${x.enviados.length} resumen(es) enviado(s)`);
            if (r) { setResultado(r); setSeleccion([]); }
          }}>{`Enviar resumen a los seleccionados${seleccion.length ? ` (${seleccion.length})` : ''}`}</Button>
          {seleccion.length > 50 && <Text size="sm" c="red">Se envían hasta 50 clientes por vez</Text>}
        </Group>
      )}
      {op.error && <Alert color="red" mb="sm">{op.error}</Alert>}
      {resultado && <ResultadoEnvio {...resultado} />}
      {!!q.data?.clientes.length && <TablaAgenda clientes={q.data.clientes} onElegir={(id) => navegar(`/ventas/cobranzas/${id}`)} {...(puede('cobranzas.gestionar') ? { seleccion, onSeleccion: setSeleccion } : {})} />}
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
  const [mail, setMail] = useState<{ destinatario: string; asunto: string; cuerpo: string } | null>(null);
  const abrirMail = async () => {
    op.setError('');
    try {
      const p = await api<{ destinatario: string | null; asunto: string; cuerpo: string }>(`/ventas/cobranzas/${terceroId}/mail/previsualizar`);
      setMail({ destinatario: p.destinatario ?? '', asunto: p.asunto, cuerpo: p.cuerpo });
    } catch (e) {
      op.setError(e instanceof Error ? e.message : 'No se pudo armar el mail');
    }
  };
  const f = q.data;
  // Cliente inexistente o sin permiso: se muestra el motivo en vez de una pantalla en blanco
  if (q.error) return <Alert color="red" title="No se pudo abrir la ficha">{q.error instanceof Error ? q.error.message : 'Error inesperado'}</Alert>;
  if (!f) return null;
  const gestionar = puede('cobranzas.gestionar');
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <div>
            <Title order={3}>{f.cliente.razonSocial}</Title>
            <Text size="sm" c="dimmed">{`CUIT ${f.cliente.cuit}${f.cliente.telefono ? ` · Tel. ${f.cliente.telefono}` : ''}${f.cliente.email ? ` · ${f.cliente.email}` : ''}`}</Text>
          </div>
          <Group>
            <Button variant="light" size="xs" onClick={() => void descargar(`/ventas/cobranzas/${terceroId}/resumen.pdf`, {}, 'resumen-de-cuenta.pdf')}>Descargar resumen</Button>
            {gestionar && <Button size="xs" onClick={() => void abrirMail()}>Enviar resumen por mail</Button>}
            <Button variant="subtle" onClick={() => navegar('/ventas/cobranzas')}>Volver a la agenda</Button>
          </Group>
        </Group>
        <Group mt="sm" gap="xl">
          <Text><b>Vencido</b> {formatoMoneda(f.vencido)} ({f.dias} días)</Text>
          <Text><b>Por vencer</b> {formatoMoneda(f.porVencer)}</Text>
          {Number(f.aFavor) < 0 && <Text c="orange"><b>A favor sin aplicar</b> {formatoMoneda(-Number(f.aFavor))}</Text>}
        </Group>
      </Paper>
      <Modal opened={!!mail} onClose={() => setMail(null)} size="lg" title="Enviar resumen por mail">
        {mail && (
          <Stack>
            <TextInput label="Para" value={mail.destinatario} onChange={(e) => setMail({ ...mail, destinatario: e.currentTarget.value })} />
            <TextInput label="Asunto" value={mail.asunto} onChange={(e) => setMail({ ...mail, asunto: e.currentTarget.value })} />
            <Textarea label="Texto" autosize minRows={6} value={mail.cuerpo} onChange={(e) => setMail({ ...mail, cuerpo: e.currentTarget.value })} />
            <Text size="xs" c="dimmed">Se adjunta el resumen de cuenta en PDF.</Text>
            {op.error && <Alert color="red">{op.error}</Alert>}
            <Group justify="flex-end">
              <Button loading={op.enviando} disabled={!mail.destinatario} onClick={async () => {
                if (await op.ejecutar(() => api(`/ventas/cobranzas/${terceroId}/mail`, { metodo: 'POST', body: mail }), () => 'Mail enviado')) setMail(null);
              }}>Enviar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
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
                  <Text size="sm" fw={500}>{`${formatoFecha(g.fecha)} · ${MEDIOS[g.medio]}${g.usuario ? ` · ${g.usuario}` : ''}`}</Text>
                  <Text size="sm">{g.nota}</Text>
                  <Group gap="md" mt={4}>
                    {g.proximaAccion && <Text size="xs" c="dimmed">{`Próxima acción: ${formatoFecha(g.proximaAccion)}`}</Text>}
                    {g.promesaFecha && g.promesaImporte && <Group gap={4}><Text size="xs">{`Promesa: ${formatoMoneda(g.promesaImporte)} el ${formatoFecha(g.promesaFecha)}`}</Text>{g.promesaEstado && <BadgePromesa estado={g.promesaEstado} />}</Group>}
                  </Group>
                </div>
                {gestionar && g.eliminable && (
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
