import { Alert, Badge, Button, Group, Loader, NumberInput, Paper, Select, Stack, Switch, Table, Tabs, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { FormAbm } from '../abm/FormAbm';
import { Maestro, estado } from '../abm/Maestro';

interface Regimen { id: string; codigo: string; descripcion: string; minimoNoSujeto: string; alicuotaInscripto: string; alicuotaNoInscripto: string; usaEscala: boolean; minimoRetencion: string; activo: boolean; verificar: boolean }
interface Tramo { desde: number; hasta: number | null; fijo: number; porcentaje: number }
interface Jurisdiccion { jurisdiccion: string; alicuotaDefecto: string; minimoRetencion: string; usaPadron: boolean; sinPadron: 'NO_RETENER' | 'ALICUOTA_DEFECTO' }

const NOMBRES: Record<string, string> = {
  '901': 'CABA', '902': 'Buenos Aires', '903': 'Catamarca', '904': 'Córdoba', '905': 'Corrientes', '906': 'Chaco', '907': 'Chubut', '908': 'Entre Ríos',
  '909': 'Formosa', '910': 'Jujuy', '911': 'La Pampa', '912': 'La Rioja', '913': 'Mendoza', '914': 'Misiones', '915': 'Neuquén', '916': 'Río Negro',
  '917': 'Salta', '918': 'San Juan', '919': 'San Luis', '920': 'Santa Cruz', '921': 'Santa Fe', '922': 'Santiago del Estero', '923': 'Tierra del Fuego', '924': 'Tucumán',
};
const pct = (s: string) => `${Number(s).toLocaleString('es-AR')} %`;
const pesos = (s: string) => `$ ${Number(s).toLocaleString('es-AR')}`;

function EditorEscala() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/pagos/config/escala'], queryFn: () => api<{ desde: string; hasta: string | null; fijo: string; porcentaje: string }[]>('/pagos/config/escala') });
  const [tramos, setTramos] = useState<Tramo[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.data) setTramos(q.data.map((t) => ({ desde: Number(t.desde), hasta: t.hasta === null ? null : Number(t.hasta), fijo: Number(t.fijo), porcentaje: Number(t.porcentaje) })));
  }, [q.data]);
  const cambiar = (i: number, c: Partial<Tramo>) => setTramos(tramos.map((t, j) => (j === i ? { ...t, ...c } : t)));
  async function guardar() {
    setError('');
    try {
      await api('/pagos/config/escala', { metodo: 'PUT', body: tramos });
      notifications.show({ color: 'green', message: 'Escala guardada' });
      void qc.invalidateQueries({ queryKey: ['/pagos/config/escala'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">Escala para honorarios (sobre el excedente del mínimo no sujeto)</Text>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Desde</Table.Th><Table.Th>Hasta</Table.Th><Table.Th>Fijo</Table.Th><Table.Th>% sobre excedente</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {tramos.map((t, i) => (
            <Table.Tr key={i}>
              <Table.Td><NumberInput size="xs" aria-label="Desde" value={t.desde} onChange={(v) => cambiar(i, { desde: Number(v) || 0 })} /></Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="Hasta" placeholder="Sin límite" value={t.hasta ?? ''} onChange={(v) => cambiar(i, { hasta: v === '' ? null : Number(v) })} /></Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="Fijo" value={t.fijo} onChange={(v) => cambiar(i, { fijo: Number(v) || 0 })} /></Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="Porcentaje" decimalSeparator="," value={t.porcentaje} onChange={(v) => cambiar(i, { porcentaje: Number(v) || 0 })} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="space-between">
        <Button variant="light" size="xs" onClick={() => setTramos([...tramos, { desde: tramos.at(-1)?.hasta ?? 0, hasta: null, fijo: 0, porcentaje: 0 }])}>Agregar tramo</Button>
        <Button size="xs" onClick={guardar}>Guardar escala</Button>
      </Group>
    </Stack>
  );
}

function Jurisdicciones() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/pagos/config/jurisdicciones'], queryFn: () => api<Jurisdiccion[]>('/pagos/config/jurisdicciones') });
  const [filas, setFilas] = useState<Jurisdiccion[]>([]);
  useEffect(() => {
    if (q.data) setFilas(q.data);
  }, [q.data]);
  const cambiar = (j: string, c: Partial<Jurisdiccion>) => setFilas(filas.map((f) => (f.jurisdiccion === j ? { ...f, ...c } : f)));
  async function guardar() {
    await api('/pagos/config/jurisdicciones', {
      metodo: 'PUT',
      body: filas.map((f) => ({ ...f, alicuotaDefecto: Number(f.alicuotaDefecto), minimoRetencion: Number(f.minimoRetencion) })),
    });
    notifications.show({ color: 'green', message: 'Jurisdicciones guardadas' });
    void qc.invalidateQueries({ queryKey: ['/pagos/config/jurisdicciones'] });
  }
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">Se retiene solo en las jurisdicciones marcadas como agente en Administración › Empresa.</Text>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Jurisdicción</Table.Th><Table.Th>Usa padrón</Table.Th><Table.Th>Si no figura en padrón ni en la ficha</Table.Th><Table.Th>Alícuota por defecto</Table.Th><Table.Th>Mínimo de retención</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {filas.map((f) => (
            <Table.Tr key={f.jurisdiccion}>
              <Table.Td>{f.jurisdiccion} {NOMBRES[f.jurisdiccion]}</Table.Td>
              <Table.Td><Switch aria-label="Usa padrón" checked={f.usaPadron} onChange={(e) => cambiar(f.jurisdiccion, { usaPadron: e.currentTarget.checked })} /></Table.Td>
              <Table.Td>
                <Select size="xs" aria-label="Sin padrón" allowDeselect={false} value={f.sinPadron} data={[{ value: 'NO_RETENER', label: 'No retener' }, { value: 'ALICUOTA_DEFECTO', label: 'Alícuota por defecto' }]}
                  onChange={(v) => cambiar(f.jurisdiccion, { sinPadron: (v ?? 'NO_RETENER') as Jurisdiccion['sinPadron'] })} />
              </Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="Alícuota por defecto" decimalSeparator="," value={Number(f.alicuotaDefecto)} onChange={(v) => cambiar(f.jurisdiccion, { alicuotaDefecto: String(v || 0) })} /></Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="Mínimo de retención" value={Number(f.minimoRetencion)} onChange={(v) => cambiar(f.jurisdiccion, { minimoRetencion: String(v || 0) })} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="flex-end"><Button size="xs" onClick={guardar}>Guardar jurisdicciones</Button></Group>
    </Stack>
  );
}

function General() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/pagos/config'], queryFn: () => api<{ montoAprobacionOp: string }>('/pagos/config') });
  if (!q.data) return <Loader size="sm" />;
  return (
    <FormAbm
      campos={[{ nombre: 'montoAprobacionOp', etiqueta: 'Monto límite de aprobación automática de OP (en pesos)', tipo: 'numero', ayuda: 'Con 0, todas las órdenes de pago requieren aprobación.' }]}
      valoresIniciales={{ montoAprobacionOp: Number(q.data.montoAprobacionOp) }}
      onEnviar={(v) => api('/pagos/config', { metodo: 'PATCH', body: { montoAprobacionOp: v.montoAprobacionOp ?? 0 } })}
      onExito={() => {
        notifications.show({ color: 'green', message: 'Guardado' });
        void qc.invalidateQueries({ queryKey: ['/pagos/config'] });
      }}
    />
  );
}

