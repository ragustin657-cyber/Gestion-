import { ActionIcon, Alert, Button, FileButton, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, subirLista } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';

/** Tabla de ARCA de un semestre (importes anuales, spec E31 §3). */
export interface TablaGananciasWeb {
  gni: string; deduccionEspecial: string; conyuge: string; hijo: string; hijoIncapacitado: string;
  topes: { hipotecario: string; seguroMuerte: string; seguroMixto: string; seguroRetiro: string; sepelio: string };
  tramos: { desde: string; hasta: string | null; fijo: string; porcentaje: string }[];
}
export interface DatosTablaGanancias {
  gni: number; deduccionEspecial: number; conyuge: number; hijo: number; hijoIncapacitado: number;
  topes: { hipotecario: number; seguroMuerte: number; seguroMixto: number; seguroRetiro: number; sepelio: number };
  tramos: { desde: number; hasta: number | null; fijo: number; porcentaje: number }[];
}
export interface HojaGanancias {
  mes: number; bruta: string; aportes: string; gananciaNeta: string;
  deducciones: { tipo: string; nombre: string; informado: string; computado: string }[];
  personales: { gni: string; especial: string; cargas: string };
  sujeta: string; tramo: { desde: string; fijo: string; porcentaje: string }; impuesto: string;
  retenidoAnterior: string; calculado: string; topeMes: string; importe: string; noRetenido: string; avisos: string[];
}
export interface ResultadoF572 { importados: { archivo: string; empleado: string; avisos: string[] }[]; omitidos: { archivo: string; motivo: string }[]; pendientes: { archivo: string; empleado: string }[] }

