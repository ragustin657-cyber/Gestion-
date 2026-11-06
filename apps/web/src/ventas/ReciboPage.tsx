import { ActionIcon, Alert, Button, Group, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { opcionesCajas, opcionesCuentas, useCajas, useCuentasBancarias } from '../tesoreria/comun';
import { numero, numeroVenta, useClientes, useOperacionVentas, usePuntosVenta, type MovPendiente } from './comun';

interface ChequeEditable { tipo: string; banco: string; numero: string; libradorNombre: string; libradorCuit: string; fechaEmision: string; fechaPago: string; importe: string }
interface TransfEditable { cuentaBancariaId: string | null; fecha: string; referencia: string; importe: string }
interface RetencionEditable { tipo: string; jurisdiccion: string; numeroCertificado: string; fecha: string; importe: string }
const TIPOS_RETENCION = [{ value: 'IIBB', label: 'IIBB' }, { value: 'GANANCIAS', label: 'Ganancias' }, { value: 'IVA', label: 'IVA' }, { value: 'SUSS', label: 'SUSS' }];
const n0 = (s: string) => (Number.isFinite(numero(s)) ? numero(s) : 0);

/** Reparte un total entre los pendientes, del vencimiento más viejo al más nuevo (solo pesos). */
export function repartir(total: number, pendientes: { id: string; saldo: number }[]): Record<string, string> {
  let resto = Math.round(total * 100);
  const r: Record<string, string> = {};
  for (const p of pendientes) {
    const usar = Math.min(resto, Math.round(p.saldo * 100));
    if (usar > 0) r[p.id] = (usar / 100).toFixed(2).replace('.', ',');
    resto -= usar;
  }
  return r;
}

export function ReciboPage() {
  const clientes = useClientes();
  const puntos = usePuntosVenta();
  const cajas = useCajas().filter((c) => c.monedaCodigo === 'ARS');
  const cuentas = useCuentasBancarias();
  const op = useOperacionVentas();
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [puntoVentaId, setPuntoVentaId] = useState<string | null>(null);
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [efectivo, setEfectivo] = useState('');
  const [cheques, setCheques] = useState<ChequeEditable[]>([]);
  const [transfs, setTransfs] = useState<TransfEditable[]>([]);
  const [retenciones, setRetenciones] = useState<RetencionEditable[]>([]);
  const [aplicar, setAplicar] = useState<Record<string, string>>({});
  const [ultimo, setUltimo] = useState<{ numero: number; puntoVenta: number } | null>(null);

  const pendientes = useQuery({
    queryKey: ['/ventas/clientes/pendientes', terceroId],
    queryFn: () => api<{ creditos: MovPendiente[]; debitos: MovPendiente[] }>(`/ventas/clientes/${terceroId}/pendientes`),
    enabled: !!terceroId,
  }).data;
  const debitos = (pendientes?.debitos ?? []).filter((d) => d.origenTipo === 'VENTA');
  const total = n0(efectivo) + cheques.reduce((s, c) => s + n0(c.importe), 0) + transfs.reduce((s, t) => s + n0(t.importe), 0) + retenciones.reduce((s, r) => s + n0(r.importe), 0);
  const aplicado = Object.values(aplicar).reduce((s, v) => s + n0(v), 0);
  const cambiar = <T,>(xs: T[], set: (v: T[]) => void, i: number, c: Partial<T>) => set(xs.map((x, j) => (j === i ? { ...x, ...c } : x)));

  async function confirmar() {
    const r = await op.ejecutar(() => api<{ id: string; numero: number; puntoVenta: number; advertencias: string[] }>('/ventas/recibos', {
      metodo: 'POST',
      body: {
        terceroId, fecha, puntoVentaId, cajaId,
        efectivo: efectivo ? { importe: numero(efectivo) } : null,
        cheques: cheques.map((c) => ({ ...c, libradorCuit: c.libradorCuit || null, importe: numero(c.importe) })),
        transferencias: transfs.map((t) => ({ ...t, referencia: t.referencia || null, importe: numero(t.importe) })),
        retenciones: retenciones.map((r) => ({ ...r, jurisdiccion: r.tipo === 'IIBB' ? r.jurisdiccion : null, importe: numero(r.importe) })),
        aplicaciones: Object.entries(aplicar).filter(([, v]) => n0(v) > 0).map(([id, v]) => ({ comprobanteId: debitos.find((d) => d.id === id)!.origenId, importe: numero(v) })),
      },
    }), (x) => `Recibo ${numeroVenta(x.puntoVenta, x.numero)} registrado${x.advertencias.length ? ` (${x.advertencias.join('; ')})` : ''}`);
    if (r) {
      setUltimo(r);
      setEfectivo(''); setCheques([]); setTransfs([]); setRetenciones([]); setAplicar({});
    }
  }

  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Recibo</Title>
        <Group align="flex-end" wrap="wrap">
          <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId} onChange={(v) => { setTerceroId(v); setAplicar({}); }} />
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Punto de venta" w={150} data={puntos.map((p) => ({ value: p.id, label: String(p.numero).padStart(4, '0') }))} value={puntoVentaId} onChange={setPuntoVentaId} />
          <Select label="Caja" w={300} data={opcionesCajas(cajas)} value={cajaId} onChange={setCajaId} />
        </Group>

        <Title order={5} mt="lg">Valores</Title>
        <TextInput label="Efectivo" w={200} inputMode="decimal" value={efectivo} onChange={(e) => setEfectivo(e.currentTarget.value)} />
        <Group justify="space-between" mt="sm"><Text fw={500}>Cheques</Text>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setCheques([...cheques, { tipo: 'FISICO', banco: '', numero: '', libradorNombre: '', libradorCuit: '', fechaEmision: fecha, fechaPago: fecha, importe: '' }])}>Agregar cheque</Button></Group>
        {!!cheques.length && (
          <ScrollArea><Table withTableBorder miw={950} mt="xs">
            <Table.Thead><Table.Tr><Table.Th>Tipo</Table.Th><Table.Th>Banco</Table.Th><Table.Th>Número</Table.Th><Table.Th>Librador</Table.Th><Table.Th>Emisión</Table.Th><Table.Th>Pago</Table.Th><Table.Th>Importe</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>{cheques.map((c, i) => (
              <Table.Tr key={i}>
                <Table.Td><Select size="xs" w={100} aria-label="Tipo de cheque" allowDeselect={false} value={c.tipo} data={[{ value: 'FISICO', label: 'Físico' }, { value: 'ECHEQ', label: 'E-cheq' }]} onChange={(v) => cambiar(cheques, setCheques, i, { tipo: v ?? 'FISICO' })} /></Table.Td>
                <Table.Td><TextInput size="xs" aria-label="Banco del cheque" value={c.banco} onChange={(e) => cambiar(cheques, setCheques, i, { banco: e.currentTarget.value })} /></Table.Td>
                <Table.Td><TextInput size="xs" aria-label="Número del cheque" value={c.numero} onChange={(e) => cambiar(cheques, setCheques, i, { numero: e.currentTarget.value })} /></Table.Td>
                <Table.Td><TextInput size="xs" aria-label="Librador" value={c.libradorNombre} onChange={(e) => cambiar(cheques, setCheques, i, { libradorNombre: e.currentTarget.value })} /></Table.Td>
                <Table.Td><TextInput size="xs" type="date" aria-label="Fecha de emisión" value={c.fechaEmision} onChange={(e) => cambiar(cheques, setCheques, i, { fechaEmision: e.currentTarget.value })} /></Table.Td>
                <Table.Td><TextInput size="xs" type="date" aria-label="Fecha de pago" value={c.fechaPago} onChange={(e) => cambiar(cheques, setCheques, i, { fechaPago: e.currentTarget.value })} /></Table.Td>
                <Table.Td><TextInput size="xs" aria-label="Importe del cheque" inputMode="decimal" value={c.importe} onChange={(e) => cambiar(cheques, setCheques, i, { importe: e.currentTarget.value })} /></Table.Td>
                <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar cheque" onClick={() => setCheques(cheques.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
              </Table.Tr>))}</Table.Tbody>
          </Table></ScrollArea>
        )}
        <Group justify="space-between" mt="sm"><Text fw={500}>Transferencias</Text>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setTransfs([...transfs, { cuentaBancariaId: null, fecha, referencia: '', importe: '' }])}>Agregar transferencia</Button></Group>
        {transfs.map((t, i) => (
          <Group key={i} mt="xs" align="flex-end">
            <Select size="xs" w={300} aria-label="Cuenta bancaria de la transferencia" data={opcionesCuentas(cuentas.filter((c) => c.monedaCodigo === 'ARS'))} value={t.cuentaBancariaId} onChange={(v) => cambiar(transfs, setTransfs, i, { cuentaBancariaId: v })} />
            <TextInput size="xs" type="date" aria-label="Fecha de la transferencia" value={t.fecha} onChange={(e) => cambiar(transfs, setTransfs, i, { fecha: e.currentTarget.value })} />
            <TextInput size="xs" aria-label="Referencia de la transferencia" placeholder="Referencia" value={t.referencia} onChange={(e) => cambiar(transfs, setTransfs, i, { referencia: e.currentTarget.value })} />
            <TextInput size="xs" aria-label="Importe de la transferencia" inputMode="decimal" value={t.importe} onChange={(e) => cambiar(transfs, setTransfs, i, { importe: e.currentTarget.value })} />
            <ActionIcon variant="subtle" color="red" aria-label="Quitar transferencia" onClick={() => setTransfs(transfs.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
          </Group>
        ))}

        <Group justify="space-between" mt="lg"><Title order={5}>Retenciones sufridas</Title>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setRetenciones([...retenciones, { tipo: 'IIBB', jurisdiccion: '901', numeroCertificado: '', fecha, importe: '' }])}>Agregar retención</Button></Group>
        {retenciones.map((r, i) => (
          <Group key={i} mt="xs" align="flex-end">
            <Select size="xs" w={130} aria-label="Tipo de retención" allowDeselect={false} data={TIPOS_RETENCION} value={r.tipo} onChange={(v) => cambiar(retenciones, setRetenciones, i, { tipo: v ?? 'IIBB' })} />
            {r.tipo === 'IIBB' && <TextInput size="xs" w={90} aria-label="Jurisdicción" placeholder="901" value={r.jurisdiccion} onChange={(e) => cambiar(retenciones, setRetenciones, i, { jurisdiccion: e.currentTarget.value })} />}
            <TextInput size="xs" aria-label="Número de certificado" placeholder="Certificado" value={r.numeroCertificado} onChange={(e) => cambiar(retenciones, setRetenciones, i, { numeroCertificado: e.currentTarget.value })} />
            <TextInput size="xs" type="date" aria-label="Fecha de la retención" value={r.fecha} onChange={(e) => cambiar(retenciones, setRetenciones, i, { fecha: e.currentTarget.value })} />
            <TextInput size="xs" aria-label="Importe de la retención" inputMode="decimal" value={r.importe} onChange={(e) => cambiar(retenciones, setRetenciones, i, { importe: e.currentTarget.value })} />
            <ActionIcon variant="subtle" color="red" aria-label="Quitar retención" onClick={() => setRetenciones(retenciones.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
          </Group>
        ))}

        <Group justify="space-between" mt="lg"><Title order={5}>Comprobantes a cancelar</Title>
          <Button size="xs" variant="light" disabled={!debitos.length} onClick={() => setAplicar(repartir(total, debitos.filter((d) => d.monedaCodigo === 'ARS').map((d) => ({ id: d.id, saldo: Number(d.saldo) }))))}>Aplicar automático</Button></Group>
        <Table withTableBorder mt="xs">
          <Table.Thead><Table.Tr><Table.Th>Comprobante</Table.Th><Table.Th>Vence</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th w={160}>A cancelar</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {debitos.map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>{d.descripcion}</Table.Td><Table.Td>{formatoFecha(d.fechaVencimiento)}</Table.Td><Table.Td ta="right">{formatoMoneda(d.saldo, d.monedaCodigo)}</Table.Td>
                <Table.Td><TextInput size="xs" aria-label={`A cancelar de ${d.descripcion}`} inputMode="decimal" value={aplicar[d.id] ?? ''} onChange={(e) => setAplicar({ ...aplicar, [d.id]: e.currentTarget.value })} /></Table.Td>
              </Table.Tr>
            ))}
            {!debitos.length && <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">{terceroId ? 'El cliente no tiene comprobantes pendientes' : 'Elija un cliente'}</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>

        <Group justify="space-between" mt="lg">
          <Stack gap={0}>
            <Text fw={700} data-testid="total-recibo">Total {formatoMoneda(total)}</Text>
            <Text size="sm" c="dimmed">Aplicado {formatoMoneda(aplicado)} · a cuenta {formatoMoneda(Math.max(0, total - aplicado))}</Text>
          </Stack>
          <Button loading={op.enviando} disabled={!terceroId || !puntoVentaId || !cajaId || total <= 0} onClick={() => void confirmar()}>Confirmar recibo</Button>
        </Group>
        {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
        {ultimo && <Alert color="green" mt="sm">Último recibo: {numeroVenta(ultimo.puntoVenta, ultimo.numero)}</Alert>}
      </Paper>
    </Stack>
  );
}
