import { Button, Checkbox, Group, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { Cheque, errorConsulta, numero, opcionesCajas, opcionesCuentas, useCajas, useCheques, useCuentasBancarias, useOperacion } from './comun';
import { SelectorCheques } from './SelectorCheques';

interface Transferencia { id: string; fecha: string; referencia: string | null; monedaCodigo: string; importe: string; cuentaBancaria: { numero: string; banco: string } | null; tercero: { razonSocial: string } | null; ingresoNumero: number }
interface Pendientes { cheques: (Cheque & { fechaDeposito: string })[]; transferencias: Transferencia[] }

export function DepositoPage() {
  const cajas = useCajas();
  const cuentas = useCuentasBancarias();
  const [fecha, setFecha] = useState(hoy());
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [boleta, setBoleta] = useState('');
  const [efectivo, setEfectivo] = useState('');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const cheques = useCheques({ estado: 'EN_CARTERA', cajaId: cajaId ?? undefined }, !!cajaId);
  const op = useOperacion();
  const moneda = cajas.find((c) => c.id === cajaId)?.monedaCodigo;
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Depósito bancario</Title>
      <Group align="flex-end" wrap="wrap">
        <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
        <Select label="Caja" w={300} data={opcionesCajas(cajas)} value={cajaId} onChange={(v) => { setCajaId(v); setSeleccion([]); }} />
        <Select label="Cuenta bancaria" w={320} value={cuentaId} onChange={setCuentaId} data={opcionesCuentas(cuentas.filter((c) => !moneda || c.monedaCodigo === moneda))} />
        <TextInput label="Boleta" w={140} value={boleta} onChange={(e) => setBoleta(e.currentTarget.value)} />
        <TextInput label="Efectivo" w={160} inputMode="decimal" value={efectivo} onChange={(e) => setEfectivo(e.currentTarget.value)} />
      </Group>
      {cajaId && <><Text fw={600} mt="md" mb={4}>Cheques en cartera</Text><SelectorCheques cheques={cheques.data?.items ?? []} seleccion={seleccion} onChange={setSeleccion} /></>}
      <Group justify="flex-end" mt="md">
        <Button loading={op.enviando} disabled={!cajaId || !cuentaId || (!seleccion.length && !efectivo)} onClick={async () => {
          const r = await op.ejecutar(() => api<{ numero: number }>('/tesoreria/depositos', {
            metodo: 'POST', body: { fecha, cajaId, cuentaBancariaId: cuentaId, boleta: boleta || null, cheques: seleccion, efectivo: efectivo ? { importe: numero(efectivo) } : null },
          }), (d) => `Depósito ${d.numero} registrado`);
          if (r) { setSeleccion([]); setEfectivo(''); setBoleta(''); }
        }}>Depositar</Button>
      </Group>
      {op.alerta}
    </Paper>
  );
}

function TablaPendientes({ datos, chequesSel, transfSel, onCheques, onTransf }: {
  datos?: Pendientes; chequesSel?: string[]; transfSel?: string[]; onCheques?: (s: string[]) => void; onTransf?: (s: string[]) => void;
}) {
  const seleccionable = !!onTransf;
  return (
    <>
      <Text fw={600} mt="md" mb={4}>Cheques depositados</Text>
      {seleccionable
        ? <SelectorCheques cheques={datos?.cheques ?? []} seleccion={chequesSel ?? []} onChange={onCheques!} />
        : (
          <Table withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Banco</Table.Th><Table.Th>Número</Table.Th><Table.Th>Depositado</Table.Th><Table.Th>Cuenta</Table.Th><Table.Th>Fecha de pago</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {(datos?.cheques ?? []).map((c) => (
                <Table.Tr key={c.id}><Table.Td>{c.banco}</Table.Td><Table.Td>{c.numero}</Table.Td><Table.Td>{formatoFecha(c.fechaDeposito)}</Table.Td>
                  <Table.Td>{c.cuentaBancaria ? `${c.cuentaBancaria.banco} - ${c.cuentaBancaria.numero}` : ''}</Table.Td><Table.Td>{formatoFecha(c.fechaPago)}</Table.Td>
                  <Table.Td ta="right">{formatoMoneda(c.importe, c.monedaCodigo)}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      <Text fw={600} mt="md" mb={4}>Transferencias recibidas pendientes</Text>
      <ScrollArea>
        <Table withTableBorder striped miw={600}>
          <Table.Thead><Table.Tr>{seleccionable && <Table.Th w={36} />}<Table.Th>Fecha</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Cuenta</Table.Th><Table.Th>Referencia</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(datos?.transferencias ?? []).map((t) => (
              <Table.Tr key={t.id}>
                {seleccionable && <Table.Td><Checkbox aria-label={`Transferencia ${t.referencia ?? t.id}`} checked={transfSel!.includes(t.id)}
                  onChange={() => onTransf!(transfSel!.includes(t.id) ? transfSel!.filter((x) => x !== t.id) : [...transfSel!, t.id])} /></Table.Td>}
                <Table.Td>{formatoFecha(t.fecha)}</Table.Td><Table.Td>{t.tercero?.razonSocial ?? '—'}</Table.Td>
                <Table.Td>{t.cuentaBancaria ? `${t.cuentaBancaria.banco} - ${t.cuentaBancaria.numero}` : ''}</Table.Td><Table.Td>{t.referencia ?? ''}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(t.importe, t.monedaCodigo)}</Table.Td>
              </Table.Tr>
            ))}
            {!datos?.transferencias.length && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" size="sm" ta="center">Sin transferencias pendientes</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </>
  );
}

const usePendientes = () => useQuery({ queryKey: ['/tesoreria/pendientes-acreditar'], queryFn: () => api<Pendientes>('/tesoreria/pendientes-acreditar') });

export function AcreditacionesPage() {
  const q = usePendientes();
  const [fecha, setFecha] = useState(hoy());
  const [cheques, setCheques] = useState<string[]>([]);
  const [transf, setTransf] = useState<string[]>([]);
  const op = useOperacion();
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Acreditaciones</Title>
      <TextInput label="Fecha de acreditación" type="date" w={200} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      {errorConsulta(q.error)}
      <TablaPendientes datos={q.data} chequesSel={cheques} transfSel={transf} onCheques={setCheques} onTransf={setTransf} />
      <Group justify="flex-end" mt="md">
        <Button loading={op.enviando} disabled={!cheques.length && !transf.length} onClick={async () => {
          const r = await op.ejecutar(() => api<{ cheques: number; transferencias: number }>('/tesoreria/acreditaciones', { metodo: 'POST', body: { fecha, cheques, transferencias: transf } }),
            (x) => `Acreditados: ${x.cheques} cheques y ${x.transferencias} transferencias`);
          if (r) { setCheques([]); setTransf([]); }
        }}>Acreditar</Button>
      </Group>
      {op.alerta}
    </Paper>
  );
}

export function PendientesAcreditarPage() {
  const q = usePendientes();
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3}>Pendientes de acreditar</Title>
      {errorConsulta(q.error)}
      <Stack gap={0}><TablaPendientes datos={q.data} /></Stack>
    </Paper>
  );
}
