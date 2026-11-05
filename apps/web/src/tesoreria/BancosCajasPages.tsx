import { Button, Group, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useCuentasImputables } from '../abm/opciones';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, numero, opcionesCajas, opcionesCuentas, useCajas, useCuentasBancarias, useOperacion } from './comun';

interface Fila { id: string; numero: number; fecha: string; concepto?: string | null; importe?: string; tipo?: string }

function Listado<T extends Fila>({ ruta, titulo, columnas, query }: { ruta: string; titulo: string; columnas: { titulo: string; valor: (f: T) => React.ReactNode; derecha?: boolean }[]; query?: Record<string, string | undefined> }) {
  const q = useQuery({ queryKey: [ruta, query], queryFn: () => api<{ items: T[] }>(ruta, { query: { porPagina: 50, ...query } }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={4} mb="sm">{titulo}</Title>
      {errorConsulta(q.error)}
      <ScrollArea>
        <Table withTableBorder striped miw={600}>
          <Table.Thead><Table.Tr>{columnas.map((c) => <Table.Th key={c.titulo} ta={c.derecha ? 'right' : undefined}>{c.titulo}</Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>
            {(q.data?.items ?? []).map((f) => <Table.Tr key={f.id}>{columnas.map((c) => <Table.Td key={c.titulo} ta={c.derecha ? 'right' : undefined}>{c.valor(f)}</Table.Td>)}</Table.Tr>)}
            {!q.data?.items.length && <Table.Tr><Table.Td colSpan={columnas.length}><Text c="dimmed" size="sm" ta="center">Sin registros</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

export function MovimientosBancariosPage() {
  const cuentas = useCuentasBancarias();
  const imputables = useCuentasImputables();
  const [fecha, setFecha] = useState(hoy());
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [tipo, setTipo] = useState('GASTO');
  const [contable, setContable] = useState<string | null>(null);
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const op = useOperacion();
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Movimientos bancarios</Title>
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Cuenta bancaria" w={300} data={opcionesCuentas(cuentas)} value={cuentaId} onChange={setCuentaId} />
          <SegmentedControl value={tipo} onChange={setTipo} data={[{ value: 'GASTO', label: 'Gasto / débito' }, { value: 'INGRESO', label: 'Ingreso / crédito' }]} />
          <Select label="Cuenta contable" w={300} searchable data={imputables} value={contable} onChange={setContable} />
          <TextInput label="Concepto" w={240} value={concepto} onChange={(e) => setConcepto(e.currentTarget.value)} />
          <TextInput label="Importe" w={140} inputMode="decimal" value={importe} onChange={(e) => setImporte(e.currentTarget.value)} />
        </Group>
        <Group justify="flex-end" mt="md">
          <Button loading={op.enviando} disabled={!cuentaId || !contable || !concepto.trim() || !importe} onClick={async () => {
            if (await op.ejecutar(() => api<{ numero: number }>('/tesoreria/movimientos-bancarios', { metodo: 'POST', body: { fecha, cuentaBancariaId: cuentaId, tipo, cuentaContableId: contable, concepto, importe: numero(importe) } }), (m) => `Movimiento ${m.numero} registrado`)) {
              setConcepto(''); setImporte('');
            }
          }}>Registrar</Button>
        </Group>
        {op.alerta}
      </Paper>
      <Listado<Fila> ruta="/tesoreria/movimientos-bancarios" titulo="Últimos movimientos" columnas={[
        { titulo: 'Número', valor: (f) => f.numero }, { titulo: 'Fecha', valor: (f) => formatoFecha(f.fecha) }, { titulo: 'Tipo', valor: (f) => (f.tipo === 'GASTO' ? 'Gasto' : 'Ingreso') },
        { titulo: 'Concepto', valor: (f) => f.concepto }, { titulo: 'Importe', valor: (f) => formatoMoneda(f.importe), derecha: true },
      ]} />
    </Stack>
  );
}

type Extremo = { tipo: 'BANCO' | 'CAJA'; id: string | null };
function SelectorExtremo({ etiqueta, valor, onChange }: { etiqueta: string; valor: Extremo; onChange: (e: Extremo) => void }) {
  const cuentas = useCuentasBancarias();
  const cajas = useCajas();
  return (
    <Group align="flex-end" gap="xs">
      <SegmentedControl value={valor.tipo} onChange={(t) => onChange({ tipo: t as Extremo['tipo'], id: null })} data={[{ value: 'BANCO', label: 'Banco' }, { value: 'CAJA', label: 'Caja' }]} />
      <Select label={etiqueta} w={300} value={valor.id} onChange={(id) => onChange({ ...valor, id })} data={valor.tipo === 'BANCO' ? opcionesCuentas(cuentas) : opcionesCajas(cajas)} />
    </Group>
  );
}

export function TransferenciasInternasPage() {
  const [fecha, setFecha] = useState(hoy());
  const [origen, setOrigen] = useState<Extremo>({ tipo: 'BANCO', id: null });
  const [destino, setDestino] = useState<Extremo>({ tipo: 'BANCO', id: null });
  const [importeOrigen, setImporteOrigen] = useState('');
  const [importeDestino, setImporteDestino] = useState('');
  const [concepto, setConcepto] = useState('');
  const op = useOperacion();
  const ref = (e: Extremo) => (e.tipo === 'BANCO' ? { cuentaBancariaId: e.id } : { cajaId: e.id });
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Transferencias entre cuentas</Title>
        <Stack gap="sm">
          <TextInput label="Fecha" type="date" w={200} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Group align="flex-end"><SelectorExtremo etiqueta="Origen" valor={origen} onChange={setOrigen} />
            <TextInput label="Importe que sale" w={160} inputMode="decimal" value={importeOrigen} onChange={(e) => { setImporteOrigen(e.currentTarget.value); if (!importeDestino) setImporteDestino(e.currentTarget.value); }} /></Group>
          <Group align="flex-end"><SelectorExtremo etiqueta="Destino" valor={destino} onChange={setDestino} />
            <TextInput label="Importe que entra" w={160} inputMode="decimal" value={importeDestino} onChange={(e) => setImporteDestino(e.currentTarget.value)} /></Group>
          <TextInput label="Concepto" w={400} value={concepto} onChange={(e) => setConcepto(e.currentTarget.value)} />
          <Text size="xs" c="dimmed">Entre monedas distintas, la diferencia contra la cotización del día va a diferencia de cambio.</Text>
        </Stack>
        <Group justify="flex-end" mt="md">
          <Button loading={op.enviando} disabled={!origen.id || !destino.id || !importeOrigen || !importeDestino} onClick={async () => {
            if (await op.ejecutar(() => api<{ numero: number }>('/tesoreria/transferencias-internas', {
              metodo: 'POST', body: { fecha, origen: ref(origen), destino: ref(destino), importeOrigen: numero(importeOrigen), importeDestino: numero(importeDestino), concepto: concepto || null },
            }), (t) => `Transferencia ${t.numero} registrada`)) { setImporteOrigen(''); setImporteDestino(''); }
          }}>Transferir</Button>
        </Group>
        {op.alerta}
      </Paper>
      <Listado<Fila & { monedaOrigen: string; monedaDestino: string; importeOrigen: string; importeDestino: string }> ruta="/tesoreria/transferencias-internas" titulo="Últimas transferencias" columnas={[
        { titulo: 'Número', valor: (f) => f.numero }, { titulo: 'Fecha', valor: (f) => formatoFecha(f.fecha) }, { titulo: 'Concepto', valor: (f) => f.concepto ?? '' },
        { titulo: 'Sale', valor: (f) => formatoMoneda(f.importeOrigen, f.monedaOrigen), derecha: true }, { titulo: 'Entra', valor: (f) => formatoMoneda(f.importeDestino, f.monedaDestino), derecha: true },
      ]} />
    </Stack>
  );
}

export function MovimientosCajaPage() {
  const cajas = useCajas();
  const imputables = useCuentasImputables();
  const [fecha, setFecha] = useState(hoy());
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [tipo, setTipo] = useState('EGRESO');
  const [contable, setContable] = useState<string | null>(null);
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const op = useOperacion();
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Movimientos de caja</Title>
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Caja" w={300} data={opcionesCajas(cajas)} value={cajaId} onChange={setCajaId} />
          <SegmentedControl value={tipo} onChange={setTipo} data={[{ value: 'EGRESO', label: 'Egreso' }, { value: 'INGRESO', label: 'Ingreso' }]} />
          <Select label="Cuenta contable" w={300} searchable data={imputables} value={contable} onChange={setContable} />
          <TextInput label="Concepto" w={240} value={concepto} onChange={(e) => setConcepto(e.currentTarget.value)} />
          <TextInput label="Importe" w={140} inputMode="decimal" value={importe} onChange={(e) => setImporte(e.currentTarget.value)} />
        </Group>
        <Group justify="flex-end" mt="md">
          <Button loading={op.enviando} disabled={!cajaId || !contable || !concepto.trim() || !importe} onClick={async () => {
            if (await op.ejecutar(() => api<{ numero: number }>('/tesoreria/movimientos-caja', { metodo: 'POST', body: { fecha, cajaId, tipo, cuentaContableId: contable, concepto, importe: numero(importe) } }), (m) => `Movimiento ${m.numero} registrado`)) {
              setConcepto(''); setImporte('');
            }
          }}>Registrar</Button>
        </Group>
        {op.alerta}
      </Paper>
      <Listado<Fila> ruta="/tesoreria/movimientos-caja" titulo="Últimos movimientos de caja" columnas={[
        { titulo: 'Número', valor: (f) => f.numero }, { titulo: 'Fecha', valor: (f) => formatoFecha(f.fecha) }, { titulo: 'Tipo', valor: (f) => (f.tipo === 'EGRESO' ? 'Egreso' : 'Ingreso') },
        { titulo: 'Concepto', valor: (f) => f.concepto }, { titulo: 'Importe', valor: (f) => formatoMoneda(f.importe), derecha: true },
      ]} />
    </Stack>
  );
}

interface Saldos { cajas: { id: string; efectivo: string; monedaCodigo: string }[] }

export function ArqueoPage() {
  const cajas = useCajas();
  const [fecha, setFecha] = useState(hoy());
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [contado, setContado] = useState('');
  const [motivo, setMotivo] = useState('');
  const op = useOperacion();
  const saldos = useQuery({ queryKey: ['/tesoreria/saldos', fecha], queryFn: () => api<Saldos>('/tesoreria/saldos', { query: { fecha } }), enabled: !!cajaId });
  const caja = saldos.data?.cajas.find((c) => c.id === cajaId);
  const diferencia = caja && contado ? Math.round((numero(contado) - Number(caja.efectivo)) * 100) / 100 : 0;
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Arqueo de caja</Title>
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Caja" w={300} data={opcionesCajas(cajas)} value={cajaId} onChange={setCajaId} />
          <TextInput label="Efectivo contado" w={160} inputMode="decimal" value={contado} onChange={(e) => setContado(e.currentTarget.value)} />
          <TextInput label="Motivo de la diferencia" w={300} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        </Group>
        {caja && (
          <Group mt="md" gap="xl">
            <Text>Saldo según sistema: <b>{formatoMoneda(caja.efectivo, caja.monedaCodigo)}</b></Text>
            {!!contado && <Text c={diferencia < 0 ? 'red' : diferencia > 0 ? 'green' : undefined}>Diferencia: <b>{formatoMoneda(diferencia, caja.monedaCodigo)}</b> {diferencia < 0 ? '(faltante)' : diferencia > 0 ? '(sobrante)' : ''}</Text>}
          </Group>
        )}
        <Group justify="flex-end" mt="md">
          <Button loading={op.enviando} disabled={!cajaId || contado === '' || (diferencia !== 0 && !motivo.trim())} onClick={async () => {
            if (await op.ejecutar(() => api<{ numero: number }>('/tesoreria/arqueos', { metodo: 'POST', body: { fecha, cajaId, contado: numero(contado), motivo: motivo || null } }), (a) => `Arqueo ${a.numero} registrado`)) {
              setContado(''); setMotivo('');
            }
          }}>Registrar arqueo</Button>
        </Group>
        {op.alerta}
      </Paper>
      <Listado<Fila & { saldoSistema: string; contado: string; diferencia: string; motivo: string | null }> ruta="/tesoreria/arqueos" titulo="Arqueos" query={{ cajaId: cajaId ?? undefined }} columnas={[
        { titulo: 'Número', valor: (f) => f.numero }, { titulo: 'Fecha', valor: (f) => formatoFecha(f.fecha) },
        { titulo: 'Sistema', valor: (f) => formatoMoneda(f.saldoSistema), derecha: true }, { titulo: 'Contado', valor: (f) => formatoMoneda(f.contado), derecha: true },
        { titulo: 'Diferencia', valor: (f) => formatoMoneda(f.diferencia), derecha: true }, { titulo: 'Motivo', valor: (f) => f.motivo ?? '' },
      ]} />
    </Stack>
  );
}
