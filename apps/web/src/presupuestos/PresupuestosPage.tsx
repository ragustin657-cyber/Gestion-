import { Alert, Badge, Button, FileButton, Group, Modal, NumberInput, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCuentasImputables } from '../abm/opciones';
import { api, descargar, ErrorApi, subirArchivo } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { useCentrosCosto, useEjercicios } from '../contabilidad/comun';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { Grilla, LineaGrilla, mmaaaa, PresupuestoLista } from './comun';

const mostrar = (v: string) => (Number(v) ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '');
/** '1.500,50' o '1500,50' (formato argentino) y '1500.50' (punto decimal) → 1500.5; vacío → 0; inválido → NaN. */
export function numeroCelda(t: string): number {
  const s = t.trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(s)) return Number(s);
  return Number(s.replace(/\./g, ''));
}

/** Celda editable: guarda al salir solo si el valor cambió. */
function Celda({ linea, mes, valor, onGuardar }: { linea: LineaGrilla; mes: string; valor: string; onGuardar: (v: number) => void }) {
  const [texto, setTexto] = useState(mostrar(valor));
  useEffect(() => setTexto(mostrar(valor)), [valor]);
  return <TextInput size="xs" w={100} styles={{ input: { textAlign: 'right' } }} aria-label={`${linea.codigo} ${mmaaaa(mes)}`} value={texto} inputMode="decimal"
    onChange={(e) => setTexto(e.currentTarget.value)}
    onBlur={() => {
      const n = numeroCelda(texto);
      if (Number.isNaN(n) || n < 0) { setTexto(mostrar(valor)); return; }
      if (Math.round(n * 100) !== Math.round(Number(valor) * 100)) onGuardar(Math.round(n * 100) / 100);
    }} />;
}

export function GrillaPresupuesto({ grilla, editable, onCambiar }: { grilla: Grilla; editable: boolean; onCambiar: (l: LineaGrilla, importes: Record<string, number>) => void }) {
  return (
    <Table.ScrollContainer minWidth={300 + grilla.meses.length * 110}>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th>{grilla.meses.map((m) => <Table.Th key={m} ta="right">{mmaaaa(m)}</Table.Th>)}<Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {grilla.lineas.map((l) => (
            <Table.Tr key={`${l.cuentaContableId}|${l.centroCostoId ?? ''}`}>
              <Table.Td><Text size="sm">{l.codigo} {l.nombre}</Text>{l.centroCosto && <Text size="xs" c="dimmed">{l.centroCosto}</Text>}</Table.Td>
              {grilla.meses.map((m) => <Table.Td key={m} ta="right">{editable
                ? <Celda linea={l} mes={m} valor={l.importes[m]} onGuardar={(v) => onCambiar(l, { [m]: v })} />
                : formatoMoneda(l.importes[m])}</Table.Td>)}
              <Table.Td ta="right" fw={600}>{formatoMoneda(l.total)}</Table.Td>
            </Table.Tr>
          ))}
          {!grilla.lineas.length && <Table.Tr><Table.Td colSpan={grilla.meses.length + 2}><Text size="sm" c="dimmed">Sin líneas: agregá una cuenta, repartí un total, traé el real del ejercicio anterior o importá un Excel.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr data-testid="fila-resultado"><Table.Th>Resultado</Table.Th>{grilla.meses.map((m) => <Table.Th key={m} ta="right">{formatoMoneda(grilla.totales.porMes[m])}</Table.Th>)}<Table.Th ta="right">{formatoMoneda(grilla.totales.resultado)}</Table.Th></Table.Tr>
        </Table.Tfoot>
      </Table>
    </Table.ScrollContainer>
  );
}

export function PresupuestosPage() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const { puede } = useAuth();
  const ejercicios = useEjercicios();
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<{ nombre: string; copiarDeId: string | null } | null>(null);
  const op = useOperacion();
  useEffect(() => { if (!ejercicioId && ejercicios.data?.length) setEjercicioId((ejercicios.data.find((e) => e.estado === 'ABIERTO') ?? ejercicios.data[0]).id); }, [ejercicios.data, ejercicioId]);
  const lista = useQuery({ queryKey: ['/presupuestos', ejercicioId], queryFn: () => api<PresupuestoLista[]>('/presupuestos', { query: { ejercicioId: ejercicioId! } }), enabled: !!ejercicioId });
  const refrescar = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/presupuestos') });
  const crear = async () => {
    const r = await op.ejecutar(() => api<{ id: string }>('/presupuestos', { metodo: 'POST', body: { ejercicioId, nombre: nuevo!.nombre, copiarDeId: nuevo!.copiarDeId } }), () => 'Presupuesto creado');
    if (r) { setNuevo(null); refrescar(); navegar(`/informes/presupuestos/${r.id}`); }
  };
  const accion = async (ruta: string, metodo: 'POST' | 'DELETE', msg: string) => { if (await op.ejecutar(() => api(ruta, { metodo }), () => msg)) refrescar(); };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Presupuestos</Title>
        {puede('presupuesto.editar') && <Button size="xs" onClick={() => setNuevo({ nombre: '', copiarDeId: null })}>Nuevo presupuesto</Button>}
      </Group>
      <Select label="Ejercicio" w={240} mb="md" allowDeselect={false} value={ejercicioId} onChange={setEjercicioId} data={(ejercicios.data ?? []).map((e) => ({ value: e.id, label: `Ejercicio ${e.numero} (${e.desde.slice(0, 4)})` }))} />
      {op.alerta}
      {errorConsulta(lista.error)}
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Nombre</Table.Th><Table.Th ta="right">Ingresos</Table.Th><Table.Th ta="right">Egresos</Table.Th><Table.Th ta="right">Resultado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(lista.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td style={{ cursor: 'pointer' }} onClick={() => navegar(`/informes/presupuestos/${p.id}`)}>{p.nombre} {p.vigente && <Badge size="sm" variant="light" color="green">Vigente</Badge>}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(p.totalIngresos)}</Table.Td><Table.Td ta="right">{formatoMoneda(p.totalEgresos)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(Number(p.totalIngresos) - Number(p.totalEgresos))}</Table.Td>
              <Table.Td>{puede('presupuesto.editar') && <Group gap={4} justify="flex-end">
                {!p.vigente && <Button size="xs" variant="subtle" onClick={() => void accion(`/presupuestos/${p.id}/vigente`, 'POST', 'Presupuesto marcado como vigente')}>Marcar vigente</Button>}
                <Button size="xs" variant="subtle" onClick={() => setNuevo({ nombre: `${p.nombre} (copia)`, copiarDeId: p.id })}>Copiar</Button>
                {!p.vigente && <Button size="xs" variant="subtle" color="red" onClick={() => void accion(`/presupuestos/${p.id}`, 'DELETE', 'Presupuesto eliminado')}>Eliminar</Button>}
              </Group>}</Table.Td>
            </Table.Tr>
          ))}
          {lista.data && !lista.data.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed">Sin presupuestos en el ejercicio</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={!!nuevo} onClose={() => setNuevo(null)} title={nuevo?.copiarDeId ? 'Copiar presupuesto' : 'Nuevo presupuesto'}>
        {nuevo && <Stack>
          <TextInput label="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.currentTarget.value })} />
          {op.alerta}
          <Group><Button loading={op.enviando} disabled={!nuevo.nombre.trim()} onClick={() => void crear()}>Crear</Button></Group>
        </Stack>}
      </Modal>
    </Paper>
  );
}

