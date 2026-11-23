import { Alert, Badge, Button, Group, Paper, Select, Stack, Table, Text, Title } from '@mantine/core';
import { nombreJurisdiccion } from '@gestion/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { MESES } from './comun';
import { mesAnterior } from './PosicionIvaPage';

/** Liquidación mensual de IIBB por Convenio Multilateral (spec E38). */
interface DetalleJurisdiccion {
  jurisdiccion: string; coeficiente: string; alicuota: string; base: string; impuesto: string; retenciones: string; percepciones: string; recaudaciones?: string; saldoAnterior: string; aPagar: string; saldoAFavor: string;
}
type Totales = Omit<DetalleJurisdiccion, 'jurisdiccion' | 'coeficiente' | 'alicuota'>;
export interface PosicionIibbWeb { anio: number; mes: number; estado: 'BORRADOR' | 'CERRADA'; ingresos: string; detalle: DetalleJurisdiccion[]; totales: Totales; avisos: string[]; asientoId: string | null }
export interface MesIibb { mes: number; estado: 'CERRADA' | null; aPagar: string | null; saldoAFavor: string | null }

const CAMPOS: [keyof Totales, string][] = [['base', 'Base'], ['impuesto', 'Impuesto'], ['retenciones', 'Retenciones'], ['percepciones', 'Percepciones'], ['recaudaciones', 'Recaudaciones bancarias'], ['saldoAnterior', 'Saldo anterior'], ['aPagar', 'A pagar'], ['saldoAFavor', 'Saldo a favor']];