const n = (s: string | null | undefined) => (s === null || s === undefined || s === '' ? NaN : Number(s));
const porc = (s: string) => `${Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

/** Valida la escala: empieza en 0, tramos consecutivos y el último sin límite. Devuelve el mensaje o null. */
export function tramosValidos(t: { desde: string; hasta: string | null }[]): string | null {
  if (!t.length) return 'Cargue la escala';
  if (n(t[0].desde) !== 0) return 'El primer tramo empieza en 0';
  for (let i = 0; i < t.length - 1; i++) if (!(n(t[i].hasta) > n(t[i].desde)) || n(t[i + 1].desde) !== n(t[i].hasta)) return 'Los tramos deben ser consecutivos';
  const ult = t[t.length - 1].hasta;
  if (ult !== null && ult !== '') return 'El último tramo no tiene límite';
  return null;
}

const VACIA: TablaGananciasWeb = { gni: '', deduccionEspecial: '', conyuge: '', hijo: '', hijoIncapacitado: '', topes: { hipotecario: '', seguroMuerte: '', seguroMixto: '', seguroRetiro: '', sepelio: '' }, tramos: [{ desde: '0', hasta: null, fijo: '0', porcentaje: '' }] };

export function FormTablaGanancias({ inicial, onGuardar, enviando }: { inicial: TablaGananciasWeb | null; onGuardar: (d: DatosTablaGanancias) => void; enviando?: boolean }) {
  const [v, setV] = useState<TablaGananciasWeb>(inicial ?? VACIA);
  const importe = (etiqueta: string, valor: string, cambiar: (x: string) => void) => (
    <NumberInput label={etiqueta} value={valor} min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," onChange={(x) => cambiar(String(x))} />
  );
  const tramo = (i: number, k: 'desde' | 'hasta' | 'fijo' | 'porcentaje', x: string) => setV({ ...v, tramos: v.tramos.map((t, j) => (j === i ? { ...t, [k]: x === '' && k === 'hasta' ? null : x } : t)) });
  const error = tramosValidos(v.tramos);
  const generales = [v.gni, v.deduccionEspecial, v.conyuge, v.hijo, v.hijoIncapacitado, ...Object.values(v.topes)];
  const completo = generales.every((x) => x !== '' && !Number.isNaN(Number(x))) && v.tramos.every((t) => t.fijo !== '' && t.porcentaje !== '');
  const guardar = () => onGuardar({
    gni: Number(v.gni), deduccionEspecial: Number(v.deduccionEspecial), conyuge: Number(v.conyuge), hijo: Number(v.hijo), hijoIncapacitado: Number(v.hijoIncapacitado),
    topes: { hipotecario: Number(v.topes.hipotecario), seguroMuerte: Number(v.topes.seguroMuerte), seguroMixto: Number(v.topes.seguroMixto), seguroRetiro: Number(v.topes.seguroRetiro), sepelio: Number(v.topes.sepelio) },
    tramos: v.tramos.map((t) => ({ desde: Number(t.desde), hasta: t.hasta === null || t.hasta === '' ? null : Number(t.hasta), fijo: Number(t.fijo), porcentaje: Number(t.porcentaje) })),
  });
  return (
    <Stack>
      <Text size="sm" c="dimmed">Importes anuales publicados por ARCA para el semestre. El cálculo los prorratea por mes.</Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {importe('Ganancia no imponible', v.gni, (x) => setV({ ...v, gni: x }))}
        {importe('Deducción especial incrementada', v.deduccionEspecial, (x) => setV({ ...v, deduccionEspecial: x }))}
        {importe('Cónyuge o conviviente', v.conyuge, (x) => setV({ ...v, conyuge: x }))}
        {importe('Hijo', v.hijo, (x) => setV({ ...v, hijo: x }))}
        {importe('Hijo incapacitado', v.hijoIncapacitado, (x) => setV({ ...v, hijoIncapacitado: x }))}
        {importe('Tope intereses hipotecarios', v.topes.hipotecario, (x) => setV({ ...v, topes: { ...v.topes, hipotecario: x } }))}
        {importe('Tope seguro de muerte', v.topes.seguroMuerte, (x) => setV({ ...v, topes: { ...v.topes, seguroMuerte: x } }))}
        {importe('Tope seguros mixtos', v.topes.seguroMixto, (x) => setV({ ...v, topes: { ...v.topes, seguroMixto: x } }))}
        {importe('Tope planes de retiro', v.topes.seguroRetiro, (x) => setV({ ...v, topes: { ...v.topes, seguroRetiro: x } }))}
        {importe('Tope gastos de sepelio', v.topes.sepelio, (x) => setV({ ...v, topes: { ...v.topes, sepelio: x } }))}
      </SimpleGrid>
      <Title order={5}>Escala del art. 94 (anual)</Title>
      <Table>
        <Table.Thead><Table.Tr><Table.Th>Desde</Table.Th><Table.Th>Hasta</Table.Th><Table.Th>Fijo</Table.Th><Table.Th>%</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {v.tramos.map((t, i) => (
            <Table.Tr key={i}>
              <Table.Td><TextInput aria-label={`Desde tramo ${i + 1}`} value={t.desde} onChange={(e) => tramo(i, 'desde', e.currentTarget.value)} /></Table.Td>
              <Table.Td><TextInput aria-label={`Hasta tramo ${i + 1}`} placeholder="en adelante" value={t.hasta ?? ''} onChange={(e) => tramo(i, 'hasta', e.currentTarget.value)} /></Table.Td>
              <Table.Td><TextInput aria-label={`Fijo tramo ${i + 1}`} value={t.fijo} onChange={(e) => tramo(i, 'fijo', e.currentTarget.value)} /></Table.Td>
              <Table.Td><TextInput aria-label={`Porcentaje tramo ${i + 1}`} value={t.porcentaje} onChange={(e) => tramo(i, 'porcentaje', e.currentTarget.value)} /></Table.Td>
              <Table.Td>{v.tramos.length > 1 && <ActionIcon variant="subtle" color="red" aria-label={`Quitar tramo ${i + 1}`} onClick={() => setV({ ...v, tramos: v.tramos.filter((_, j) => j !== i) })}>×</ActionIcon>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <Button variant="light" size="xs" onClick={() => setV({ ...v, tramos: [...v.tramos, { desde: v.tramos[v.tramos.length - 1]?.hasta ?? '', hasta: null, fijo: '', porcentaje: '' }] })}>Agregar tramo</Button>
        <Button loading={enviando} disabled={!!error || !completo} onClick={guardar}>Guardar</Button>
      </Group>
      {error && <Text size="sm" c="red">{error}</Text>}
    </Stack>
  );
}

/** Pantalla de las tablas de ARCA por semestre (permiso ganancias.configurar). */
export function GananciasTablasPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const actual = new Date().getFullYear();
  const [anio, setAnio] = useState(actual);
  const [semestre, setSemestre] = useState(new Date().getMonth() < 6 ? 1 : 2);
  const [version, setVersion] = useState(0);
  const ruta = `/sueldos/ganancias/tablas/${anio}/${semestre}`;
  const q = useQuery({ queryKey: [ruta], queryFn: () => api<TablaGananciasWeb | null>(ruta).catch(() => null) });
  const listo = async (r: unknown) => { if (r) { await qc.invalidateQueries({ queryKey: [ruta] }); setVersion((x) => x + 1); } };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Ganancias de cuarta categoría: tablas de ARCA</Title>
        <Group>
          <Select aria-label="Año" w={100} data={[actual - 1, actual, actual + 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} />
          <Select aria-label="Semestre" w={160} data={[{ value: '1', label: '1.er semestre' }, { value: '2', label: '2.º semestre' }]} value={String(semestre)} onChange={(x) => setSemestre(Number(x))} />
          <Button variant="light" size="xs" loading={op.enviando} onClick={async () => listo(await op.ejecutar(() => api(`${ruta}/copiar-anterior`, { metodo: 'POST' }), () => 'Tabla copiada del semestre anterior'))}>Copiar del semestre anterior</Button>
        </Group>
      </Group>
      {errorConsulta(q.error)}
      {op.alerta}
      {q.isSuccess && !q.data && <Alert color="yellow" mb="sm">No hay tabla cargada para este semestre: las liquidaciones con fecha de pago en él no se pueden cerrar.</Alert>}
      {q.isSuccess && <FormTablaGanancias key={`${ruta}-${version}-${q.data ? 1 : 0}`} inicial={q.data ?? null} enviando={op.enviando} onGuardar={async (d) => listo(await op.ejecutar(() => api(ruta, { metodo: 'PUT', body: d }), () => 'Tabla guardada'))} />}
    </Paper>
  );
}

/** Hoja de cálculo de la retención de un recibo (spec E31 §6). */
export function HojaGananciasVista({ hoja }: { hoja: HojaGanancias }) {
  const fila = (a: string, b: string, negrita = false) => <Table.Tr><Table.Td fw={negrita ? 700 : undefined}>{a}</Table.Td><Table.Td ta="right" fw={negrita ? 700 : undefined}>{b}</Table.Td></Table.Tr>;
  const menos = (x: string) => `- ${formatoMoneda(x)}`;
  const devolucion = Number(hoja.importe) < 0;
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">{`Importes acumulados del año a ${String(hoja.mes).padStart(2, '0')}`}</Text>
      <Table>
        <Table.Tbody>
          {fila('Ganancia bruta', formatoMoneda(hoja.bruta))}
          {fila('Aportes', menos(hoja.aportes))}
          {hoja.deducciones.map((d) => <Table.Tr key={d.tipo}><Table.Td>{`${d.nombre} (informado ${formatoMoneda(d.informado)})`}</Table.Td><Table.Td ta="right">{menos(d.computado)}</Table.Td></Table.Tr>)}
          {fila('Ganancia no imponible', menos(hoja.personales.gni))}
          {fila('Deducción especial', menos(hoja.personales.especial))}
          {fila('Cargas de familia', menos(hoja.personales.cargas))}
          {fila('Ganancia sujeta a impuesto', formatoMoneda(hoja.sujeta), true)}
          {fila(`Escala: ${formatoMoneda(hoja.tramo.fijo)} más el ${porc(hoja.tramo.porcentaje)} sobre el excedente de ${formatoMoneda(hoja.tramo.desde)}`, formatoMoneda(hoja.impuesto))}
          {fila('Retenido anteriormente', menos(hoja.retenidoAnterior))}
          {fila('Tope del mes (35 % del bruto)', formatoMoneda(hoja.topeMes))}
          {fila(devolucion ? 'Devolución del mes' : 'Retención del mes', formatoMoneda(Math.abs(Number(hoja.importe))), true)}
          {Number(hoja.noRetenido) > 0 && fila('Excedente no retenido (se retiene después)', formatoMoneda(hoja.noRetenido))}
        </Table.Tbody>
      </Table>
      {hoja.avisos.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
    </Stack>
  );
}

/** Resultado de importar F.572: importados (con avisos), omitidos y reemplazos pendientes de confirmar. */
export function ResultadoImportacionF572({ resultado, onConfirmar }: { resultado: ResultadoF572; onConfirmar?: () => void }) {
  return (
    <Alert color={resultado.omitidos.length || resultado.pendientes.length ? 'yellow' : 'green'} title={`${resultado.importados.length} F.572 importado(s)`}>
      {resultado.importados.flatMap((i) => i.avisos.map((a) => <Text key={`${i.archivo}${a}`} size="sm">{`${i.empleado}: ${a}`}</Text>))}
      {resultado.omitidos.map((o) => <Text key={o.archivo} size="sm">{`${o.archivo}: ${o.motivo}`}</Text>)}
      {resultado.pendientes.length > 0 && (
        <Stack gap={4} mt="xs">
          <Text size="sm">{`Corregidos a mano (se reemplazan solo si confirma): ${resultado.pendientes.map((p) => p.empleado).join(', ')}`}</Text>
          {onConfirmar && <Group><Button size="xs" color="orange" onClick={onConfirmar}>Confirmar reemplazo</Button></Group>}
        </Stack>
      )}
    </Alert>
  );
}

/** Botón para importar uno o varios F.572 (XML del SiRADIG). */
export function ImportarF572({ onImportado }: { onImportado?: () => void }) {
  const op = useOperacion();
  const [resultado, setResultado] = useState<ResultadoF572 | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const subir = async (fs: File[], confirmar: boolean) => {
    const r = await op.ejecutar(() => subirLista<ResultadoF572>('/sueldos/ganancias/f572/importar', 'archivos', fs, confirmar ? { confirmar: 'true' } : {}), (x) => `${x.importados.length} F.572 importado(s)`);
    if (r) { setResultado(r); setArchivos(fs); onImportado?.(); }
  };
  return (
    <Stack gap="xs">
      <FileButton multiple accept=".xml" onChange={(fs) => fs.length && void subir(fs, false)}>{(p) => <Button {...p} size="xs" variant="light" loading={op.enviando}>Importar F.572 (SiRADIG)</Button>}</FileButton>
      {op.alerta}
      {resultado && <ResultadoImportacionF572 resultado={resultado} onConfirmar={() => void subir(archivos.filter((a) => resultado.pendientes.some((p) => p.archivo === a.name)), true)} />}
    </Stack>
  );
}

interface DatosF572Web {
  cargas: { parentesco: string; documento: string; nombre: string; mesDesde: number; mesHasta: number; porcentaje: number }[];
  otrosEmpleadores: { cuit: string; nombre: string; meses: { mes: number; bruta: string; aportes: string; retenido: string }[] }[];
  deducciones: { tipo: string; codigo: string; prestador: string; meses: { mes: number; importe: string }[] }[];
}
interface F572Web { nroPresentacion: number; origen: string; modificadoAMano: boolean; datos: DatosF572Web }

const PARENTESCOS = [{ value: 'CONYUGE', label: 'Cónyuge o conviviente' }, { value: 'HIJO', label: 'Hijo' }, { value: 'HIJO_INCAPACITADO', label: 'Hijo incapacitado' }, { value: 'OTRO', label: 'Otro (no se deduce)' }];
const TIPOS = [
  ['CUOTAS_MEDICAS', 'Cuotas médico-asistenciales'], ['GASTOS_MEDICOS', 'Gastos médicos y paramédicos'], ['ALQUILER', 'Alquiler de casa habitación'], ['SERVICIO_DOMESTICO', 'Personal doméstico'],
  ['EDUCACION', 'Gastos de educación'], ['INTERESES_HIPOTECARIOS', 'Intereses hipotecarios'], ['SEGURO_MUERTE', 'Seguro de muerte'], ['SEGURO_MIXTO', 'Seguros mixtos'], ['SEGURO_RETIRO', 'Planes de retiro'],
  ['SEPELIO', 'Gastos de sepelio'], ['DONACIONES', 'Donaciones'], ['INDUMENTARIA', 'Indumentaria y equipamiento'], ['SGR', 'Aporte a SGR'], ['VEHICULOS_CORREDORES', 'Vehículos de corredores'],
  ['INTERESES_CORREDORES', 'Intereses de corredores'], ['CAJAS_JUBILACION', 'Aportes a cajas de jubilación'], ['OTRA', 'Otra (no se deduce)'],
].map(([value, label]) => ({ value, label }));

type DeduccionWeb = DatosF572Web['deducciones'][number];
type CambioDeduccion = Partial<{ tipo: string; prestador: string; desde: number; hasta: number; mensual: string }>;

/**
 * Edita una deducción: el tipo y el prestador no tocan los meses (los importados pueden variar por mes o saltear meses);
 * solo cambiar el rango o el importe mensual rearma los meses como un rango con el mismo importe (revisión E31).
 */
export function editarDeduccion(d: DeduccionWeb, x: CambioDeduccion): DeduccionWeb {
  const r = { ...d, tipo: x.tipo ?? d.tipo, prestador: x.prestador ?? d.prestador };
  if (x.desde === undefined && x.hasta === undefined && x.mensual === undefined) return r;
  const de = x.desde ?? d.meses[0]?.mes ?? 1;
  const ha = Math.max(x.hasta ?? d.meses[d.meses.length - 1]?.mes ?? de, de);
  const im = x.mensual ?? d.meses[0]?.importe ?? '0';
  return { ...r, meses: Array.from({ length: ha - de + 1 }, (_, k) => ({ mes: de + k, importe: im })) };
}

/** Ganancias de un empleado: F.572 (resumen y edición) y acumulado previo (spec E31 §4 y §6). */
export function GananciasEmpleado({ empleadoId, editable }: { empleadoId: string; editable: boolean }) {
  const qc = useQueryClient();
  const op = useOperacion();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const rutaF = `/sueldos/ganancias/f572/${empleadoId}/${anio}`;
  const rutaA = `/sueldos/ganancias/acumulado/${empleadoId}/${anio}`;
  const f = useQuery({ queryKey: [rutaF], queryFn: () => api<F572Web | null>(rutaF).catch(() => null) });
  const a = useQuery({ queryKey: [rutaA], queryFn: () => api<{ bruta: string; aportes: string; retenido: string }>(rutaA) });
  const [edicion, setEdicion] = useState<DatosF572Web | null>(null);
  const [acum, setAcum] = useState<{ bruta: string; aportes: string; retenido: string } | null>(null);
  const refrescar = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/sueldos/ganancias') });
  const total = (ms: { importe: string }[]) => ms.reduce((s, m) => s + Number(m.importe), 0);
  const datos = f.data?.datos;
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs"><Text fw={600}>Ganancias</Text><Select aria-label="Año de Ganancias" w={90} size="xs" data={[anio - 1, anio, anio + 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} /></Group>
        {editable && <Group gap="xs">
          <ImportarF572 onImportado={refrescar} />
          <Button size="xs" variant="light" onClick={() => setEdicion(structuredClone(datos ?? { cargas: [], otrosEmpleadores: [], deducciones: [] }))}>Editar F.572</Button>
        </Group>}
      </Group>
      {!datos && <Text size="sm" c="dimmed">Sin F.572 del año: se computan solo la ganancia no imponible, la deducción especial y los aportes.</Text>}
      {datos && <Text size="sm">{`F.572 ${f.data!.origen === 'IMPORTADO' ? `presentación ${f.data!.nroPresentacion}` : 'cargado a mano'}${f.data!.modificadoAMano ? ' (corregido a mano)' : ''}: ${datos.cargas.length} carga(s) de familia, ${datos.deducciones.length} deducción(es), ${datos.otrosEmpleadores.length} otro(s) empleador(es)`}</Text>}
      {datos?.deducciones.map((d, i) => <Text key={i} size="xs" c="dimmed">{`${TIPOS.find((t) => t.value === d.tipo)?.label ?? d.tipo}${d.prestador ? ` (${d.prestador})` : ''}: ${formatoMoneda(total(d.meses))}`}</Text>)}
      <Group gap="xs" align="end">
        <Text size="sm">{`Acumulado previo (fuera del sistema): bruto ${formatoMoneda(a.data?.bruta)}, aportes ${formatoMoneda(a.data?.aportes)}, retenido ${formatoMoneda(a.data?.retenido)}`}</Text>
        {editable && <Button size="compact-xs" variant="subtle" onClick={() => setAcum(a.data ?? { bruta: '0', aportes: '0', retenido: '0' })}>Editar</Button>}
      </Group>
      {op.alerta}
      <Modal opened={!!acum} onClose={() => setAcum(null)} title={`Acumulado previo ${anio}`}>
        {acum && <Stack>
          {(['bruta', 'aportes', 'retenido'] as const).map((k) => <NumberInput key={k} label={{ bruta: 'Ganancia bruta gravada', aportes: 'Aportes', retenido: 'Retenciones de Ganancias' }[k]} value={acum[k]} min={0} decimalScale={2} onChange={(x) => setAcum({ ...acum, [k]: String(x) })} />)}
          <Group justify="flex-end"><Button loading={op.enviando} onClick={async () => { if (await op.ejecutar(() => api(rutaA, { metodo: 'PUT', body: { bruta: Number(acum.bruta), aportes: Number(acum.aportes), retenido: Number(acum.retenido) } }), () => 'Acumulado guardado')) { setAcum(null); void refrescar(); } }}>Guardar</Button></Group>
        </Stack>}
      </Modal>
      <Modal opened={!!edicion} onClose={() => setEdicion(null)} size="xl" title={`F.572 ${anio}`}>
        {edicion && <Stack>
          <Text fw={600}>Cargas de familia</Text>
          {edicion.cargas.map((c, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Select aria-label="Parentesco" w={190} data={PARENTESCOS} value={c.parentesco} onChange={(x) => setEdicion({ ...edicion, cargas: edicion.cargas.map((y, j) => (j === i ? { ...y, parentesco: x ?? 'OTRO' } : y)) })} />
              <TextInput aria-label="Nombre" placeholder="Nombre" value={c.nombre} onChange={(e) => { const v = e.currentTarget.value; setEdicion({ ...edicion, cargas: edicion.cargas.map((y, j) => (j === i ? { ...y, nombre: v } : y)) }); }} />
              <NumberInput aria-label="Mes desde" w={80} min={1} max={12} value={c.mesDesde} onChange={(x) => setEdicion({ ...edicion, cargas: edicion.cargas.map((y, j) => (j === i ? { ...y, mesDesde: Number(x) || 1 } : y)) })} />
              <NumberInput aria-label="Mes hasta" w={80} min={1} max={12} value={c.mesHasta} onChange={(x) => setEdicion({ ...edicion, cargas: edicion.cargas.map((y, j) => (j === i ? { ...y, mesHasta: Number(x) || 12 } : y)) })} />
              <Select aria-label="Porcentaje" w={90} data={['100', '50']} value={String(c.porcentaje)} onChange={(x) => setEdicion({ ...edicion, cargas: edicion.cargas.map((y, j) => (j === i ? { ...y, porcentaje: Number(x) } : y)) })} />
              <ActionIcon variant="subtle" color="red" aria-label="Quitar carga" onClick={() => setEdicion({ ...edicion, cargas: edicion.cargas.filter((_, j) => j !== i) })}>×</ActionIcon>
            </Group>
          ))}
          <Group><Button size="xs" variant="light" onClick={() => setEdicion({ ...edicion, cargas: [...edicion.cargas, { parentesco: 'HIJO', documento: '', nombre: '', mesDesde: 1, mesHasta: 12, porcentaje: 100 }] })}>Agregar carga</Button></Group>
          <Text fw={600}>Deducciones (importe mensual de un rango de meses)</Text>
          {edicion.deducciones.map((d, i) => {
            const desde = d.meses[0]?.mes ?? 1;
            const hasta = d.meses[d.meses.length - 1]?.mes ?? desde;
            const mensual = d.meses[0]?.importe ?? '0';
            const set = (x: CambioDeduccion) => setEdicion({ ...edicion, deducciones: edicion.deducciones.map((y, j) => (j === i ? editarDeduccion(y, x) : y)) });
            return (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select aria-label="Tipo de deducción" w={230} data={TIPOS} value={d.tipo} onChange={(x) => set({ tipo: x ?? 'OTRA' })} />
                <TextInput aria-label="Prestador" placeholder="Prestador" value={d.prestador} onChange={(e) => set({ prestador: e.currentTarget.value })} />
                <NumberInput aria-label="Desde el mes" w={80} min={1} max={12} value={desde} onChange={(x) => set({ desde: Number(x) || 1 })} />
                <NumberInput aria-label="Hasta el mes" w={80} min={1} max={12} value={hasta} onChange={(x) => set({ hasta: Number(x) || 12 })} />
                <NumberInput aria-label="Importe mensual" w={140} min={0} decimalScale={2} value={mensual} onChange={(x) => set({ mensual: String(x || 0) })} />
                <ActionIcon variant="subtle" color="red" aria-label="Quitar deducción" onClick={() => setEdicion({ ...edicion, deducciones: edicion.deducciones.filter((_, j) => j !== i) })}>×</ActionIcon>
              </Group>
            );
          })}
          <Group><Button size="xs" variant="light" onClick={() => setEdicion({ ...edicion, deducciones: [...edicion.deducciones, { tipo: 'CUOTAS_MEDICAS', codigo: '', prestador: '', meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, importe: '0' })) }] })}>Agregar deducción</Button></Group>
          {edicion.otrosEmpleadores.length > 0 && <Text size="sm" c="dimmed">{`Otros empleadores: ${edicion.otrosEmpleadores.map((o) => o.nombre || o.cuit).join(', ')} (se editan reimportando el F.572)`}</Text>}
          <Group justify="flex-end"><Button loading={op.enviando} onClick={async () => { if (await op.ejecutar(() => api(rutaF, { metodo: 'PUT', body: { datos: edicion } }), () => 'F.572 guardado')) { setEdicion(null); void refrescar(); } }}>Guardar</Button></Group>
        </Stack>}
      </Modal>
    </Stack>
  );
}
