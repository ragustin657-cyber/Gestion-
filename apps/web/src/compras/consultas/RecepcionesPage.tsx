import { Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../../api/cliente';
import { useAuth } from '../../auth/AuthContext';
import { TablaAbm } from '../../abm/TablaAbm';
import { formatoFecha, numeroInterno } from '../formato';

interface Recepcion {
  id: string; numero: number; fecha: string; remitoNumero: string; estado: string; motivoAnulacion: string | null; observaciones: string | null;
  tercero: { razonSocial: string };
  renglones: { id: string; cantidad: string; cantidadFacturada: string; ordenCompraRenglon: { descripcion: string; ordenCompra: { numero: number } } }[];
}

export function DetalleRecepcion({ id }: { id: string }) {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/compras/recepciones', id], queryFn: () => api<Recepcion>(`/compras/recepciones/${id}`) });
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const r = q.data;
  if (!r) return <Loader size="sm" />;
  async function anular() {
    setError('');
    try {
      await api(`/compras/recepciones/${id}/anular`, { metodo: 'POST', body: { motivo } });
      notifications.show({ color: 'green', message: 'Recepción anulada' });
      setAnulando(false);
      void qc.invalidateQueries({ queryKey: ['/compras/recepciones'] });
      void qc.invalidateQueries({ queryKey: ['/compras/ordenes'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Text fw={700}>{r.tercero.razonSocial}</Text>
          <Text size="sm" c="dimmed">Recepción {numeroInterno(r.numero)} · Remito {r.remitoNumero} · {formatoFecha(r.fecha)}</Text>
        </div>
        <Badge variant="light" color={r.estado === 'ANULADO' ? 'red' : 'green'}>{r.estado === 'ANULADO' ? 'Anulada' : 'Confirmada'}</Badge>
      </Group>
      {r.motivoAnulacion && <Alert color="red">Anulada: {r.motivoAnulacion}</Alert>}
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>OC</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Recibido</Table.Th><Table.Th ta="right">Facturado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {r.renglones.map((x) => (
            <Table.Tr key={x.id}>
              <Table.Td>{numeroInterno(x.ordenCompraRenglon.ordenCompra.numero)}</Table.Td>
              <Table.Td>{x.ordenCompraRenglon.descripcion}</Table.Td>
              <Table.Td ta="right">{Number(x.cantidad)}</Table.Td>
              <Table.Td ta="right">{Number(x.cantidadFacturada)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {r.estado === 'CONFIRMADO' && puede('ir.anular') && <Group justify="flex-end"><Button color="red" variant="light" onClick={() => setAnulando(true)}>Anular</Button></Group>}
      <Modal opened={anulando} onClose={() => setAnulando(false)} title="Anular recepción">
        <Stack>
          <Textarea label="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end"><Button color="red" disabled={!motivo.trim()} onClick={anular}>Anular</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

interface Fila { id: string; numero: number; fecha: string; remitoNumero: string; estado: string; tercero: { razonSocial: string } }

export function RecepcionesPage() {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Recepciones</Title>
      <TablaAbm<Fila>
        ruta="/compras/recepciones" paginado buscador={false} onSeleccionar={(f) => setAbierta(f.id)}
        columnas={[
          { campo: 'numero', titulo: 'Número', render: (f) => numeroInterno(f.numero) },
          { campo: 'fecha', titulo: 'Fecha', render: (f) => formatoFecha(f.fecha) },
          { campo: 'tercero', titulo: 'Proveedor', render: (f) => f.tercero.razonSocial },
          { campo: 'remitoNumero', titulo: 'Remito' },
          { campo: 'estado', titulo: 'Estado', render: (f) => <Badge size="sm" variant="light" color={f.estado === 'ANULADO' ? 'red' : 'green'}>{f.estado === 'ANULADO' ? 'Anulada' : 'Confirmada'}</Badge> },
        ]}
      />
      <Modal opened={!!abierta} onClose={() => setAbierta(null)} title="Recepción" size="lg">{abierta && <DetalleRecepcion id={abierta} />}</Modal>
    </Paper>
  );
}
