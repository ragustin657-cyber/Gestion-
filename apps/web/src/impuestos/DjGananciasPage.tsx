import { Alert, Anchor, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';

type Datos = { quebrantosAnteriores: string; anticiposIngresados: string; saldoAFavorAnterior: string; impuestoCheque: string; otrosPagos: string };
export interface Dj {
  ejercicio: { numero: number; desde: string; hasta: string; estado: string }; estado: 'BORRADOR' | 'PRESENTADA'; datos: Datos;
  ajustes: { id: string; concepto: string; importe: string }[];
  determinacion: {
    resultadoContable: string; ajusteAmortizaciones: string; ajusteInflacion: string; totalAjustesManuales: string; resultadoImpositivo: string; quebrantosComputados: string;
    quebrantoEjercicio: string; gananciaNetaImponible: string; impuestoDeterminado: string; retenciones: string; percepciones: string; pagosACuenta: string; saldo: string;
    baseAnticipos: string; vencimientoDj: string; anticipos: { numero: number; mes: string; porcentaje: string; importe: string }[]; avisos: string[];
  };
  presentaciones: { numero: number; presentadaEn: string; presentadaPor: string; anuladaEn: string | null; motivoAnulacion: string | null }[];
}
const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const CAMPOS: [keyof Datos, string][] = [
  ['quebrantosAnteriores', 'Quebrantos de ejercicios anteriores (actualizados)'], ['anticiposIngresados', 'Anticipos ingresados'], ['saldoAFavorAnterior', 'Saldo a favor del ejercicio anterior'],
  ['impuestoCheque', 'Impuesto sobre débitos y créditos computable'], ['otrosPagos', 'Otros pagos a cuenta'],
];

/** Determinación, datos cargados, ajustes, anticipos e historial de la DJ (E46). */
export function PanelDj({ ejercicioId, datos, puedeEditar, alCambiar }: { ejercicioId: string; datos: Dj; puedeEditar: boolean; alCambiar: () => void }) {
  const op = useOperacion();
  const d = datos.determinacion;
  const editable = puedeEditar && datos.estado === 'BORRADOR';
  const [carga, setCarga] = useState<Record<keyof Datos, number | string>>(() => Object.fromEntries(CAMPOS.map(([k]) => [k, Number(datos.datos[k])])) as Record<keyof Datos, number>);
  const [ajuste, setAjuste] = useState<{ id: string | null; concepto: string; importe: number | string } | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const ejecutar = async (f: () => Promise<unknown>, msj: string) => { if (await op.ejecutar(f, () => msj)) { alCambiar(); return true; } return false; };
  const fila = (t: string, v: string, fuerte = false, extra?: React.ReactNode) => (
    <Table.Tr><Table.Td>{fuerte ? <b>{t}</b> : t} {extra}</Table.Td><Table.Td ta="right">{fuerte ? <b>{formatoMoneda(v)}</b> : formatoMoneda(v)}</Table.Td></Table.Tr>
  );
  return (
    <Stack>
      {d.avisos.map((a) => <Alert key={a} color="orange">{a}</Alert>)}
      {op.alerta}
      <Group>
        <Badge color={datos.estado === 'PRESENTADA' ? 'green' : 'gray'}>{datos.estado === 'PRESENTADA' ? 'Presentada' : 'Borrador'}</Badge>
        {puedeEditar && datos.estado === 'BORRADOR' && <Button size="xs" onClick={() => void ejecutar(() => api('/impuestos/dj-ganancias/presentar', { metodo: 'POST', body: { ejercicioId } }), 'DJ marcada como presentada')}>Marcar como presentada</Button>}
        {puedeEditar && datos.estado === 'PRESENTADA' && <Button size="xs" color="red" variant="light" onClick={() => setMotivo('')}>Anular presentación</Button>}
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Table withTableBorder>
          <Table.Tbody>
            {fila('Resultado contable (sin ajuste por inflación contable)', d.resultadoContable)}
            {fila('Ajuste de amortizaciones', d.ajusteAmortizaciones, false, <Anchor component={Link} to="/contabilidad/planilla-impositiva" size="xs">ver planilla</Anchor>)}
            {fila('Ajuste por inflación impositivo', d.ajusteInflacion, false, <Anchor component={Link} to="/impuestos/ajuste-inflacion" size="xs">ver ajuste</Anchor>)}
            {fila('Ajustes manuales', d.totalAjustesManuales)}
            {fila('Resultado impositivo', d.resultadoImpositivo, true)}
            {fila('Quebrantos computados', d.quebrantosComputados)}
            {Number(d.quebrantoEjercicio) > 0 && fila('Quebranto del ejercicio', d.quebrantoEjercicio)}
            {fila('Ganancia neta imponible', d.gananciaNetaImponible, true)}
            {fila('Impuesto determinado', d.impuestoDeterminado, true)}
          </Table.Tbody>
        </Table>
        <Table withTableBorder>
          <Table.Tbody>
            {fila('Retenciones sufridas', d.retenciones)}{fila('Percepciones (despachos)', d.percepciones)}
            {fila('Anticipos ingresados', datos.datos.anticiposIngresados)}{fila('Saldo a favor anterior', datos.datos.saldoAFavorAnterior)}
            {fila('Impuesto sobre débitos y créditos', datos.datos.impuestoCheque)}{fila('Otros pagos a cuenta', datos.datos.otrosPagos)}
            {fila('Pagos a cuenta', d.pagosACuenta, true)}
            <Table.Tr><Table.Td><b>{Number(d.saldo) >= 0 ? 'A pagar' : 'A favor'}</b> {`(vence en ${mmaaaa(d.vencimientoDj)})`}</Table.Td><Table.Td ta="right"><b>{formatoMoneda(Math.abs(Number(d.saldo)))}</b></Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>
      </SimpleGrid>

      <Title order={5}>Datos cargados</Title>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {CAMPOS.map(([k, t]) => <NumberInput key={k} label={t} min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," disabled={!editable} value={carga[k]} onChange={(v) => setCarga({ ...carga, [k]: v })} />)}
      </SimpleGrid>
      {editable && <Group><Button size="xs" variant="light" onClick={() => void ejecutar(() => api('/impuestos/dj-ganancias/datos', { metodo: 'PUT', body: { ejercicioId, ...Object.fromEntries(CAMPOS.map(([k]) => [k, Number(carga[k]) || 0])) } }), 'Datos guardados')}>Guardar datos</Button></Group>}

      <Group justify="space-between"><Title order={5}>Ajustes manuales</Title>
        {editable && <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setAjuste({ id: null, concepto: '', importe: '' })}>Nuevo ajuste</Button>}</Group>
      <Table withTableBorder>
        <Table.Tbody>
          {datos.ajustes.map((a) => (
            <Table.Tr key={a.id}><Table.Td>{a.concepto}</Table.Td><Table.Td ta="right">{formatoMoneda(a.importe)}</Table.Td>
              <Table.Td>{editable && <Group gap={4}>
                <Button size="compact-xs" variant="subtle" onClick={() => setAjuste({ id: a.id, concepto: a.concepto, importe: Number(a.importe) })}>Editar</Button>
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => void ejecutar(() => api(`/impuestos/dj-ganancias/ajustes/${a.id}`, { metodo: 'DELETE' }), 'Ajuste eliminado')}>Eliminar</Button>
              </Group>}</Table.Td></Table.Tr>
          ))}
          {!datos.ajustes.length && <Table.Tr><Table.Td><Text size="sm" c="dimmed">Sin ajustes. Positivo suma al resultado (gastos no deducibles); negativo resta (ingresos exentos).</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>

      <Title order={5}>{`Anticipos del ejercicio siguiente (base ${formatoMoneda(d.baseAnticipos)})`}</Title>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>N.º</Table.Th><Table.Th>Mes de vencimiento</Table.Th><Table.Th ta="right">%</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{d.anticipos.map((a) => <Table.Tr key={a.numero}><Table.Td>{a.numero}</Table.Td><Table.Td>{mmaaaa(a.mes)}</Table.Td><Table.Td ta="right">{Number(a.porcentaje).toLocaleString('es-AR')}</Table.Td><Table.Td ta="right">{formatoMoneda(a.importe)}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>

      {!!datos.presentaciones.length && <>
        <Title order={5}>Presentaciones</Title>
        <Table withTableBorder>
          <Table.Tbody>{datos.presentaciones.map((p) => (
            <Table.Tr key={p.numero}><Table.Td>{p.numero === 0 ? 'Original' : `Rectificativa ${p.numero}`}</Table.Td><Table.Td>{new Date(p.presentadaEn).toLocaleString('es-AR')}</Table.Td>
              <Table.Td>{p.anuladaEn ? `Anulada: ${p.motivoAnulacion ?? ''}` : 'Vigente'}</Table.Td></Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </>}

      <Modal opened={!!ajuste} onClose={() => setAjuste(null)} title={ajuste?.id ? 'Modificar ajuste' : 'Nuevo ajuste'}>
        {ajuste && <Stack>
          <TextInput label="Concepto" value={ajuste.concepto} onChange={(e) => setAjuste({ ...ajuste, concepto: e.currentTarget.value })} />
          <NumberInput label="Importe (con signo)" decimalScale={2} thousandSeparator="." decimalSeparator="," value={ajuste.importe} onChange={(v) => setAjuste({ ...ajuste, importe: v })} />
          <Group><Button onClick={() => void ejecutar(() => api(ajuste.id ? `/impuestos/dj-ganancias/ajustes/${ajuste.id}` : '/impuestos/dj-ganancias/ajustes', { metodo: ajuste.id ? 'PUT' : 'POST', body: { ejercicioId, concepto: ajuste.concepto, importe: Number(ajuste.importe) } }), 'Ajuste guardado').then((ok) => ok && setAjuste(null))}>Guardar ajuste</Button></Group>
        </Stack>}
      </Modal>
      <Modal opened={motivo !== null} onClose={() => setMotivo(null)} title="Anular presentación">
        <Stack>
          <TextInput label="Motivo" value={motivo ?? ''} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <Group><Button color="red" onClick={() => void ejecutar(() => api('/impuestos/dj-ganancias/anular', { metodo: 'POST', body: { ejercicioId, motivo } }), 'Presentación anulada').then((ok) => ok && setMotivo(null))}>Anular</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function DjGananciasPage() {
  const qc = useQueryClient();
  const { puede } = useAuth();
  const ejercicios = useQuery({ queryKey: ['/contabilidad/ejercicios'], queryFn: () => api<{ id: string; numero: number; hasta: string; estado: string }[]>('/contabilidad/ejercicios') });
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  useEffect(() => {
    if (!ejercicioId && ejercicios.data?.length) setEjercicioId((ejercicios.data.find((x) => x.estado === 'ABIERTO') ?? ejercicios.data[0]).id);
  }, [ejercicios.data, ejercicioId]);
  const q = useQuery({ queryKey: ['/impuestos/dj-ganancias', ejercicioId], queryFn: () => api<Dj>('/impuestos/dj-ganancias', { query: { ejercicioId: ejercicioId ?? '' } }), enabled: !!ejercicioId });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>DJ de Ganancias (sociedades)</Title>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} disabled={!q.data}
          onClick={() => void descargar('/impuestos/dj-ganancias', { ejercicioId: ejercicioId ?? '', formato: 'xlsx' }, `dj-ganancias-${q.data?.ejercicio.hasta ?? ''}.xlsx`)}>Excel</Button>
      </Group>
      <Select label="Ejercicio" w={220} mb="md" allowDeselect={false} value={ejercicioId} onChange={setEjercicioId}
        data={(ejercicios.data ?? []).map((e) => ({ value: e.id, label: `Ejercicio ${e.numero} (${e.hasta.slice(0, 4)})` }))} />
      <Text size="xs" c="dimmed" mb="sm">Papel de trabajo del F.713: la presentación se hace en el sitio de ARCA. La escala se carga en Configuración de impuestos.</Text>
      {errorConsulta(q.error)}
      {q.data && ejercicioId && <PanelDj key={`${ejercicioId}-${q.data.estado}-${JSON.stringify(q.data.datos)}`} ejercicioId={ejercicioId} datos={q.data} puedeEditar={puede('impuestos.presentar')} alCambiar={() => void qc.invalidateQueries({ queryKey: ['/impuestos/dj-ganancias'] })} />}
    </Paper>
  );
}
