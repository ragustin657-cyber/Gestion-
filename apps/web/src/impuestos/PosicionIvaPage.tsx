import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { MESES } from './comun';

/** Posición mensual de IVA (spec E37). */
export interface PosicionIvaWeb {
  anio: number; mes: number; estado: 'BORRADOR' | 'CERRADA'; debito: Record<string, string>; credito: Record<string, string>; totalDebito: string; totalCredito: string;
  saldoTecnicoAnterior: string; libreAnterior: string; retenciones: string; percepciones: string; saldoTecnicoAFavor: string; impuestoDeterminado: string;
  impuestoAPagar: string; libreDisponibilidad: string; avisos: string[]; asientoId: string | null;
}
export interface MesIva { mes: number; estado: 'CERRADA' | null; impuestoAPagar: string | null; saldoTecnicoAFavor: string | null; libreDisponibilidad: string | null }

/** Detalle del mes en el orden del F.2002: débito, crédito, saldo técnico, retenciones y percepciones, libre disponibilidad y resultado. */
export function DetallePosicionIva({ p }: { p: PosicionIvaWeb }) {
  const fila = (a: string, b: string, negrita = false) => <Table.Tr key={a}><Table.Td fw={negrita ? 700 : undefined}>{a}</Table.Td><Table.Td ta="right" fw={negrita ? 700 : undefined}>{formatoMoneda(b)}</Table.Td></Table.Tr>;
  const aPagar = Number(p.impuestoAPagar) > 0;
  return (
    <Stack gap="xs">
      {p.avisos.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
      <Table withTableBorder>
        <Table.Tbody>
          {Object.entries(p.debito).map(([a, v]) => fila(`Débito fiscal ${a} %`, v))}
          {fila('Total débito fiscal', p.totalDebito, true)}
          {Object.entries(p.credito).map(([a, v]) => fila(`Crédito fiscal ${a} %`, v))}
          {fila('Total crédito fiscal', p.totalCredito, true)}
          {fila('Saldo técnico a favor del período anterior', p.saldoTecnicoAnterior)}
          {fila('Impuesto determinado', p.impuestoDeterminado, true)}
          {Number(p.saldoTecnicoAFavor) > 0 && fila('Saldo técnico a favor del período', p.saldoTecnicoAFavor)}
          {fila('Retenciones de IVA sufridas', p.retenciones)}
          {fila('Percepciones de IVA sufridas', p.percepciones)}
          {fila('Saldo de libre disponibilidad del período anterior', p.libreAnterior)}
          {aPagar ? fila('Impuesto a pagar', p.impuestoAPagar, true) : fila('Saldo de libre disponibilidad', p.libreDisponibilidad, true)}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

/** Los 12 meses del año con su estado y su resultado (los cerrados). */
export function TablaMesesIva({ meses, elegido, onElegir }: { meses: MesIva[]; elegido: number; onElegir: (mes: number) => void }) {
  return (
    <Table withTableBorder highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Mes</Table.Th><Table.Th>Estado</Table.Th><Table.Th ta="right">Resultado</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {meses.map((m) => (
          <Table.Tr key={m.mes} style={{ cursor: 'pointer', fontWeight: m.mes === elegido ? 700 : undefined }} onClick={() => onElegir(m.mes)}>
            <Table.Td>{MESES[m.mes - 1].label}</Table.Td>
            <Table.Td>{m.estado === 'CERRADA' ? <Badge color="green" variant="light">Cerrada</Badge> : <Badge color="gray" variant="light">Sin cerrar</Badge>}</Table.Td>
            <Table.Td ta="right">{m.estado !== 'CERRADA' ? '' : Number(m.impuestoAPagar) > 0 ? `A pagar ${formatoMoneda(m.impuestoAPagar)}` : `A favor ${formatoMoneda(Number(m.saldoTecnicoAFavor) + Number(m.libreDisponibilidad))}`}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** El mes anterior a una fecha (el que normalmente se liquida). */
export const mesAnterior = (d: Date) => (d.getMonth() === 0 ? { anio: d.getFullYear() - 1, mes: 12 } : { anio: d.getFullYear(), mes: d.getMonth() });

/** Impuestos → Posición de IVA. */
export function PosicionIvaPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const navegar = useNavigate();
  const hoy = new Date();
  // Arranca en el mes anterior: en enero, diciembre del año anterior (revisión E37)
  const [anio, setAnio] = useState(mesAnterior(hoy).anio);
  const [mes, setMes] = useState(mesAnterior(hoy).mes);
  const meses = useQuery({ queryKey: ['/impuestos/posicion-iva/meses', anio], queryFn: () => api<MesIva[]>('/impuestos/posicion-iva/meses', { query: { anio: String(anio) } }) });
  const pos = useQuery({ queryKey: ['/impuestos/posicion-iva', anio, mes], queryFn: () => api<PosicionIvaWeb>('/impuestos/posicion-iva', { query: { anio: String(anio), mes: String(mes) } }) });
  const editable = puede('impuestos.presentar');
  const refrescar = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/impuestos/posicion-iva') });
  const accion = async (paso: 'cerrar' | 'reabrir') => {
    if (await op.ejecutar(() => api(`/impuestos/posicion-iva/${anio}/${mes}/${paso}`, { metodo: 'POST' }), () => (paso === 'cerrar' ? 'Posición cerrada' : 'Posición reabierta'))) void refrescar();
  };
  const periodo = `${String(mes).padStart(2, '0')}/${anio}`;
  const p = pos.data;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Posición de IVA</Title>
        <Select aria-label="Año" w={100} data={[anio - 1, anio, anio + 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} />
      </Group>
      {errorConsulta(meses.error ?? pos.error)}
      {op.alerta}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <TablaMesesIva meses={meses.data ?? []} elegido={mes} onElegir={setMes} />
        <Stack>
          <Group justify="space-between">
            <Group gap="xs"><Text fw={600}>{`Período ${periodo}`}</Text>{p && (p.estado === 'CERRADA' ? <Badge color="green">Cerrada</Badge> : <Badge color="yellow">Borrador</Badge>)}</Group>
            <Group gap="xs">
              {editable && p?.estado === 'BORRADOR' && <Button size="xs" loading={op.enviando} onClick={() => void accion('cerrar')}>Cerrar</Button>}
              {editable && p?.estado === 'CERRADA' && <Button size="xs" color="orange" variant="light" loading={op.enviando} onClick={() => void accion('reabrir')}>Reabrir</Button>}
              <Button size="xs" variant="default" onClick={() => void descargar('/impuestos/posicion-iva', { anio: String(anio), mes: String(mes), formato: 'xlsx' }, `posicion-iva-${anio}${String(mes).padStart(2, '0')}.xlsx`)}>Excel</Button>
              <Button size="xs" variant="default" onClick={() => void descargar('/impuestos/posicion-iva', { anio: String(anio), mes: String(mes), formato: 'pdf' }, `posicion-iva-${anio}${String(mes).padStart(2, '0')}.pdf`)}>PDF</Button>
            </Group>
          </Group>
          {p?.asientoId && <Text size="sm">Asiento de liquidación: <Text span c="blue" style={{ cursor: 'pointer' }} onClick={() => navegar(`/contabilidad/asientos/${p.asientoId}`)}>ver asiento</Text></Text>}
          {p && <DetallePosicionIva p={p} />}
        </Stack>
      </SimpleGrid>
    </Paper>
  );
}