export function EditorPresupuestoPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { puede } = useAuth();
  const op = useOperacion();
  const cuentas = useCuentasImputables().filter((c) => /^[45]/.test(c.label));
  const centros = useCentrosCosto();
  const [modal, setModal] = useState<null | 'linea' | 'repartir' | 'real'>(null);
  const [form, setForm] = useState<{ cuenta: string | null; centro: string | null; total: number | string; ajuste: number | string }>({ cuenta: null, centro: null, total: '', ajuste: 0 });
  const [errores, setErrores] = useState<{ linea: number; mensaje: string }[]>([]);
  const q = useQuery({ queryKey: ['/presupuestos/grilla', id], queryFn: () => api<Grilla>(`/presupuestos/${id}/grilla`) });
  const actualizar = (g: Grilla) => { qc.setQueryData(['/presupuestos/grilla', id], g); void qc.invalidateQueries({ queryKey: ['/presupuestos'] }); };
  const editable = puede('presupuesto.editar');
  const guardarLinea = async (l: { cuentaContableId: string; centroCostoId: string | null }, importes: Record<string, number>) => {
    // Solo el mes editado (parcial): un segundo guardado rápido no pisa al primero
    const r = await op.ejecutar(() => api<Grilla>(`/presupuestos/${id}/lineas`, { metodo: 'PUT', body: { cuentaContableId: l.cuentaContableId, centroCostoId: l.centroCostoId, importes, parcial: true } }), () => 'Guardado');
    if (r) actualizar(r);
  };
  const enviar = async () => {
    let r: Grilla | null = null;
    if (modal === 'linea') {
      // La línea nueva se agrega a la grilla en cero y se guarda al cargar el primer importe
      const g0 = q.data!;
      const etiqueta = cuentas.find((c) => c.value === form.cuenta)?.label ?? '';
      const [codigo, ...resto] = etiqueta.split(' ');
      if (!g0.lineas.some((l) => l.cuentaContableId === form.cuenta && l.centroCostoId === form.centro))
        qc.setQueryData(['/presupuestos/grilla', id], { ...g0, lineas: [...g0.lineas, { cuentaContableId: form.cuenta!, codigo, nombre: resto.join(' '), tipo: codigo.startsWith('4') ? 'INGRESO' : 'EGRESO', centroCostoId: form.centro, centroCosto: centros.find((c) => c.value === form.centro)?.label ?? null, importes: Object.fromEntries(g0.meses.map((m) => [m, '0.00'])), total: '0.00' }] });
      setModal(null);
      return;
    }
    if (modal === 'repartir') r = await op.ejecutar(() => api<Grilla>(`/presupuestos/${id}/lineas/repartir`, { metodo: 'POST', body: { cuentaContableId: form.cuenta, centroCostoId: form.centro, total: Number(form.total) } }), () => 'Total repartido');
    if (modal === 'real') r = await op.ejecutar(() => api<Grilla>(`/presupuestos/${id}/desde-real`, { metodo: 'POST', body: { ajustePct: Number(form.ajuste) } }), () => 'Presupuesto cargado con el real del ejercicio anterior');
    if (r) { actualizar(r); setModal(null); }
  };
  const importar = async (f: File | null) => {
    if (!f) return;
    setErrores([]);
    try {
      actualizar(await subirArchivo<Grilla>(`/presupuestos/${id}/importar`, {}, f));
    } catch (e) {
      const lista = e instanceof ErrorApi ? (e.datos?.errores as { linea: number; mensaje: string }[] | undefined) : undefined;
      setErrores(lista ?? [{ linea: 0, mensaje: e instanceof ErrorApi ? e.mensaje : 'Error al importar' }]);
    }
  };
  const g = q.data;
  return (
    <Paper withBorder p="md" radius="md">
      {errorConsulta(q.error)}
      {g && <>
        <Group justify="space-between" mb="md">
          <Title order={3}>{g.presupuesto.nombre} {g.presupuesto.vigente && <Badge variant="light" color="green">Vigente</Badge>}</Title>
          <Group gap="xs">
            {editable && <>
              <Button size="xs" variant="default" onClick={() => { setForm({ cuenta: null, centro: null, total: '', ajuste: 0 }); setModal('linea'); }}>Agregar línea</Button>
              <Button size="xs" variant="default" onClick={() => { setForm({ cuenta: null, centro: null, total: '', ajuste: 0 }); setModal('repartir'); }}>Repartir total anual</Button>
              <Button size="xs" variant="default" onClick={() => setModal('real')}>Traer real del ejercicio anterior</Button>
              <FileButton onChange={(f) => void importar(f)} accept=".xlsx,.csv">{(p) => <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} {...p}>Importar</Button>}</FileButton>
            </>}
            <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} onClick={() => void descargar(`/presupuestos/${id}/exportar`, {}, `${g.presupuesto.nombre}.xlsx`)}>Exportar</Button>
          </Group>
        </Group>
        {op.alerta}
        {errores.length > 0 && <Alert color="red" mb="sm" title="El archivo tiene errores: no se importó nada">{errores.map((e) => <Text size="sm" key={`${e.linea}-${e.mensaje}`}>{e.linea ? `Línea ${e.linea}: ` : ''}{e.mensaje}</Text>)}</Alert>}
        <Text size="sm" c="dimmed" mb="sm">Importes en positivo: ingresos para las cuentas de ventas e ingresos, gastos para las de costos y gastos. Ingresos {formatoMoneda(g.totales.ingresos)} · Egresos {formatoMoneda(g.totales.egresos)}.</Text>
        <GrillaPresupuesto grilla={g} editable={editable} onCambiar={(l, imp) => void guardarLinea(l, imp)} />
      </>}
      <Modal opened={!!modal} onClose={() => setModal(null)} title={modal === 'linea' ? 'Agregar línea' : modal === 'repartir' ? 'Repartir total anual' : 'Traer real del ejercicio anterior'}>
        <Stack>
          {modal !== 'real' && <>
            <Select label="Cuenta" searchable data={cuentas} value={form.cuenta} onChange={(v) => setForm({ ...form, cuenta: v })} />
            <Select label="Centro de costo" clearable placeholder="Sin centro" data={centros} value={form.centro} onChange={(v) => setForm({ ...form, centro: v })} />
          </>}
          {modal === 'repartir' && <NumberInput label="Total anual" decimalSeparator="," thousandSeparator="." min={0} value={form.total} onChange={(v) => setForm({ ...form, total: v })} />}
          {modal === 'real' && <>
            <Text size="sm">Reemplaza todo el presupuesto por el real del ejercicio anterior, mes a mes, con el ajuste indicado.</Text>
            <NumberInput label="Ajuste %" decimalSeparator="," value={form.ajuste} onChange={(v) => setForm({ ...form, ajuste: v })} />
          </>}
          {op.alerta}
          <Group><Button loading={op.enviando} disabled={modal !== 'real' && !form.cuenta} onClick={() => void enviar()}>{modal === 'real' ? 'Traer' : modal === 'repartir' ? 'Repartir' : 'Agregar'}</Button></Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
