import { Paper, Table, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/cliente';
import { useAuth } from '../../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy as hoyLocal, numeroInterno } from '../formato';

interface PendRecibir { ordenCompraRenglonId: string; ocNumero: number; fechaEntrega: string | null; descripcion: string; cantidad: string; recibido: string; pendiente: string }
interface PendFacturar { informeRecepcionRenglonId: string; irNumero: number; remitoNumero: string; ocNumero: number; descripcion: string; precioUnitario: string; pendiente: string }

function Tabla({ titulos, filas }: { titulos: string[]; filas: React.ReactNode[][] }) {
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr>{titulos.map((t) => <Table.Th key={t}>{t}</Table.Th>)}</Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((f, i) => <Table.Tr key={i}>{f.map((c, j) => <Table.Td key={j}>{c}</Table.Td>)}</Table.Tr>)}
        {!filas.length && <Table.Tr><Table.Td colSpan={titulos.length}><Text c="dimmed" ta="center" size="sm">Sin pendientes</Text></Table.Td></Table.Tr>}
      </Table.Tbody>
    </Table>
  );
}

export function PendientesPage() {
  const { puede } = useAuth();
  const hoy = hoyLocal();
  const recibir = useQuery({ queryKey: ['/compras/ordenes/pendientes-recibir', 'todos'], queryFn: () => api<PendRecibir[]>('/compras/ordenes/pendientes-recibir'), enabled: puede('ir.crear') });
  const facturar = useQuery({ queryKey: ['/compras/recepciones/pendientes-facturar', 'todos'], queryFn: () => api<PendFacturar[]>('/compras/recepciones/pendientes-facturar'), enabled: puede('fc.crear') });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Pendientes de compras</Title>
      <Tabs defaultValue={puede('ir.crear') ? 'recibir' : 'facturar'}>
        <Tabs.List mb="md">
          {puede('ir.crear') && <Tabs.Tab value="recibir">OC pendientes de recibir</Tabs.Tab>}
          {puede('fc.crear') && <Tabs.Tab value="facturar">Recepciones pendientes de facturar</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="recibir">
          <Tabla titulos={['OC', 'Entrega', 'Descripción', 'Pedido', 'Recibido', 'Pendiente']} filas={(recibir.data ?? []).map((p) => [
            numeroInterno(p.ocNumero),
            p.fechaEntrega && p.fechaEntrega.slice(0, 10) < hoy ? <Text c="red" size="sm">{formatoFecha(p.fechaEntrega)} (atrasada)</Text> : formatoFecha(p.fechaEntrega),
            p.descripcion, Number(p.cantidad), Number(p.recibido), Number(p.pendiente),
          ])} />
        </Tabs.Panel>
        <Tabs.Panel value="facturar">
          <Tabla titulos={['Recepción', 'Remito', 'OC', 'Descripción', 'Precio', 'Pendiente']} filas={(facturar.data ?? []).map((p) => [
            numeroInterno(p.irNumero), p.remitoNumero, numeroInterno(p.ocNumero), p.descripcion, formatoMoneda(p.precioUnitario), Number(p.pendiente),
          ])} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
