import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar, ErrorApi } from '../../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../../compras/formato';
import { MESES } from '../../impuestos/comun';
import { useOperacion } from '../../tesoreria/comun';

export interface CuentaPrevia { cuentaContableId: string; codigo: string; nombre: string; saldoContable: string; reexpresado: string; ajuste: string; cuentaAjuste: string | null }
export interface PreviaAjuste { ejercicio: { id: string; numero: number }; fecha: string; cuentas: CuentaPrevia[]; renglones: unknown[]; recpam: string; avisos: string[] }
export interface FilaAjuste { asientoId: string; numero: number; fecha: string; ejercicio: number | null; recpam: string; anulado: boolean }

const finDeMes = (anio: string, mes: string) => new Date(Date.UTC(Number(anio), Number(mes), 0)).toISOString().slice(0, 10);

export function TablaPreviaAjuste({ previa }: { previa: PreviaAjuste }) {
  const recpam = Number(previa.recpam);
  return (
    <Stack gap="xs">
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th ta="right">Saldo contable</Table.Th><Table.Th ta="right">Reexpresado</Table.Th><Table.Th ta="right">Ajuste</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {previa.cuentas.map((c) => (
            <Table.Tr key={c.cuentaContableId}>
              <Table.Td>{c.codigo} {c.nombre}{c.cuentaAjuste && <Text span size="xs" c="dimmed" ml="xs">{`en ${c.cuentaAjuste}`}</Text>}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(c.saldoContable)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(c.reexpresado)}</Table.Td>
              <Table.Td ta="right" fw={Number(c.ajuste) ? 600 : 400}>{formatoMoneda(c.ajuste)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr>
            <Table.Th colSpan={3}>{recpam > 0 ? 'RECPAM (ganancia)' : recpam < 0 ? 'RECPAM (pérdida)' : 'RECPAM'}</Table.Th>
            <Table.Th ta="right">{formatoMoneda(previa.recpam)}</Table.Th>
          </Table.Tr>
        </Table.Tfoot>
      </Table>
      {previa.avisos.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
    </Stack>
  );
}

export function TablaAjustes({ filas, onAnular }: { filas: FilaAjuste[]; onAnular: (asientoId: string) => void }) {
  const ultimo = filas.find((f) => !f.anulado);
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Asiento</Table.Th><Table.Th>Ejercicio</Table.Th><Table.Th ta="right">RECPAM</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((f) => (
          <Table.Tr key={f.asientoId}>
            <Table.Td>{formatoFecha(f.fecha)}</Table.Td>
            <Table.Td>{f.numero}</Table.Td>
            <Table.Td>{f.ejercicio ?? '—'}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(f.recpam)}</Table.Td>
            <Table.Td>
              {f.anulado
                ? <Badge color="gray" variant="light">Anulado</Badge>
                : f === ultimo && <Button size="compact-xs" color="red" variant="light" onClick={() => onAnular(f.asientoId)}>Anular</Button>}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function AjusteInflacionPage() {
  const qc = useQueryClient();
  const [mes, setMes] = useState(hoy().slice(5, 7));
  const [anio, setAnio] = useState(hoy().slice(0, 4));
  const [previa, setPrevia] = useState<PreviaAjuste | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const op = useOperacion();
  const lista = useQuery({ queryKey: ['/contabilidad/ajuste-inflacion'], queryFn: () => api<FilaAjuste[]>('/contabilidad/ajuste-inflacion') });
  const fecha = finDeMes(anio, mes);
  const refrescar = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/contabilidad') });

  const verPrevia = async () => {
    op.setError('');
    setPrevia(null);
    try {
      setPrevia(await api<PreviaAjuste>('/contabilidad/ajuste-inflacion/previa', { query: { fecha } }));
    } catch (e) {
      op.setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  const generar = async () => {
    const r = await op.ejecutar(() => api<{ numero: number }>('/contabilidad/ajuste-inflacion', { metodo: 'POST', body: { fecha } }), (x) => `Asiento de ajuste N° ${x.numero} generado`);
    if (r) { setPrevia(null); refrescar(); }
  };
  const anular = async () => {
    const r = await op.ejecutar(() => api(`/contabilidad/ajuste-inflacion/${anulando}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Ajuste anulado');
    setAnulando(null);
    setMotivo('');
    if (r) refrescar();
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Ajuste por inflación</Title>
      <Group align="flex-end" mb="md">
        <Select label="Mes" w={150} allowDeselect={false} data={MESES} value={mes} onChange={(v) => { setMes(v ?? mes); setPrevia(null); }} />
        <TextInput label="Año" w={90} value={anio} onChange={(e) => { setAnio(e.currentTarget.value); setPrevia(null); }} />
        <Button variant="default" onClick={() => void verPrevia()}>Ver previa</Button>
        {previa && <>
          <Button variant="light" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/contabilidad/ajuste-inflacion/previa', { fecha, formato: 'xlsx' }, `ajuste-inflacion-${fecha}.xlsx`)}>Excel</Button>
          <Button loading={op.enviando} disabled={!previa.renglones.length} onClick={() => void generar()}>Generar</Button>
        </>}
      </Group>
      <Text size="sm" c="dimmed" mb="sm">Reexpresa las cuentas no monetarias al {formatoFecha(fecha)} (RT 6, método directo). Cada asiento agrega lo que falta respecto de los ajustes anteriores.</Text>
      {op.alerta}
      {previa && <>
        {!previa.renglones.length && <Alert color="blue" mb="sm">No hay diferencias para ajustar.</Alert>}
        <TablaPreviaAjuste previa={previa} />
      </>}
      <Title order={5} mt="lg" mb="xs">Ajustes generados</Title>
      <TablaAjustes filas={lista.data ?? []} onAnular={setAnulando} />
      <Modal opened={!!anulando} onClose={() => setAnulando(null)} title="Anular ajuste">
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group mt="md"><Button color="red" disabled={!motivo.trim()} onClick={() => void anular()}>Anular</Button></Group>
      </Modal>
    </Paper>
  );
}
