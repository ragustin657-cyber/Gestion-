import { Button, FileButton, Group, Modal, NumberInput, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi, subirArchivo } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { useConvenios } from './comun';

interface FilaEscala { categoriaId: string; categoria: string; basico: string | null; delMes: boolean }

export function ConveniosPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const convenios = useConvenios();
  const editable = puede('sueldos.liquidar');
  const [convenioId, setConvenioId] = useState<string | null>(null);
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [categoria, setCategoria] = useState<{ id?: string; nombre: string; orden: number } | null>(null);
  const [erroresImport, setErroresImport] = useState<{ linea: number; mensaje: string }[]>([]);
  useEffect(() => { if (!convenioId && convenios.data?.length) setConvenioId(convenios.data[0].id); }, [convenios.data, convenioId]);
  const [anio, nmes] = mes.split('-').map(Number);
  const clave = ['/sueldos/escalas', convenioId, mes];
  const escalas = useQuery({ queryKey: clave, enabled: !!convenioId && !!anio && !!nmes, queryFn: () => api<FilaEscala[]>('/sueldos/escalas', { query: { convenioId: convenioId!, anio, mes: nmes } }) });
  const convenio = convenios.data?.find((c) => c.id === convenioId);
  const topes = useQuery({ queryKey: ['/sueldos/topes', convenioId], enabled: !!convenioId, queryFn: () => api<{ topes: { id: string; desdeAnio: number; desdeMes: number; importe: string }[] }>('/sueldos/topes', { query: { convenioId: convenioId! } }) });
  const [tope, setTope] = useState<number | ''>('');
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['/sueldos/escalas'] }); void qc.invalidateQueries({ queryKey: ['/sueldos/convenios'] }); };
  const guardarBasico = async (categoriaId: string, basico: number) => {
    if (!(basico > 0)) return;
    if (await op.ejecutar(() => api('/sueldos/escalas', { metodo: 'PUT', body: { categoriaId, anio, mes: nmes, basico } }), () => 'Básico guardado')) refrescar();
  };
  const guardarCategoria = async () => {
    if (!categoria || !convenioId) return;
    const body = { convenioId, nombre: categoria.nombre, orden: categoria.orden };
    if (await op.ejecutar(() => api(categoria.id ? `/sueldos/categorias/${categoria.id}` : '/sueldos/categorias', { metodo: categoria.id ? 'PUT' : 'POST', body }), () => 'Categoría guardada')) { setCategoria(null); refrescar(); }
  };
  const importar = async (archivo: File | null) => {
    if (!archivo || !convenioId) return;
    setErroresImport([]);
    try {
      await subirArchivo(`/sueldos/escalas/importar?convenioId=${convenioId}`, {}, archivo);
      refrescar();
    } catch (e) {
      const errores = (e instanceof ErrorApi ? (e.datos as { errores?: { linea: number; mensaje: string }[] } | undefined)?.errores : undefined) ?? [];
      setErroresImport(errores.length ? errores : [{ linea: 0, mensaje: e instanceof ErrorApi ? e.mensaje : 'No se pudo importar' }]);
    }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Convenios y escalas</Title>
        <Group>
          <Select data={(convenios.data ?? []).map((c) => ({ value: c.id, label: c.nombre }))} value={convenioId} onChange={setConvenioId} aria-label="Convenio" />
          <TextInput type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.currentTarget.value)} />
          {editable && <FileButton onChange={importar} accept=".csv,.xlsx">{(p) => <Button variant="light" size="xs" {...p}>Importar escala</Button>}</FileButton>}
          {editable && <Button size="xs" onClick={() => setCategoria({ nombre: '', orden: (convenio?.categorias.length ?? 0) + 1 })}>Nueva categoría</Button>}
        </Group>
      </Group>
      {convenio && <Text size="sm" c="dimmed" mb="sm">{convenio.codigo} · {convenio.horasMensuales} horas mensuales. Los meses sin escala propia usan la última anterior.</Text>}
      {erroresImport.length > 0 && <Stack gap={2} mb="sm">{erroresImport.map((e) => <Text key={`${e.linea}-${e.mensaje}`} c="red" size="sm">{e.linea ? `Línea ${e.linea}: ` : ''}{e.mensaje}</Text>)}</Stack>}
      {op.alerta}
      {errorConsulta(escalas.error)}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Categoría</Table.Th><Table.Th ta="right">Básico vigente</Table.Th>{editable && <Table.Th>Básico del mes</Table.Th>}<Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(escalas.data ?? []).map((f) => (
            <Table.Tr key={f.categoriaId}>
              <Table.Td>{f.categoria}</Table.Td>
              <Table.Td ta="right">{f.basico ? formatoMoneda(f.basico) : '—'}{f.basico && !f.delMes ? ' (anterior)' : ''}</Table.Td>
              {editable && (
                <Table.Td>
                  <NumberInput key={`${f.categoriaId}-${mes}-${f.basico}`} aria-label={`Básico ${f.categoria}`} size="xs" w={160} min={0} decimalScale={2} decimalSeparator="," thousandSeparator="."
                    defaultValue={f.delMes && f.basico ? Number(f.basico) : ''} onBlur={(e) => { const v = Number(e.currentTarget.value.replace(/\./g, '').replace(',', '.')); if (v && v !== Number(f.basico)) void guardarBasico(f.categoriaId, v); }} />
                </Table.Td>
              )}
              <Table.Td>{editable && <Button size="compact-xs" variant="subtle" onClick={() => { const c = convenio?.categorias.find((x) => x.id === f.categoriaId); if (c) setCategoria({ id: c.id, nombre: c.nombre, orden: c.orden }); }}>Editar</Button>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Title order={5} mt="lg" mb="xs">Tope indemnizatorio (art. 245)</Title>
      <Group align="flex-end" mb="xs">
        {(topes.data?.topes ?? []).map((t) => <Text key={t.id} size="sm">Desde {String(t.desdeMes).padStart(2, '0')}/{t.desdeAnio}: {formatoMoneda(t.importe)}</Text>)}
        {!topes.data?.topes.length && <Text size="sm" c="dimmed">Sin tope cargado: la indemnización se calcula sin tope.</Text>}
      </Group>
      {editable && (
        <Group align="flex-end">
          <NumberInput label={`Tope desde ${String(nmes).padStart(2, '0')}/${anio}`} w={220} min={0} decimalSeparator="," thousandSeparator="." decimalScale={2} value={tope} onChange={(v) => setTope(v === '' ? '' : Number(v))} />
          <Button variant="light" disabled={!tope} onClick={async () => { if (await op.ejecutar(() => api('/sueldos/topes', { metodo: 'PUT', body: { convenioId, desdeAnio: anio, desdeMes: nmes, importe: tope } }), () => 'Tope guardado')) { setTope(''); refrescar(); void qc.invalidateQueries({ queryKey: ['/sueldos/topes'] }); } }}>Guardar tope</Button>
        </Group>
      )}
      <Modal opened={!!categoria} onClose={() => setCategoria(null)} title={categoria?.id ? 'Editar categoría' : 'Nueva categoría'}>
        {categoria && (
          <Stack>
            <TextInput label="Nombre" value={categoria.nombre} onChange={(e) => setCategoria({ ...categoria, nombre: e.currentTarget.value })} />
            <NumberInput label="Orden" value={categoria.orden} onChange={(v) => setCategoria({ ...categoria, orden: Number(v) || 0 })} />
            {op.alerta}
            <Button onClick={guardarCategoria}>Guardar</Button>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
