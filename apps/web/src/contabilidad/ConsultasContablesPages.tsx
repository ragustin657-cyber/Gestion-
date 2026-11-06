import { Anchor, Badge, Button, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { FiltroFechas, finDelMes, primeroDelMes } from '../compras/consultas/comun';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { ORIGENES, TIPOS_ASIENTO } from './asiento';
import { useCentrosCosto, useEjercicios, useTodasLasCuentas } from './comun';
import { AsientoVista, DetalleAsiento, numeroAsiento } from './DetalleAsiento';

function Exportar({ ruta, query, nombre }: { ruta: string; query: Record<string, string | undefined>; nombre: string }) {
  return (
    <Group gap="xs">
      <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar(ruta, { ...query, formato: 'xlsx' }, `${nombre}.xlsx`)}>Excel</Button>
      <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar(ruta, { ...query, formato: 'pdf' }, `${nombre}.pdf`)}>PDF</Button>
    </Group>
  );
}

export function DiarioPage() {
  const { puede } = useAuth();
  const navegar = useNavigate();
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(finDelMes());
  const [origen, setOrigen] = useState<string | null>(null);
  const [pagina] = useState(1);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<AsientoVista | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const query = { desde, hasta, origenTipo: origen ?? undefined, pagina: String(pagina), porPagina: '200' };
  const q = useQuery({ queryKey: ['/contabilidad/diario', query], queryFn: () => api<{ items: AsientoVista[]; total: number; totales: { debe: string; haber: string } }>('/contabilidad/diario', { query }) });
  const op = useOperacion();
  const manual = (a: AsientoVista) => a.tipo === 'MANUAL' && !a.anulaAId && puede('asiento.registrar');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md"><Title order={3}>Libro Diario</Title><Exportar ruta="/contabilidad/diario" query={{ desde, hasta, origenTipo: origen ?? undefined }} nombre="libro-diario" /></Group>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <Select label="Origen" clearable w={220} data={ORIGENES} value={origen} onChange={setOrigen} />
      </FiltroFechas>
      {errorConsulta(q.error)}
      {op.alerta}
      <ScrollArea mt="md">
        <Table withTableBorder miw={900}>
          <Table.Thead><Table.Tr><Table.Th>Asiento</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Cuenta / descripción</Table.Th><Table.Th ta="right">Debe</Table.Th><Table.Th ta="right">Haber</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(q.data?.items ?? []).flatMap((a) => [
              <Table.Tr key={a.id} bg="gray.0" style={{ cursor: 'pointer' }} onClick={() => setDetalle(a.id)}>
                <Table.Td><Text size="sm" fw={600}>{numeroAsiento(a)}</Text></Table.Td><Table.Td>{formatoFecha(a.fecha)}</Table.Td>
                <Table.Td><Text size="sm" fw={600}>{a.descripcion}</Text><Group gap={4}><Badge size="xs" variant="light">{TIPOS_ASIENTO[a.tipo]}</Badge>
                  {a.origen.ruta && a.tipo !== 'MANUAL' && <Anchor size="xs" component={Link} to={a.origen.ruta} onClick={(e) => e.stopPropagation()}>Ver comprobante</Anchor>}</Group></Table.Td>
                <Table.Td /><Table.Td />
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  {manual(a) && (
                    <Group gap={4} wrap="nowrap">
                      {!a.numeroDefinitivo && <Button size="compact-xs" variant="subtle" onClick={() => navegar(`/contabilidad/asiento?id=${a.id}`)}>Modificar</Button>}
                      {!a.numeroDefinitivo && <Button size="compact-xs" variant="subtle" color="red" onClick={async () => { if (await op.ejecutar(() => api(`/contabilidad/asientos/${a.id}`, { metodo: 'DELETE' }), () => 'Asiento eliminado')) void q.refetch(); }}>Eliminar</Button>}
                      <Button size="compact-xs" variant="subtle" color="orange" onClick={() => { setMotivo(''); setAnulando(a); }}>Anular</Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>,
              ...a.renglones.map((r, i) => (
                <Table.Tr key={`${a.id}-${i}`}>
                  <Table.Td /><Table.Td /><Table.Td><Text size="sm" pl={r.haber !== '0' ? 'lg' : 0}>{r.cuenta.codigo} {r.cuenta.nombre}{r.detalle ? ` · ${r.detalle}` : ''}</Text></Table.Td>
                  <Table.Td ta="right">{r.debe !== '0' ? formatoMoneda(r.debe) : ''}</Table.Td><Table.Td ta="right">{r.haber !== '0' ? formatoMoneda(r.haber) : ''}</Table.Td><Table.Td />
                </Table.Tr>
              )),
            ])}
          </Table.Tbody>
          {q.data && <Table.Tfoot><Table.Tr><Table.Th colSpan={3}>Totales ({q.data.total} asientos)</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.totales.debe)}</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.totales.haber)}</Table.Th><Table.Th /></Table.Tr></Table.Tfoot>}
        </Table>
      </ScrollArea>
      <DetalleAsiento id={detalle} onCerrar={() => setDetalle(null)} />
      <Modal opened={!!anulando} onClose={() => setAnulando(null)} title="Anular asiento">
        <Stack>
          <TextInput label="Fecha del contraasiento" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <Group justify="flex-end"><Button color="orange" disabled={!motivo.trim()} onClick={async () => { if (await op.ejecutar(() => api(`/contabilidad/asientos/${anulando!.id}/anular`, { metodo: 'POST', body: { fecha, motivo } }), () => 'Asiento anulado')) { setAnulando(null); void q.refetch(); } }}>Anular</Button></Group>
          {op.alerta}
        </Stack>
      </Modal>
    </Paper>
  );
}