export function ConfigRetencionesPage() {
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Retenciones</Title>
      <Tabs defaultValue="ganancias" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="ganancias">Ganancias</Tabs.Tab>
          <Tabs.Tab value="iibb">Ingresos Brutos</Tabs.Tab>
          <Tabs.Tab value="general">General</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ganancias">
          <Stack>
            <Alert color="yellow">Los mínimos y alícuotas precargados son de referencia. El contador debe verificarlos contra la normativa vigente antes de operar.</Alert>
            <Maestro<Regimen> sinMarco config={{
              titulo: 'Régimen de Ganancias', ruta: '/pagos/config/regimenes', permisoEditar: 'retenciones.config', valoresNuevos: { activo: true, minimoRetencion: 240 },
              campos: [
                { nombre: 'codigo', etiqueta: 'Código', tipo: 'texto', requerido: true },
                { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', requerido: true },
                { nombre: 'minimoNoSujeto', etiqueta: 'Mínimo no sujeto', tipo: 'numero', requerido: true },
                { nombre: 'minimoRetencion', etiqueta: 'Mínimo de retención', tipo: 'numero', requerido: true },
                { nombre: 'alicuotaInscripto', etiqueta: 'Alícuota inscripto (%)', tipo: 'numero', requerido: true },
                { nombre: 'alicuotaNoInscripto', etiqueta: 'Alícuota no inscripto (%)', tipo: 'numero', requerido: true },
                { nombre: 'usaEscala', etiqueta: 'Usa escala (honorarios)', tipo: 'booleano' },
                { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
              ],
              columnas: [
                { campo: 'codigo', titulo: 'Código' },
                { campo: 'descripcion', titulo: 'Descripción', render: (r) => <>{r.descripcion} {r.verificar && <Badge size="xs" color="yellow" variant="light">Verificar valores vigentes</Badge>}</> },
                { campo: 'minimoNoSujeto', titulo: 'Mínimo no sujeto', render: (r) => pesos(r.minimoNoSujeto) },
                { campo: 'alicuotaInscripto', titulo: 'Inscripto', render: (r) => (r.usaEscala ? 'Escala' : pct(r.alicuotaInscripto)) },
                { campo: 'alicuotaNoInscripto', titulo: 'No inscripto', render: (r) => pct(r.alicuotaNoInscripto) },
                { campo: 'minimoRetencion', titulo: 'Mínimo retención', render: (r) => pesos(r.minimoRetencion) },
                { campo: 'activo', titulo: 'Estado', render: (r) => estado(r.activo) },
              ],
            }} />
            <EditorEscala />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="iibb"><Jurisdicciones /></Tabs.Panel>
        <Tabs.Panel value="general"><General /></Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
