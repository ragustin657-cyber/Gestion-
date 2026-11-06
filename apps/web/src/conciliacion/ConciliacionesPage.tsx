import { Alert, Badge, Button, FileInput, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, descargar, subirArchivo } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, numero, opcionesCuentas, useCuentasBancarias, useOperacion } from '../tesoreria/comun';
import { Conciliacion } from './tipos';

interface Previa { lineas: { fila: number; fecha: string; concepto: string; referencia: string | null; importe: string }[]; total: number; duplicadas: number; errores: { fila: number; mensaje: string }[]; advertencias: string[] }
interface Importacion { id: string; archivo: string; fecha: string; lineas: number; duplicadas: number; estado: string }

function ImportarExtractoModal({ cuentaId, abierto, onCerrar, onListo }: { cuentaId: string; abierto: boolean; onCerrar: () => void; onListo: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const op = useOperacion();
  const cerrar = () => {
    setArchivo(null);
    setPrevia(null);
    onCerrar();
  };
  return (
    <Modal opened={abierto} onClose={cerrar} title="Importar extracto bancario" size="xl">
      <Stack>
        <FileInput label="Archivo del extracto (CSV o Excel)" accept=".csv,.txt,.xlsx" value={archivo} onChange={(f) => { setArchivo(f); setPrevia(null); }} />
        <Group>
          <Button variant="light" disabled={!archivo} loading={op.enviando}
            onClick={async () => { const r = await op.ejecutar(() => subirArchivo<Previa>('/conciliacion/importaciones/previsualizar', { cuentaBancariaId: cuentaId }, archivo!), () => 'Vista previa lista'); if (r) setPrevia(r); }}>Vista previa</Button>
        </Group>
        {previa && (
          <>
            {!!previa.errores.length && <Alert color="red">{previa.errores.slice(0, 10).map((e) => `Fila ${e.fila}: ${e.mensaje}`).join(' · ')}</Alert>}
            {previa.advertencias.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
            <Text size="sm">{previa.total} líneas nuevas{previa.duplicadas ? ` · ${previa.duplicadas} ya importadas` : ''}</Text>
            <ScrollArea h={240}>
              <Table withTableBorder striped>
                <Table.Thead><Table.Tr><Table.Th>Fila</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Concepto</Table.Th><Table.Th>Referencia</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{previa.lineas.map((l) => <Table.Tr key={l.fila}><Table.Td>{l.fila}</Table.Td><Table.Td>{formatoFecha(l.fecha)}</Table.Td><Table.Td>{l.concepto}</Table.Td><Table.Td>{l.referencia ?? ''}</Table.Td><Table.Td ta="right">{formatoMoneda(l.importe)}</Table.Td></Table.Tr>)}</Table.Tbody>
              </Table>
            </ScrollArea>
            <Group justify="flex-end">
              <Button disabled={!!previa.errores.length || !previa.total} loading={op.enviando} onClick={async () => {
                const r = await op.ejecutar(() => subirArchivo<{ lineas: number }>('/conciliacion/importaciones', { cuentaBancariaId: cuentaId }, archivo!), (x) => `${x.lineas} líneas importadas`);
                if (r) { onListo(); cerrar(); }
              }}>Importar</Button>
            </Group>
          </>
        )}
        {op.alerta}
      </Stack>
    </Modal>
  );
}

export function ConciliacionesPage() {
  const { puede } = useAuth();
  const navegar = useNavigate();
  const cuentas = useCuentasBancarias();
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const cuenta = cuentaId ?? cuentas[0]?.id ?? null;
  const lista = useQuery({ queryKey: ['/conciliacion/conciliaciones', 'lista', cuenta], queryFn: () => api<Conciliacion[]>('/conciliacion/conciliaciones', { query: { cuentaBancariaId: cuenta } }), enabled: !!cuenta });
  const imps = useQuery({ queryKey: ['/conciliacion/importaciones', cuenta], queryFn: () => api<Importacion[]>('/conciliacion/importaciones', { query: { cuentaBancariaId: cuenta } }), enabled: !!cuenta });
  const [importando, setImportando] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [saldoInicial, setSaldoInicial] = useState('');
  const [saldoFinal, setSaldoFinal] = useState('');
  const [reabriendo, setReabriendo] = useState<Conciliacion | null>(null);
  const [motivo, setMotivo] = useState('');
  const op = useOperacion();
  const refrescar = () => { void lista.refetch(); void imps.refetch(); };
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Conciliación bancaria</Title>
        <Group align="flex-end">
          <Select label="Cuenta bancaria" w={340} data={opcionesCuentas(cuentas)} value={cuenta} onChange={setCuentaId} allowDeselect={false} />
          <Button variant="light" disabled={!cuenta} onClick={() => setImportando(true)}>Importar extracto</Button>
          <Button disabled={!cuenta} onClick={() => setNueva(true)}>Nueva conciliación</Button>
        </Group>
        {op.alerta}
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Conciliaciones</Title>
        {errorConsulta(lista.error)}
        <Table withTableBorder striped highlightOnHover>
          <Table.Thead><Table.Tr><Table.Th>Período</Table.Th><Table.Th ta="right">Saldo inicial</Table.Th><Table.Th ta="right">Saldo final</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(lista.data ?? []).map((c) => (
              <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navegar(`/conciliacion/${c.id}`)}>
                <Table.Td>{formatoFecha(c.desde)} al {formatoFecha(c.hasta)}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(c.saldoInicial)}</Table.Td><Table.Td ta="right">{formatoMoneda(c.saldoFinal)}</Table.Td>
                <Table.Td><Badge variant="light" color={c.estado === 'ABIERTA' ? 'blue' : 'green'}>{c.estado === 'ABIERTA' ? 'Abierta' : 'Cerrada'}</Badge></Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="subtle" onClick={() => void descargar(`/conciliacion/conciliaciones/${c.id}/reporte`, { formato: 'pdf' }, `conciliacion-${c.desde.slice(0, 10)}.pdf`)}>PDF</Button>
                    {c.estado === 'CERRADA' && puede('tesoreria.anular') && <Button size="compact-xs" variant="subtle" color="orange" onClick={() => { setReabriendo(c); setMotivo(''); }}>Reabrir</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {!lista.data?.length && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" size="sm" ta="center">Sin conciliaciones</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Extractos importados</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Archivo</Table.Th><Table.Th ta="right">Líneas</Table.Th><Table.Th ta="right">Duplicadas</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(imps.data ?? []).map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>{formatoFecha(i.fecha)}</Table.Td><Table.Td>{i.archivo}</Table.Td><Table.Td ta="right">{i.lineas}</Table.Td><Table.Td ta="right">{i.duplicadas}</Table.Td>
                <Table.Td>{i.estado === 'ACTIVA' ? 'Activa' : 'Deshecha'}</Table.Td>
                <Table.Td>{i.estado === 'ACTIVA' && <Button size="compact-xs" variant="subtle" color="red" onClick={async () => { if (await op.ejecutar(() => api(`/conciliacion/importaciones/${i.id}/deshacer`, { metodo: 'POST' }), () => 'Importación deshecha')) refrescar(); }}>Deshacer</Button>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {cuenta && <ImportarExtractoModal cuentaId={cuenta} abierto={importando} onCerrar={() => setImportando(false)} onListo={refrescar} />}
      <Modal opened={nueva} onClose={() => setNueva(false)} title="Nueva conciliación">
        <Stack>
          <Group grow><TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} /><TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} /></Group>
          <TextInput label="Saldo inicial según extracto" description="Vacío: el saldo final de la conciliación anterior" inputMode="decimal" value={saldoInicial} onChange={(e) => setSaldoInicial(e.currentTarget.value)} />
          <TextInput label="Saldo final según extracto" inputMode="decimal" value={saldoFinal} onChange={(e) => setSaldoFinal(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button disabled={!desde || !hasta || !saldoFinal} loading={op.enviando} onClick={async () => {
              const r = await op.ejecutar(() => api<Conciliacion>('/conciliacion/conciliaciones', {
                metodo: 'POST', body: { cuentaBancariaId: cuenta, desde, hasta, saldoInicial: saldoInicial ? numero(saldoInicial) : null, saldoFinal: numero(saldoFinal) },
              }), () => 'Conciliación creada');
              if (r) navegar(`/conciliacion/${r.id}`);
            }}>Crear</Button>
          </Group>
          {op.alerta}
        </Stack>
      </Modal>
      <Modal opened={!!reabriendo} onClose={() => setReabriendo(null)} title="Reabrir conciliación">
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end" mt="md">
          <Button color="orange" disabled={!motivo.trim()} onClick={async () => {
            if (await op.ejecutar(() => api(`/conciliacion/conciliaciones/${reabriendo!.id}/reabrir`, { metodo: 'POST', body: { motivo } }), () => 'Conciliación reabierta')) { setReabriendo(null); refrescar(); }
          }}>Reabrir</Button>
        </Group>
        {op.alerta}
      </Modal>
    </Stack>
  );
}
