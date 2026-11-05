import { ActionIcon, Alert, Button, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useCuentasImputables } from '../abm/opciones';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { numero, opcionesCajas, opcionesCuentas, useCajas, useCuentasBancarias, useOperacion } from './comun';

interface ChequeEditable { tipo: string; banco: string; numero: string; libradorNombre: string; libradorCuit: string; fechaEmision: string; fechaPago: string; importe: string }
interface TransfEditable { cuentaBancariaId: string | null; fecha: string; referencia: string; importe: string }
interface Ingreso { id: string; numero: number; fecha: string; concepto: string; estado: string; efectivo: { importe: string }[]; cheques: { importe: string }[]; transferencias: { importe: string }[] }

const chequeVacio = (): ChequeEditable => ({ tipo: 'FISICO', banco: '', numero: '', libradorNombre: '', libradorCuit: '', fechaEmision: hoy(), fechaPago: hoy(), importe: '' });
const vencido = (fechaPago: string) => {
  const limite = new Date(`${hoy()}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - 30);
  return !!fechaPago && new Date(`${fechaPago}T00:00:00Z`) < limite;
};
const totalIngreso = (i: Ingreso) => [...i.efectivo, ...i.cheques, ...i.transferencias].reduce((s, x) => s + Number(x.importe), 0);

export function IngresoValoresPage() {
  const { puede } = useAuth();
  const cajas = useCajas();
  const cuentas = useCuentasBancarias();
  const imputables = useCuentasImputables();
  const clientes = useQuery({
    queryKey: ['/terceros', 'clientes'],
    queryFn: () => api<{ items: { id: string; razonSocial: string }[] }>('/terceros', { query: { tipo: 'cliente', porPagina: 200 } }),
  }).data?.items ?? [];
  const ingresos = useQuery({ queryKey: ['/tesoreria/ingresos'], queryFn: () => api<{ items: Ingreso[] }>('/tesoreria/ingresos', { query: { porPagina: 20 } }) });
  const op = useOperacion();

  const [fecha, setFecha] = useState(hoy());
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [origen, setOrigen] = useState('CLIENTE');
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [cuentaContableId, setCuentaContableId] = useState<string | null>(null);
  const [concepto, setConcepto] = useState('Cobranza');
  const [efectivo, setEfectivo] = useState('');
  const [cheques, setCheques] = useState<ChequeEditable[]>([]);
  const [transfs, setTransfs] = useState<TransfEditable[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [anulando, setAnulando] = useState<Ingreso | null>(null);
  const [motivo, setMotivo] = useState('');

  const caja = cajas.find((c) => c.id === cajaId);
  const moneda = caja?.monedaCodigo ?? 'ARS';
  const total = (numero(efectivo) || 0) + cheques.reduce((s, c) => s + (numero(c.importe) || 0), 0) + transfs.reduce((s, t) => s + (numero(t.importe) || 0), 0);
  const vencidos = cheques.filter((c) => vencido(c.fechaPago));
  const cambiarCheque = (i: number, c: Partial<ChequeEditable>) => setCheques(cheques.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const cambiarTransf = (i: number, c: Partial<TransfEditable>) => setTransfs(transfs.map((x, j) => (j === i ? { ...x, ...c } : x)));

  async function guardar() {
    setConfirmando(false);
    const r = await op.ejecutar(
      () => api<{ numero: number; advertencias: string[] }>('/tesoreria/ingresos', {
        metodo: 'POST',
        body: {
          fecha, cajaId, origen, terceroId: origen === 'CLIENTE' ? terceroId : null, cuentaContableId: origen === 'OTRO' ? cuentaContableId : null, concepto,
          efectivo: efectivo ? { importe: numero(efectivo) } : null,
          cheques: cheques.map((c) => ({ ...c, libradorCuit: c.libradorCuit || null, importe: numero(c.importe) })),
          transferencias: transfs.map((t) => ({ ...t, referencia: t.referencia || null, importe: numero(t.importe) })),
        },
      }),
      (x) => `Ingreso ${x.numero} registrado${x.advertencias.length ? ` (${x.advertencias.join('; ')})` : ''}`,
    );
    if (r) {
      setEfectivo('');
      setCheques([]);
      setTransfs([]);
    }
  }

  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Ingreso de valores</Title>
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Caja" w={320} data={opcionesCajas(cajas)} value={cajaId} onChange={setCajaId} />
          <Select label="Origen" w={160} allowDeselect={false} value={origen} onChange={(v) => setOrigen(v ?? 'CLIENTE')} data={[{ value: 'CLIENTE', label: 'Cobro a cliente' }, { value: 'OTRO', label: 'Otro ingreso' }]} />
          {origen === 'CLIENTE'
            ? <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId} onChange={setTerceroId} />
            : <Select label="Cuenta contable" w={300} searchable data={imputables} value={cuentaContableId} onChange={setCuentaContableId} />}
          <TextInput label="Concepto" w={260} value={concepto} onChange={(e) => setConcepto(e.currentTarget.value)} />
        </Group>

        <Title order={5} mt="lg">Efectivo</Title>
        <TextInput label={`Importe en efectivo (${moneda})`} w={220} inputMode="decimal" value={efectivo} onChange={(e) => setEfectivo(e.currentTarget.value)} />

        <Group justify="space-between" mt="lg"><Title order={5}>Cheques</Title>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setCheques([...cheques, chequeVacio()])}>Agregar cheque</Button></Group>
        {!!cheques.length && (
          <ScrollArea>
            <Table withTableBorder miw={1000} mt="xs">
              <Table.Thead><Table.Tr><Table.Th>Tipo</Table.Th><Table.Th>Banco</Table.Th><Table.Th>Número</Table.Th><Table.Th>Librador</Table.Th><Table.Th>CUIT</Table.Th><Table.Th>Emisión</Table.Th><Table.Th>Pago</Table.Th><Table.Th>Importe</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {cheques.map((c, i) => (
                  <Table.Tr key={i}>
                    <Table.Td><Select size="xs" w={100} aria-label="Tipo de cheque" allowDeselect={false} value={c.tipo} data={[{ value: 'FISICO', label: 'Físico' }, { value: 'ECHEQ', label: 'E-cheq' }]} onChange={(v) => cambiarCheque(i, { tipo: v ?? 'FISICO' })} /></Table.Td>
                    <Table.Td><TextInput size="xs" aria-label="Banco del cheque" value={c.banco} onChange={(e) => cambiarCheque(i, { banco: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><TextInput size="xs" aria-label="Número del cheque" value={c.numero} onChange={(e) => cambiarCheque(i, { numero: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><TextInput size="xs" aria-label="Librador" value={c.libradorNombre} onChange={(e) => cambiarCheque(i, { libradorNombre: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><TextInput size="xs" aria-label="CUIT del librador" value={c.libradorCuit} onChange={(e) => cambiarCheque(i, { libradorCuit: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><TextInput size="xs" type="date" aria-label="Fecha de emisión" value={c.fechaEmision} onChange={(e) => cambiarCheque(i, { fechaEmision: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><TextInput size="xs" type="date" aria-label="Fecha de pago" value={c.fechaPago} onChange={(e) => cambiarCheque(i, { fechaPago: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><TextInput size="xs" aria-label="Importe del cheque" inputMode="decimal" value={c.importe} onChange={(e) => cambiarCheque(i, { importe: e.currentTarget.value })} /></Table.Td>
                    <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar cheque" onClick={() => setCheques(cheques.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}

        <Group justify="space-between" mt="lg"><Title order={5}>Transferencias recibidas</Title>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setTransfs([...transfs, { cuentaBancariaId: null, fecha, referencia: '', importe: '' }])}>Agregar transferencia</Button></Group>
        {transfs.map((t, i) => (
          <Group key={i} mt="xs" align="flex-end">
            <Select size="xs" w={300} aria-label="Cuenta bancaria de la transferencia" data={opcionesCuentas(cuentas)} value={t.cuentaBancariaId} onChange={(v) => cambiarTransf(i, { cuentaBancariaId: v })} />
            <TextInput size="xs" type="date" aria-label="Fecha de la transferencia" value={t.fecha} onChange={(e) => cambiarTransf(i, { fecha: e.currentTarget.value })} />
            <TextInput size="xs" aria-label="Referencia de la transferencia" placeholder="Referencia" value={t.referencia} onChange={(e) => cambiarTransf(i, { referencia: e.currentTarget.value })} />
            <TextInput size="xs" aria-label="Importe de la transferencia" inputMode="decimal" value={t.importe} onChange={(e) => cambiarTransf(i, { importe: e.currentTarget.value })} />
            <ActionIcon variant="subtle" color="red" aria-label="Quitar transferencia" onClick={() => setTransfs(transfs.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
          </Group>
        ))}

        <Group justify="space-between" mt="lg">
          <Text fw={700} data-testid="total-ingreso">Total {formatoMoneda(total, moneda)}</Text>
          <Button loading={op.enviando} disabled={!cajaId || total <= 0} onClick={() => (vencidos.length ? setConfirmando(true) : void guardar())}>Registrar ingreso</Button>
        </Group>
        {op.alerta}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Últimos ingresos</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Número</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Concepto</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(ingresos.data?.items ?? []).map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>{i.numero}</Table.Td><Table.Td>{formatoFecha(i.fecha)}</Table.Td><Table.Td>{i.concepto}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(totalIngreso(i))}</Table.Td><Table.Td>{i.estado === 'ANULADO' ? 'Anulado' : 'Confirmado'}</Table.Td>
                <Table.Td>{puede('tesoreria.anular') && i.estado !== 'ANULADO' && <Button size="compact-xs" variant="subtle" color="red" onClick={() => setAnulando(i)}>Anular</Button>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Modal opened={confirmando} onClose={() => setConfirmando(false)} title="Cheques vencidos">
        <Alert color="yellow">{vencidos.map((c) => `El cheque ${c.numero} está vencido para depositar`).join('. ')}.</Alert>
        <Group justify="flex-end" mt="md"><Button variant="default" onClick={() => setConfirmando(false)}>Revisar</Button><Button onClick={() => void guardar()}>Registrar igual</Button></Group>
      </Modal>
      <Modal opened={!!anulando} onClose={() => setAnulando(null)} title={`Anular ingreso ${anulando?.numero ?? ''}`}>
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end" mt="md">
          <Button color="red" disabled={!motivo.trim()} onClick={async () => {
            if (await op.ejecutar(() => api(`/tesoreria/ingresos/${anulando!.id}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Ingreso anulado')) setAnulando(null);
          }}>Anular</Button>
        </Group>
        {op.alerta}
      </Modal>
    </Stack>
  );
}
