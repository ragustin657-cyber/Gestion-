import { Alert, Badge, Button, Group, Loader, Modal, Stack, Table, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, descargar, ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { ESTADOS_OC, formatoFecha, formatoMoneda, numeroInterno } from './formato';
import { OrdenCompra } from './OrdenCompraPage';

type Accion = 'aprobar' | 'rechazar' | 'anular' | 'cerrar';
const ETIQUETAS: Record<Accion, string> = { aprobar: 'Aprobar', rechazar: 'Rechazar', anular: 'Anular', cerrar: 'Cerrar (dar por cumplida)' };

/** Detalle de una OC con sus acciones según permisos y estado. */
export function DetalleOrdenCompra({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const consulta = useQuery({ queryKey: ['/compras/ordenes', id], queryFn: () => api<OrdenCompra>(`/compras/ordenes/${id}`) });
  const [accion, setAccion] = useState<Accion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const oc = consulta.data;
  if (consulta.isError) return <Alert color="red">{consulta.error instanceof ErrorApi ? consulta.error.mensaje : 'Error al cargar'}</Alert>;
  if (!oc) return <Loader size="sm" />;

  const disponibles: Accion[] = [];
  if (oc.estado === 'PENDIENTE_APROBACION' && puede('oc.aprobar')) disponibles.push('aprobar', 'rechazar');
  if (['PENDIENTE_APROBACION', 'APROBADA'].includes(oc.estado) && puede('oc.anular')) disponibles.push('anular');
  if (['APROBADA', 'PARCIALMENTE_RECIBIDA'].includes(oc.estado) && puede('oc.aprobar')) disponibles.push('cerrar');
  const pideMotivo = accion === 'rechazar' || accion === 'anular';

  async function ejecutar() {
    if (!accion) return;
    setError('');
    try {
      await api(`/compras/ordenes/${oc!.id}/${accion}`, { metodo: 'POST', body: { version: oc!.version, ...(motivo ? { motivo } : {}) } });
      notifications.show({ color: 'green', message: 'Operación realizada' });
      setAccion(null);
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['/compras/ordenes'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      if (e instanceof ErrorApi && e.status === 409) void consulta.refetch();
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Text fw={700}>{oc.tercero.razonSocial}</Text>
          <Text size="sm" c="dimmed">OC {numeroInterno(oc.numero)} · {formatoFecha(oc.fecha)}{oc.fechaEntrega ? ` · Entrega ${formatoFecha(oc.fechaEntrega)}` : ''}</Text>
        </div>
        <Badge color={ESTADOS_OC[oc.estado].color} variant="light">{ESTADOS_OC[oc.estado].etiqueta}</Badge>
      </Group>
      {oc.motivoAnulacion && <Alert color="red">Anulada: {oc.motivoAnulacion}</Alert>}
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr><Table.Th>Descripción</Table.Th><Table.Th ta="right">Pedido</Table.Th><Table.Th ta="right">Recibido</Table.Th><Table.Th ta="right">Facturado</Table.Th><Table.Th ta="right">Pendiente</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {oc.renglones.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.descripcion}</Table.Td>
              <Table.Td ta="right">{Number(r.cantidad)}</Table.Td>
              <Table.Td ta="right">{Number(r.cantidadRecibida)}</Table.Td>
              <Table.Td ta="right">{Number(r.cantidadFacturada)}</Table.Td>
              <Table.Td ta="right">{Number(r.pendiente)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(r.importe, oc.monedaCodigo)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="flex-end" gap="lg">
        <Text size="sm">Neto {formatoMoneda(oc.neto, oc.monedaCodigo)}</Text>
        <Text size="sm">IVA {formatoMoneda(oc.iva, oc.monedaCodigo)}</Text>
        <Text fw={700}>Total {formatoMoneda(oc.total, oc.monedaCodigo)}</Text>
      </Group>
      <Group justify="flex-end">
        {oc.estado === 'BORRADOR' && puede('oc.crear') && <Button variant="default" onClick={() => { alCerrar(); navegar(`/compras/oc/${oc.id}`); }}>Editar</Button>}
        {oc.numero && (
          <Button variant="default" onClick={() => descargar(`/compras/ordenes/${oc.id}/pdf`, {}, `orden-compra-${numeroInterno(oc.numero)}.pdf`).catch((e) => setError(e.mensaje))}>
            Descargar PDF
          </Button>
        )}
        {disponibles.map((a) => (
          <Button key={a} color={a === 'anular' || a === 'rechazar' ? 'red' : undefined} variant={a === 'aprobar' ? 'filled' : 'light'} onClick={() => setAccion(a)}>{ETIQUETAS[a]}</Button>
        ))}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <Modal opened={!!accion} onClose={() => setAccion(null)} title={accion ? ETIQUETAS[accion] : ''}>
        <Stack>
          <Textarea label={pideMotivo ? 'Motivo (obligatorio)' : 'Motivo (opcional)'} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} autosize minRows={2} />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAccion(null)}>Cancelar</Button>
            <Button onClick={ejecutar} disabled={pideMotivo && !motivo.trim()}>Confirmar</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
