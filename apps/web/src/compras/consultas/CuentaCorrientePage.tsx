import { Alert, Group, Modal, Paper, ScrollArea, SimpleGrid, Table, Text, Title, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../../api/cliente';
import { formatoFecha, formatoMoneda } from '../formato';
import { FiltroFechas, SelectProveedor } from './comun';
import { DetalleComprobante } from './DetalleComprobante';
import { DetalleOrdenPago } from '../../pagos/DetalleOrdenPago';

interface Movimiento { id: string; origenId: string; fecha: string; fechaVencimiento: string | null; comprobante: string; monedaCodigo: string; importe: string; importePesos: string; saldo: string | null; acumuladoPesos: string }
interface CuentaCorriente { tercero: { razonSocial: string }; movimientos: Movimiento[]; saldos: { ARS: string; USD: string; pesos: string } }

export function CuentaCorrientePage({ terceroIdInicial }: { terceroIdInicial?: string }) {
  const [terceroId, setTerceroId] = useState<string | null>(terceroIdInicial ?? null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [abierto, setAbierto] = useState<{ id: string; tipo: 'FC' | 'OP' } | null>(null);
  const q = useQuery({
    queryKey: ['/compras/cuenta-corriente', terceroId, desde, hasta],
    queryFn: () => api<CuentaCorriente>(`/compras/cuenta-corriente/${terceroId}`, { query: { desde, hasta } }),
    enabled: !!terceroId,
  });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Cuenta corriente de proveedores</Title>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <SelectProveedor value={terceroId} onChange={setTerceroId} requerido />
      </FiltroFechas>
      {q.isError && <Alert color="red" mt="md">{q.error instanceof ErrorApi ? q.error.mensaje : 'Error'}</Alert>}
      {q.data && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }} my="md">
            <Paper withBorder p="sm"><Text size="xs" c="dimmed">Saldo en pesos (equivalente)</Text><Text fw={700} data-testid="saldo-pesos">{formatoMoneda(q.data.saldos.pesos)}</Text></Paper>
            <Paper withBorder p="sm"><Text size="xs" c="dimmed">Saldo en comprobantes en pesos</Text><Text fw={600}>{formatoMoneda(q.data.saldos.ARS)}</Text></Paper>
            <Paper withBorder p="sm"><Text size="xs" c="dimmed">Saldo en comprobantes en dólares</Text><Text fw={600}>{formatoMoneda(q.data.saldos.USD, 'USD')}</Text></Paper>
          </SimpleGrid>
          <ScrollArea>
            <Table withTableBorder striped miw={700}>
              <Table.Thead>
                <Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Vencimiento</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">En pesos</Table.Th><Table.Th ta="right">Acumulado</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.movimientos.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td>{formatoFecha(m.fecha)}</Table.Td>
                    <Table.Td><UnstyledButton c="indigo" onClick={() => setAbierto({ id: m.origenId, tipo: m.comprobante.startsWith('OP ') || m.comprobante.startsWith('Anticipo') ? 'OP' : 'FC' })}>{m.comprobante}</UnstyledButton></Table.Td>
                    <Table.Td>{formatoFecha(m.fechaVencimiento)}</Table.Td>
                    <Table.Td ta="right">{formatoMoneda(m.importe, m.monedaCodigo)}</Table.Td>
                    <Table.Td ta="right">{formatoMoneda(m.importePesos)}</Table.Td>
                    <Table.Td ta="right">{formatoMoneda(m.acumuladoPesos)}</Table.Td>
                  </Table.Tr>
                ))}
                {!q.data.movimientos.length && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" size="sm">Sin movimientos</Text></Table.Td></Table.Tr>}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
      <Group />
      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title={abierto?.tipo === 'OP' ? 'Orden de pago' : 'Comprobante'} size="xl">
        {abierto?.tipo === 'FC' && <DetalleComprobante id={abierto.id} />}
        {abierto?.tipo === 'OP' && <DetalleOrdenPago id={abierto.id} alCerrar={() => setAbierto(null)} />}
      </Modal>
    </Paper>
  );
}
