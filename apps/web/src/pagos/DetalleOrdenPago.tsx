import { Alert, Badge, Button, Group, Loader, Modal, Stack, Table, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, descargar, ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { TablaRetenciones } from './TablaRetenciones';
import { ESTADOS_OP, numeroOP, OrdenPago } from './tipos';

type Accion = 'aprobar' | 'rechazar' | 'anular';
const ETIQUETAS: Record<Accion, string> = { aprobar: 'Aprobar', rechazar: 'Rechazar', anular: 'Anular' };
const MEDIO: Record<string, string> = { TRANSFERENCIA: 'Transferencia', CHEQUE: 'Cheque', EFECTIVO: 'Efectivo' };

export function DetalleOrdenPago({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const q = useQuery({ queryKey: ['/pagos/ordenes', id], queryFn: () => api<OrdenPago>(`/pagos/ordenes/${id}`) });
  const [accion, setAccion] = useState<Accion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const op = q.data;
  if (q.isError) return <Alert color="red">{q.error instanceof ErrorApi ? q.error.mensaje : 'Error al cargar'}</Alert>;
  if (!op) return <Loader size="sm" />;

  const disponibles: Accion[] = [];
  if (op.estado === 'PENDIENTE_APROBACION' && puede('op.aprobar')) disponibles.push('aprobar', 'rechazar');
  if (['PENDIENTE_APROBACION', 'APROBADA', 'PAGADA'].includes(op.estado) && puede('op.anular')) disponibles.push('anular');
  const pideMotivo = accion === 'rechazar' || accion === 'anular';

  async function ejecutar() {
    if (!accion) return;
    setError('');
    try {
      await api(`/pagos/ordenes/${op!.id}/${accion}`, { metodo: 'POST', body: { version: op!.version, ...(motivo ? { motivo } : {}) } });
      notifications.show({ color: 'green', message: 'Operación realizada' });
      setAccion(null);
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['/pagos/ordenes'] });
      void qc.invalidateQueries({ queryKey: ['/pagos/pendientes'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      if (e instanceof ErrorApi && e.status === 409) void q.refetch();
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Text fw={700}>{op.tercero.razonSocial}</Text>
          <Text size="sm" c="dimmed">OP {numeroOP(op.numero)} · {formatoFecha(op.fecha)}{op.fechaPago ? ` · Pagada el ${formatoFecha(op.fechaPago)}` : ''}</Text>
        </div>
        <Badge variant="light" color={ESTADOS_OP[op.estado].color}>{ESTADOS_OP[op.estado].etiqueta}</Badge>
      </Group>
      {op.motivoAnulacion && <Alert color="red">Anulada: {op.motivoAnulacion}</Alert>}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Comprobante</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">En pesos</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {op.imputaciones.map((i) => (
            <Table.Tr key={i.id}><Table.Td>{i.comprobante}</Table.Td><Table.Td ta="right">{formatoMoneda(i.importe, i.monedaCodigo)}</Table.Td><Table.Td ta="right">{formatoMoneda(i.importePesos)}</Table.Td></Table.Tr>
          ))}
          {op.anticipo && <Table.Tr><Table.Td>Anticipo (pago a cuenta)</Table.Td><Table.Td ta="right">{formatoMoneda(op.anticipo.importe, op.anticipo.monedaCodigo)}</Table.Td><Table.Td /></Table.Tr>}
        </Table.Tbody>
      </Table>
      <TablaRetenciones retenciones={op.retenciones} opId={op.id} certificados={['PAGADA', 'ANULADA'].includes(op.estado)} />
      {op.medios.length > 0 && (
        <Table withTableBorder>
          <Table.Thead><Table.Tr><Table.Th>Medio de pago</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">En pesos</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {op.medios.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>{MEDIO[m.tipo]}{m.chequeNumero ? ` N° ${m.chequeNumero} (pago ${formatoFecha(m.chequeFechaPago)})` : ''}{m.referencia ? ` · ${m.referencia}` : ''}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(m.importe, m.monedaCodigo)}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(m.importePesos)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group justify="flex-end" gap="lg">
        <Text size="sm">Total {formatoMoneda(op.totalCancelarPesos)}</Text>
        <Text size="sm">Retenciones {formatoMoneda(op.totalRetenciones)}</Text>
        <Text fw={700}>Neto {formatoMoneda(op.netoPagar)}</Text>
      </Group>
      <Group justify="flex-end">
        {op.estado === 'BORRADOR' && puede('op.crear') && <Button variant="default" onClick={() => { alCerrar(); navegar(`/pagos/op/${op.id}`); }}>Editar</Button>}
        {op.numero && <Button variant="default" onClick={() => descargar(`/pagos/ordenes/${op.id}/pdf`, {}, `orden-pago-${numeroOP(op.numero)}.pdf`).catch((e) => setError(e.mensaje))}>Descargar PDF</Button>}
        {disponibles.map((a) => (
          <Button key={a} color={a === 'aprobar' ? undefined : 'red'} variant={a === 'aprobar' ? 'filled' : 'light'} onClick={() => setAccion(a)}>{ETIQUETAS[a]}</Button>
        ))}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <Modal opened={!!accion} onClose={() => setAccion(null)} title={accion ? ETIQUETAS[accion] : ''}>
        <Stack>
          {accion === 'anular' && op.estado === 'PAGADA' && <Alert color="yellow">Se revierte el pago: vuelven los saldos, se anulan cheques y certificados y se genera el contraasiento.</Alert>}
          <Textarea label={pideMotivo ? 'Motivo (obligatorio)' : 'Motivo (opcional)'} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
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