/** Ingresos del mes y tabla por jurisdicción (los números de la CM03) con totales. */
export function DetallePosicionIibb({ p }: { p: PosicionIibbWeb }) {
  const coef = (x: string) => Number(x).toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return (
    <Stack gap="xs">
      {p.avisos.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
      <Text size="sm">Ingresos gravados del mes: <b>{formatoMoneda(p.ingresos)}</b></Text>
      <Table.ScrollContainer minWidth={900}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr><Table.Th>Jurisdicción</Table.Th><Table.Th ta="right">Coeficiente</Table.Th><Table.Th ta="right">Alícuota</Table.Th>{CAMPOS.map(([k, t]) => <Table.Th key={k} ta="right">{t}</Table.Th>)}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {p.detalle.map((d) => (
              <Table.Tr key={d.jurisdiccion}>
                <Table.Td>{nombreJurisdiccion(d.jurisdiccion)}</Table.Td>
                <Table.Td ta="right">{coef(d.coeficiente)}</Table.Td>
                <Table.Td ta="right">{`${Number(d.alicuota).toLocaleString('es-AR', { maximumFractionDigits: 4 })} %`}</Table.Td>
                {CAMPOS.map(([k]) => <Table.Td key={k} ta="right">{formatoMoneda(d[k])}</Table.Td>)}
              </Table.Tr>
            ))}
            <Table.Tr fw={700}>
              <Table.Td>Total</Table.Td><Table.Td /><Table.Td />
              {CAMPOS.map(([k]) => <Table.Td key={k} ta="right">{formatoMoneda(p.totales[k])}</Table.Td>)}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed">Los saldos a favor de una jurisdicción no se compensan con el impuesto de otra.</Text>
    </Stack>
  );
}

/** Pulido E42: a pagar y a favor juntos cuando el mes tiene los dos (en distintas jurisdicciones). */
const resultadoMes = (m: MesIibb) => [Number(m.aPagar) > 0 ? `A pagar ${formatoMoneda(m.aPagar)}` : null, Number(m.saldoAFavor) > 0 ? `A favor ${formatoMoneda(m.saldoAFavor)}` : null]
  .filter(Boolean).join(' · ') || 'Sin saldo';

export function TablaMesesIibb({ meses, elegido, onElegir }: { meses: MesIibb[]; elegido: number; onElegir: (mes: number) => void }) {
  return (
    <Table withTableBorder highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Mes</Table.Th><Table.Th>Estado</Table.Th><Table.Th ta="right">Resultado</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {meses.map((m) => (
          <Table.Tr key={m.mes} style={{ cursor: 'pointer', fontWeight: m.mes === elegido ? 700 : undefined }} onClick={() => onElegir(m.mes)}>
            <Table.Td>{MESES[m.mes - 1].label}</Table.Td>
            <Table.Td>{m.estado === 'CERRADA' ? <Badge color="green" variant="light">Cerrada</Badge> : <Badge color="gray" variant="light">Sin cerrar</Badge>}</Table.Td>
            <Table.Td ta="right">{m.estado !== 'CERRADA' ? '' : resultadoMes(m)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Impuestos → Liquidación de IIBB (Convenio Multilateral). */
export function PosicionIibbPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const navegar = useNavigate();
  const [anio, setAnio] = useState(mesAnterior(new Date()).anio);
  const [mes, setMes] = useState(mesAnterior(new Date()).mes);
  const meses = useQuery({ queryKey: ['/impuestos/iibb/posicion/meses', anio], queryFn: () => api<MesIibb[]>('/impuestos/iibb/posicion/meses', { query: { anio: String(anio) } }) });
  const pos = useQuery({ queryKey: ['/impuestos/iibb/posicion', anio, mes], queryFn: () => api<PosicionIibbWeb>('/impuestos/iibb/posicion', { query: { anio: String(anio), mes: String(mes) } }) });
  const editable = puede('impuestos.presentar');
  const refrescar = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/impuestos/iibb/posicion') });
  const accion = async (paso: 'cerrar' | 'reabrir') => {
    if (await op.ejecutar(() => api(`/impuestos/iibb/posicion/${anio}/${mes}/${paso}`, { metodo: 'POST' }), () => (paso === 'cerrar' ? 'Liquidación cerrada' : 'Liquidación reabierta'))) void refrescar();
  };
  const periodo = `${String(mes).padStart(2, '0')}/${anio}`;
  const archivo = (formato: 'xlsx' | 'pdf') => void descargar('/impuestos/iibb/posicion', { anio: String(anio), mes: String(mes), formato }, `iibb-cm-${anio}${String(mes).padStart(2, '0')}.${formato}`);
  const p = pos.data;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Liquidación de IIBB (Convenio Multilateral)</Title>
        <Select aria-label="Año" w={100} data={[anio - 1, anio, anio + 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} />
      </Group>
      {errorConsulta(meses.error ?? pos.error)}
      {op.alerta}
      <Stack>
        <div style={{ maxWidth: 420 }}><TablaMesesIibb meses={meses.data ?? []} elegido={mes} onElegir={setMes} /></div>
        <Group justify="space-between">
          <Group gap="xs"><Text fw={600}>{`Período ${periodo}`}</Text>{p && (p.estado === 'CERRADA' ? <Badge color="green">Cerrada</Badge> : <Badge color="yellow">Borrador</Badge>)}</Group>
          <Group gap="xs">
            {editable && p?.estado === 'BORRADOR' && <Button size="xs" loading={op.enviando} onClick={() => void accion('cerrar')}>Cerrar</Button>}
            {editable && p?.estado === 'CERRADA' && <Button size="xs" color="orange" variant="light" loading={op.enviando} onClick={() => void accion('reabrir')}>Reabrir</Button>}
            <Button size="xs" variant="default" onClick={() => archivo('xlsx')}>Excel</Button>
            <Button size="xs" variant="default" onClick={() => archivo('pdf')}>PDF</Button>
          </Group>
        </Group>
        {p?.asientoId && <Text size="sm">Asiento de liquidación: <Text span c="blue" style={{ cursor: 'pointer' }} onClick={() => navegar(`/contabilidad/asientos/${p.asientoId}`)}>ver asiento</Text></Text>}
        {p && <DetallePosicionIibb p={p} />}
      </Stack>
    </Paper>
  );
}
