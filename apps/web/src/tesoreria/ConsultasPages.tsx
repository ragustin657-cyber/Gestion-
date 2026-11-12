import { Group, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { FiltroFechas, finDelMes, primeroDelMes } from '../compras/consultas/comun';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, opcionesCajas, opcionesCuentas, useCajas, useCuentasBancarias } from './comun';

interface Saldos {
  bancos: { id: string; nombre: string; monedaCodigo: string; saldo: string }[];
  cajas: { id: string; nombre: string; sucursal: string; monedaCodigo: string; efectivo: string; cheques: string }[];
}

export function SaldosPage() {
  const [fecha, setFecha] = useState(hoy());
  const q = useQuery({ queryKey: ['/tesoreria/saldos', fecha], queryFn: () => api<Saldos>('/tesoreria/saldos', { query: { fecha } }), enabled: !!fecha });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Saldos de tesorería</Title>
      <TextInput label="Al" type="date" w={200} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      {errorConsulta(q.error)}
      {!!q.data?.bancos.length && (
        <>
          <Title order={5} mt="md" mb={4}>Cuentas bancarias</Title>
          <Table withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th>Moneda</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{q.data.bancos.map((b) => <Table.Tr key={b.id}><Table.Td>{b.nombre}</Table.Td><Table.Td>{b.monedaCodigo}</Table.Td><Table.Td ta="right" data-testid={`saldo-banco-${b.nombre}`}>{formatoMoneda(b.saldo, b.monedaCodigo)}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </>
      )}
      <Title order={5} mt="md" mb={4}>Cajas</Title>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Caja</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th ta="right">Efectivo</Table.Th><Table.Th ta="right">Cheques en cartera</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data?.cajas ?? []).map((c) => (
            <Table.Tr key={c.id}><Table.Td>{c.nombre}</Table.Td><Table.Td>{c.sucursal}</Table.Td><Table.Td ta="right">{formatoMoneda(c.efectivo, c.monedaCodigo)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(c.cheques, c.monedaCodigo)}</Table.Td><Table.Td ta="right">{formatoMoneda(Number(c.efectivo) + Number(c.cheques), c.monedaCodigo)}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

interface Movimientos { saldoInicial: string; saldoFinal: string; movimientos: { id: string; fecha: string; tipo: string; descripcion: string; monedaCodigo: string; importe: string; saldo: string }[] }

export function MovimientosCuentaPage() {
  const cuentas = useCuentasBancarias();
  const cajas = useCajas();
  const [tipo, setTipo] = useState(cuentas.length ? 'BANCO' : 'CAJA');
  const [id, setId] = useState<string | null>(null);
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(finDelMes());
  const query = { [tipo === 'BANCO' ? 'cuentaBancariaId' : 'cajaId']: id ?? undefined, desde, hasta };
  const q = useQuery({ queryKey: ['/tesoreria/movimientos', query], queryFn: () => api<Movimientos>('/tesoreria/movimientos', { query }), enabled: !!id });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Movimientos de cuenta o caja</Title>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <SegmentedControl value={tipo} onChange={(t) => { setTipo(t); setId(null); }} data={[{ value: 'BANCO', label: 'Banco' }, { value: 'CAJA', label: 'Caja' }]} />
        <Select label={tipo === 'BANCO' ? 'Cuenta bancaria' : 'Caja'} w={300} value={id} onChange={setId} data={tipo === 'BANCO' ? opcionesCuentas(cuentas) : opcionesCajas(cajas)} />
      </FiltroFechas>
      {errorConsulta(q.error)}
      {q.data && (
        <ScrollArea mt="md">
          <Table withTableBorder striped miw={700}>
            <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Ingreso</Table.Th><Table.Th ta="right">Egreso</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              <Table.Tr><Table.Td /><Table.Td fw={600}>Saldo inicial</Table.Td><Table.Td /><Table.Td /><Table.Td ta="right">{formatoMoneda(q.data.saldoInicial)}</Table.Td></Table.Tr>
              {q.data.movimientos.map((m) => (
                <Table.Tr key={m.id}><Table.Td>{formatoFecha(m.fecha)}</Table.Td><Table.Td>{m.descripcion}</Table.Td>
                  <Table.Td ta="right">{m.tipo === 'INGRESO' ? formatoMoneda(m.importe, m.monedaCodigo) : ''}</Table.Td><Table.Td ta="right">{m.tipo === 'EGRESO' ? formatoMoneda(m.importe, m.monedaCodigo) : ''}</Table.Td>
                  <Table.Td ta="right">{formatoMoneda(m.saldo, m.monedaCodigo)}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot><Table.Tr><Table.Th colSpan={4}>Saldo final</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.saldoFinal)}</Table.Th></Table.Tr></Table.Tfoot>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  );
}
