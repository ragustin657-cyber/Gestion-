import { Badge, Button, Group, Modal, NumberInput, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, opcionesCajas, opcionesCuentas, useCajas, useCuentasBancarias, useOperacion } from '../tesoreria/comun';
import { FilaCargas, mesTexto } from './comun';

const DETALLE: [keyof NonNullable<FilaCargas['detalle']>, string][] = [['aportesSS', 'Aportes seguridad social'], ['aportesOS', 'Aportes obra social'], ['contribucionesSS', 'Contribuciones seguridad social'], ['contribucionesOS', 'Contribuciones obra social'], ['art', 'ART'], ['scvo', 'Seguro colectivo de vida']];

/** Deuda de sueldos del mes por cuenta, con el detalle F.931 de las cargas sociales. */
export function TablaCargasSociales({ filas, onPagar }: { filas: FilaCargas[]; onPagar?: (f: FilaCargas) => void }) {
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th ta="right">Devengado</Table.Th><Table.Th ta="right">Pagado</Table.Th><Table.Th ta="right">Pendiente</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.flatMap((f) => [
          <Table.Tr key={f.cuentaContableId} fw={600}>
            <Table.Td>{f.codigo} {f.nombre}</Table.Td><Table.Td ta="right">{formatoMoneda(f.devengado)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.pagado)}</Table.Td>
            <Table.Td ta="right" c={Number(f.pendiente) < 0 ? 'red' : undefined}>{formatoMoneda(f.pendiente)}</Table.Td>
            <Table.Td>{onPagar && Number(f.pendiente) > 0 && <Button size="compact-xs" onClick={() => onPagar(f)}>Pagar</Button>}</Table.Td>
          </Table.Tr>,
          ...(f.detalle ? DETALLE.map(([k, etiqueta]) => (
            <Table.Tr key={`${f.cuentaContableId}-${k}`}><Table.Td pl="xl"><Text size="sm" c="dimmed">{etiqueta}</Text></Table.Td><Table.Td ta="right"><Text size="sm" c="dimmed">{formatoMoneda(f.detalle![k])}</Text></Table.Td><Table.Td colSpan={3} /></Table.Tr>
          )) : []),
        ])}
      </Table.Tbody>
    </Table>
  );
}

interface PagoCargas { id: string; numero: number; fecha: string; importe: string; anulado: boolean; cuentaContableDeudaId: string }

export function CargasSocialesPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const editable = puede('sueldos.liquidar');
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [anio, nmes] = mes.split('-').map(Number);
  const filas = useQuery({ queryKey: ['/sueldos/cargas-sociales', mes], enabled: !!anio && !!nmes, queryFn: () => api<FilaCargas[]>('/sueldos/cargas-sociales', { query: { anio, mes: nmes } }) });
  const pagos = useQuery({ queryKey: ['/sueldos/cargas-sociales/pagos', mes], enabled: !!anio && !!nmes, queryFn: () => api<PagoCargas[]>('/sueldos/cargas-sociales/pagos', { query: { anio, mes: nmes } }) });
  const bancos = useCuentasBancarias().filter((c) => c.monedaCodigo === 'ARS');
  const cajas = useCajas().filter((c) => c.monedaCodigo === 'ARS');
  const [pago, setPago] = useState<{ fila: FilaCargas; importe: number; fecha: string; origen: string | null } | null>(null);
  const refrescar = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/sueldos') });
  const origenes = [...opcionesCuentas(bancos).map((o) => ({ ...o, value: `b:${o.value}` })), ...opcionesCajas(cajas).map((o) => ({ ...o, value: `c:${o.value}` }))];
  const pagar = async () => {
    if (!pago?.origen) return;
    const [t, id] = pago.origen.split(':');
    const body = { anio, mes: nmes, cuentaContableDeudaId: pago.fila.cuentaContableId, importe: pago.importe, fecha: pago.fecha, ...(t === 'b' ? { cuentaBancariaId: id } : { cajaId: id }) };
    if (await op.ejecutar(() => api('/sueldos/cargas-sociales/pagos', { metodo: 'POST', body }), () => 'Pago registrado')) { setPago(null); refrescar(); }
  };
  const nombreCuenta = (id: string) => filas.data?.find((f) => f.cuentaContableId === id)?.nombre ?? '';
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Cargas sociales y retenciones</Title>
        <TextInput type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.currentTarget.value)} />
      </Group>
      {errorConsulta(filas.error)}
      {op.alerta}
      <TablaCargasSociales filas={filas.data ?? []} onPagar={editable ? (f) => setPago({ fila: f, importe: Number(f.pendiente), fecha: hoy(), origen: null }) : undefined} />
      <Title order={5} mt="lg" mb="xs">Pagos de {mesTexto(anio, nmes)}</Title>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Cuenta</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(pagos.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.numero}</Table.Td><Table.Td>{formatoFecha(p.fecha)}</Table.Td><Table.Td>{nombreCuenta(p.cuentaContableDeudaId)}</Table.Td><Table.Td ta="right">{formatoMoneda(p.importe)}</Table.Td>
              <Table.Td>{p.anulado ? <Badge color="gray" variant="light">Anulado</Badge> : <Badge color="green" variant="light">Vigente</Badge>}</Table.Td>
              <Table.Td>{editable && !p.anulado && <Button size="compact-xs" variant="subtle" color="red" onClick={async () => { if (await op.ejecutar(() => api(`/sueldos/cargas-sociales/pagos/${p.id}/anular`, { metodo: 'POST' }), () => 'Pago anulado')) refrescar(); }}>Anular</Button>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!pago} onClose={() => setPago(null)} title={pago ? `Pagar ${pago.fila.nombre}` : ''}>
        {pago && (
          <Stack>
            <NumberInput label="Importe" value={pago.importe} onChange={(v) => setPago({ ...pago, importe: Number(v) || 0 })} decimalSeparator="," thousandSeparator="." decimalScale={2} />
            <TextInput type="date" label="Fecha" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.currentTarget.value })} />
            <Select label="Desde" data={origenes} value={pago.origen} onChange={(v) => setPago({ ...pago, origen: v })} />
            {op.alerta}
            <Button onClick={pagar} disabled={!pago.origen} loading={op.enviando}>Pagar</Button>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