interface Mayor { cuenta: { codigo: string; nombre: string }; saldoInicial: string; saldoFinal: string; movimientos: { fecha: string; asientoId: string; numero: number; definitivo: boolean; descripcion: string; debe: string; haber: string; saldo: string }[] }

export function MayorPage() {
  const cuentas = useTodasLasCuentas();
  const centros = useCentrosCosto();
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [cc, setCc] = useState<string | null>(null);
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(finDelMes());
  const [detalle, setDetalle] = useState<string | null>(null);
  const query = { cuentaContableId: cuenta ?? undefined, desde, hasta, centroCostoId: cc ?? undefined };
  const q = useQuery({ queryKey: ['/contabilidad/mayor', query], queryFn: () => api<Mayor>('/contabilidad/mayor', { query }), enabled: !!cuenta });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md"><Title order={3}>Mayor</Title>{cuenta && <Exportar ruta="/contabilidad/mayor" query={query} nombre="mayor" />}</Group>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <Select label="Cuenta" searchable w={360} data={cuentas} value={cuenta} onChange={setCuenta} />
        <Select label="Centro de costo" clearable w={200} data={centros} value={cc} onChange={setCc} />
      </FiltroFechas>
      {errorConsulta(q.error)}
      {q.data && (
        <ScrollArea mt="md">
          <Table withTableBorder striped miw={760}>
            <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Asiento</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Debe</Table.Th><Table.Th ta="right">Haber</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              <Table.Tr><Table.Td /><Table.Td /><Table.Td fw={600}>Saldo inicial</Table.Td><Table.Td /><Table.Td /><Table.Td ta="right">{formatoMoneda(q.data.saldoInicial)}</Table.Td></Table.Tr>
              {q.data.movimientos.map((m, i) => (
                <Table.Tr key={i} style={{ cursor: 'pointer' }} onClick={() => setDetalle(m.asientoId)}>
                  <Table.Td>{formatoFecha(m.fecha)}</Table.Td><Table.Td>{m.definitivo ? m.numero : `(${m.numero})`}</Table.Td><Table.Td>{m.descripcion}</Table.Td>
                  <Table.Td ta="right">{m.debe !== '0' ? formatoMoneda(m.debe) : ''}</Table.Td><Table.Td ta="right">{m.haber !== '0' ? formatoMoneda(m.haber) : ''}</Table.Td><Table.Td ta="right">{formatoMoneda(m.saldo)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot><Table.Tr><Table.Th colSpan={5}>Saldo final</Table.Th><Table.Th ta="right" data-testid="saldo-mayor">{formatoMoneda(q.data.saldoFinal)}</Table.Th></Table.Tr></Table.Tfoot>
          </Table>
        </ScrollArea>
      )}
      <DetalleAsiento id={detalle} onCerrar={() => setDetalle(null)} />
    </Paper>
  );
}

interface FilaSS { cuentaId: string; codigo: string; nombre: string; nivel: number; imputable: boolean; debe: string; haber: string; saldoDeudor: string; saldoAcreedor: string }

export function SumasSaldosPage() {
  const ejercicios = useEjercicios();
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [nivel, setNivel] = useState<string | null>('4');
  const query = { ejercicioId: ejercicioId ?? undefined, desde: desde || undefined, hasta: hasta || undefined, nivel: nivel ?? undefined };
  const q = useQuery({ queryKey: ['/contabilidad/sumas-saldos', query], queryFn: () => api<{ filas: FilaSS[]; totales: Record<string, string> }>('/contabilidad/sumas-saldos', { query }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md"><Title order={3}>Balance de sumas y saldos</Title><Exportar ruta="/contabilidad/sumas-saldos" query={query} nombre="sumas-y-saldos" /></Group>
      <Group align="flex-end" wrap="wrap">
        <Select label="Ejercicio" w={180} clearable value={ejercicioId} onChange={setEjercicioId} data={(ejercicios.data ?? []).map((e) => ({ value: e.id, label: `Ejercicio ${e.numero}` }))} />
        <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <Select label="Nivel" w={100} value={nivel} onChange={setNivel} data={['1', '2', '3', '4', '5']} />
      </Group>
      {errorConsulta(q.error)}
      <ScrollArea mt="md">
        <Table withTableBorder striped miw={760}>
          <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th ta="right">Debe</Table.Th><Table.Th ta="right">Haber</Table.Th><Table.Th ta="right">Saldo deudor</Table.Th><Table.Th ta="right">Saldo acreedor</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(q.data?.filas ?? []).map((f) => (
              <Table.Tr key={f.cuentaId}>
                <Table.Td><Text size="sm" pl={(f.nivel - 1) * 12} fw={f.imputable ? 400 : 700}>{f.codigo} {f.nombre}</Text></Table.Td>
                <Table.Td ta="right">{formatoMoneda(f.debe)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.haber)}</Table.Td>
                <Table.Td ta="right">{f.saldoDeudor !== '0' ? formatoMoneda(f.saldoDeudor) : ''}</Table.Td><Table.Td ta="right">{f.saldoAcreedor !== '0' ? formatoMoneda(f.saldoAcreedor) : ''}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          {q.data && <Table.Tfoot><Table.Tr><Table.Th>Totales</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.totales.debe)}</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.totales.haber)}</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.totales.saldoDeudor)}</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.totales.saldoAcreedor)}</Table.Th></Table.Tr></Table.Tfoot>}
        </Table>
      </ScrollArea>
    </Paper>
  );
}
