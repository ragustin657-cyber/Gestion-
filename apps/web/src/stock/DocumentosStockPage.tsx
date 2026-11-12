import { Badge, Button, Group, Modal, Paper, Select, Table, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { NOMBRE_DOCUMENTO, useDepositos } from './comun';

interface Documento { id: string; numero: number; tipo: string; fecha: string; depositoId: string; depositoDestinoId: string | null; estado: string; renglones: unknown[] }

export function DocumentosStockPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const [tipo, setTipo] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const q = useQuery({ queryKey: ['/stock/documentos', tipo], queryFn: () => api<Documento[]>('/stock/documentos', { query: { tipo } }) });
  const depositos = new Map((useDepositos().data ?? []).map((d) => [d.id, d.nombre]));
  const anular = async () => {
    const r = await op.ejecutar(() => api(`/stock/documentos/${anulando}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Documento anulado');
    setAnulando(null);
    setMotivo('');
    if (r) void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/stock') });
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Documentos de stock</Title>
      <Select label="Tipo" w={240} clearable mb="md" data={Object.entries(NOMBRE_DOCUMENTO).map(([value, label]) => ({ value, label }))} value={tipo} onChange={setTipo} />
      {errorConsulta(q.error)}
      {op.alerta}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Depósito</Table.Th><Table.Th>Renglones</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((d) => (
            <Table.Tr key={d.id}>
              <Table.Td>{d.numero}</Table.Td>
              <Table.Td>{NOMBRE_DOCUMENTO[d.tipo]}</Table.Td>
              <Table.Td>{formatoFecha(d.fecha)}</Table.Td>
              <Table.Td>{depositos.get(d.depositoId)}{d.depositoDestinoId ? ` → ${depositos.get(d.depositoDestinoId)}` : ''}</Table.Td>
              <Table.Td>{d.renglones.length}</Table.Td>
              <Table.Td>
                {d.estado === 'ANULADO'
                  ? <Badge color="gray" variant="light">Anulado</Badge>
                  : puede('stock.operar') && <Button size="compact-xs" color="red" variant="light" onClick={() => setAnulando(d.id)}>Anular</Button>}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!anulando} onClose={() => setAnulando(null)} title="Anular documento">
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group mt="md"><Button color="red" disabled={!motivo.trim()} onClick={() => void anular()}>Anular</Button></Group>
      </Modal>
    </Paper>
  );
}
