import { Alert, Badge, Button, Group, Loader, Modal, SimpleGrid, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../../api/cliente';
import { useAuth } from '../../auth/AuthContext';
import { formatoFecha, formatoMoneda, formatoNumero, numeroInterno } from '../formato';

export const TIPOS_FC: Record<string, string> = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito', TICKET: 'Ticket' };

interface RenglonAsiento { id: string; cuentaCodigo?: string; cuentaNombre?: string; debe: string; haber: string }
interface Asiento { numero: number; fecha: string; descripcion: string; renglones: RenglonAsiento[] }
interface Comprobante {
  id: string; numeroInterno: number; tipo: string; letra: string; puntoVenta: number; numero: number; fechaEmision: string; fechaContable: string;
  fechaVencimiento: string; monedaCodigo: string; cotizacion: string; netoGravado: string; iva: string; percepcionIva: string; impuestosInternos: string;
  noGravado: string; exento: string; total: string; totalPesos: string; estado: string; motivoAnulacion: string | null; aceptoDiferencias: boolean;
  tercero: { razonSocial: string; cuit: string };
  renglones: { id: string; descripcion: string; cantidad: string; precioUnitario: string; alicuotaIva: string; importe: string; origen: string }[];
  ivas: { alicuota: string; base: string; importe: string }[];
  percepcionesIibb: { jurisdiccion: string; importe: string }[];
  asiento: Asiento | null; asientoAnulacion: Asiento | null;
  recepciones: { id: string; numero: number; remitoNumero: string }[]; ordenes: { id: string; numero: number }[];
}

function TablaAsiento({ titulo, a }: { titulo: string; a: Asiento }) {
  return (
    <Stack gap={4}>
      <Text fw={600} size="sm">{titulo} N° {a.numero} · {formatoFecha(a.fecha)}</Text>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th ta="right">Debe</Table.Th><Table.Th ta="right">Haber</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {a.renglones.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.cuentaCodigo} {r.cuentaNombre}</Table.Td>
              <Table.Td ta="right">{Number(r.debe) ? formatoMoneda(r.debe) : ''}</Table.Td>
              <Table.Td ta="right">{Number(r.haber) ? formatoMoneda(r.haber) : ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export function DetalleComprobante({ id }: { id: string }) {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/compras/comprobantes', id], queryFn: () => api<Comprobante>(`/compras/comprobantes/${id}`) });
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  if (q.isError) return <Alert color="red">{q.error instanceof ErrorApi ? q.error.mensaje : 'Error al cargar'}</Alert>;
  const c = q.data;
  if (!c) return <Loader size="sm" />;
  const m = c.monedaCodigo;

  async function anular() {
    setError('');
    try {
      await api(`/compras/comprobantes/${id}/anular`, { metodo: 'POST', body: { motivo } });
      notifications.show({ color: 'green', message: 'Comprobante anulado' });
      setAnulando(false);
      void qc.invalidateQueries({ queryKey: ['/compras'] });
      void qc.invalidateQueries({ queryKey: ['/compras/comprobantes'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={4}>{TIPOS_FC[c.tipo]} {c.letra} {formatoNumero(c.puntoVenta, c.numero)}</Title>
          <Text size="sm" c="dimmed">{c.tercero.razonSocial} · N° interno {c.numeroInterno}</Text>
        </div>
        <Badge color={c.estado === 'ANULADO' ? 'red' : 'green'} variant="light">{c.estado === 'ANULADO' ? 'Anulado' : 'Confirmado'}</Badge>
      </Group>
      {c.motivoAnulacion && <Alert color="red">Anulado: {c.motivoAnulacion}</Alert>}
      {c.aceptoDiferencias && <Alert color="yellow">Se cargó aceptando diferencias con la orden de compra.</Alert>}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Text size="sm">Emisión: {formatoFecha(c.fechaEmision)}</Text>
        <Text size="sm">Contable: {formatoFecha(c.fechaContable)}</Text>
        <Text size="sm">Vencimiento: {formatoFecha(c.fechaVencimiento)}</Text>
        <Text size="sm">{m === 'USD' ? `Cotización: ${Number(c.cotizacion).toLocaleString('es-AR')}` : 'Pesos'}</Text>
      </SimpleGrid>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Descripción</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Precio</Table.Th><Table.Th ta="right">IVA</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {c.renglones.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.descripcion}</Table.Td>
              <Table.Td ta="right">{Number(r.cantidad)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(r.precioUnitario, m)}</Table.Td>
              <Table.Td ta="right">{Number(r.alicuotaIva)} %</Table.Td>
              <Table.Td ta="right">{formatoMoneda(r.importe, m)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Stack gap={2} align="flex-end">
        <Text size="sm">Neto: {formatoMoneda(c.netoGravado, m)}</Text>
        {c.ivas.map((i) => <Text size="sm" key={i.alicuota}>IVA {Number(i.alicuota)} %: {formatoMoneda(i.importe, m)}</Text>)}
        {Number(c.percepcionIva) > 0 && <Text size="sm">Percepción IVA: {formatoMoneda(c.percepcionIva, m)}</Text>}
        {c.percepcionesIibb.map((p) => <Text size="sm" key={p.jurisdiccion}>Percepción IIBB {p.jurisdiccion}: {formatoMoneda(p.importe, m)}</Text>)}
        {Number(c.impuestosInternos) > 0 && <Text size="sm">Impuestos internos: {formatoMoneda(c.impuestosInternos, m)}</Text>}
        {Number(c.noGravado) > 0 && <Text size="sm">No gravado: {formatoMoneda(c.noGravado, m)}</Text>}
        {Number(c.exento) > 0 && <Text size="sm">Exento: {formatoMoneda(c.exento, m)}</Text>}
        <Text fw={700}>Total: {formatoMoneda(c.total, m)}{m === 'USD' ? ` (${formatoMoneda(c.totalPesos)})` : ''}</Text>
      </Stack>
      {(c.recepciones.length > 0 || c.ordenes.length > 0) && (
        <Text size="sm">
          Vinculado a: {c.ordenes.map((o) => `OC ${numeroInterno(o.numero)}`).join(', ')}
          {c.recepciones.length > 0 && ` · ${c.recepciones.map((r) => `Recepción ${numeroInterno(r.numero)} (remito ${r.remitoNumero})`).join(', ')}`}
        </Text>
      )}
      {c.asiento && <TablaAsiento titulo="Asiento" a={c.asiento} />}
      {c.asientoAnulacion && <TablaAsiento titulo="Contraasiento" a={c.asientoAnulacion} />}
      {c.estado === 'CONFIRMADO' && puede('fc.anular') && (
        <Group justify="flex-end"><Button color="red" variant="light" onClick={() => setAnulando(true)}>Anular</Button></Group>
      )}
      <Modal opened={anulando} onClose={() => setAnulando(false)} title="Anular comprobante">
        <Stack>
          <Textarea label="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end"><Button color="red" disabled={!motivo.trim()} onClick={anular}>Anular</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
