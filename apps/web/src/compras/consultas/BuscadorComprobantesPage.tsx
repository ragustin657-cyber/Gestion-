import { Badge, Modal, Paper, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/cliente';
import { DetalleOrdenCompra } from '../DetalleOrdenCompra';
import { formatoFecha, formatoMoneda } from '../formato';
import { FiltroFechas } from './comun';
import { DetalleComprobante } from './DetalleComprobante';
import { DetalleRecepcion } from './RecepcionesPage';

interface Resultado { tipo: 'OC' | 'IR' | 'FC'; id: string; numero: string; fecha: string; razonSocial: string; estado: string; total?: string }
const ETIQUETA = { OC: 'Orden de compra', IR: 'Recepción', FC: 'Comprobante' };

export function BuscadorComprobantesPage() {
  const [texto, setTexto] = useState('');
  const [q] = useDebouncedValue(texto, 300);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [abierto, setAbierto] = useState<Resultado | null>(null);
  const r = useQuery({ queryKey: ['/compras/buscador', q, desde, hasta], queryFn: () => api<Resultado[]>('/compras/buscador', { query: { q, desde, hasta } }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Buscador de comprobantes</Title>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <TextInput label="Buscar" placeholder="Proveedor, CUIT o número (ej. 0001-00001234)" leftSection={<IconSearch size={16} />} value={texto} onChange={(e) => setTexto(e.currentTarget.value)} w={340} />
      </FiltroFechas>
      <Table withTableBorder striped highlightOnHover mt="md">
        <Table.Thead><Table.Tr><Table.Th>Tipo</Table.Th><Table.Th>Número</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>Estado</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(r.data ?? []).map((x) => (
            <Table.Tr key={x.tipo + x.id} style={{ cursor: 'pointer' }} onClick={() => setAbierto(x)}>
              <Table.Td><Badge size="sm" variant="light">{ETIQUETA[x.tipo]}</Badge></Table.Td>
              <Table.Td>{x.numero}</Table.Td>
              <Table.Td>{formatoFecha(x.fecha)}</Table.Td>
              <Table.Td>{x.razonSocial}</Table.Td>
              <Table.Td>{x.estado}</Table.Td>
              <Table.Td ta="right">{x.total ? formatoMoneda(x.total) : ''}</Table.Td>
            </Table.Tr>
          ))}
          {!r.data?.length && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" size="sm">Sin resultados</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title={abierto ? ETIQUETA[abierto.tipo] : ''} size="xl">
        {abierto?.tipo === 'OC' && <DetalleOrdenCompra id={abierto.id} alCerrar={() => setAbierto(null)} />}
        {abierto?.tipo === 'IR' && <DetalleRecepcion id={abierto.id} />}
        {abierto?.tipo === 'FC' && <DetalleComprobante id={abierto.id} />}
      </Modal>
    </Paper>
  );
}
