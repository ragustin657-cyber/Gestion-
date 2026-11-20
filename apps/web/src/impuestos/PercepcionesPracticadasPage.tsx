import { Button, Group, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';

interface Fila { fecha: string; comprobante: string; cliente: string; cuit: string; tipo: string; jurisdiccion: string | null; regimen: string | null; base: string; alicuota: string; importe: string }

/** Impuestos → Percepciones practicadas (spec E39 §9): detalle para cargar en el SIRE (IVA) o en e-ARCIBA (notas de crédito de CABA). */
export function PercepcionesPracticadasPage() {
  const [desde, setDesde] = useState(`${hoy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [tipo, setTipo] = useState('IVA');
  const q = useQuery({ queryKey: ['/impuestos/percepciones-practicadas', desde, hasta, tipo], queryFn: () => api<{ filas: Fila[]; total: string }>('/impuestos/percepciones-practicadas', { query: { desde, hasta, tipo } }) });
  const archivo = (formato: 'xlsx' | 'pdf') => void descargar('/impuestos/percepciones-practicadas', { desde, hasta, tipo, formato }, `percepciones-practicadas-${desde}-${hasta}.${formato}`);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Percepciones practicadas</Title>
      <Group mb="md" align="flex-end">
        <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <Select label="Impuesto" w={140} allowDeselect={false} value={tipo} onChange={(v) => setTipo(v ?? 'IVA')} data={[{ value: 'IVA', label: 'IVA' }, { value: 'IIBB', label: 'Ingresos Brutos' }]} />
        <Button variant="default" onClick={() => archivo('xlsx')}>Excel</Button>
        <Button variant="default" onClick={() => archivo('pdf')}>PDF</Button>
      </Group>
      {errorConsulta(q.error)}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>CUIT</Table.Th><Table.Th>Impuesto</Table.Th><Table.Th ta="right">Base</Table.Th><Table.Th ta="right">Alícuota</Table.Th><Table.Th ta="right">Percepción</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data?.filas ?? []).map((f, i) => (
            <Table.Tr key={i}>
              <Table.Td>{f.fecha.slice(0, 10).split('-').reverse().join('/')}</Table.Td><Table.Td>{f.comprobante}</Table.Td><Table.Td>{f.cliente}</Table.Td><Table.Td>{f.cuit}</Table.Td>
              <Table.Td>{f.tipo === 'IVA' ? `IVA ${f.regimen ?? ''}` : `IIBB ${f.jurisdiccion}`}</Table.Td><Table.Td ta="right">{formatoMoneda(f.base)}</Table.Td>
              <Table.Td ta="right">{`${Number(f.alicuota).toLocaleString('es-AR')} %`}</Table.Td><Table.Td ta="right">{formatoMoneda(f.importe)}</Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr fw={700}><Table.Td colSpan={7}>Total</Table.Td><Table.Td ta="right">{formatoMoneda(q.data?.total ?? '0')}</Table.Td></Table.Tr>
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="xs">Las notas de crédito restan. Las percepciones de ARBA y las de facturas de CABA ya van en sus archivos de Presentaciones.</Text>
    </Paper>
  );
}
