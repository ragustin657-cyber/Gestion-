import { Alert, Button, Checkbox, Group, Paper, SegmentedControl, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { InformeAntiguedad, InformeRotacion, InformeVentas, mesActual, mesCorto, pctTexto, rangoMes, useOrden } from './comun';

type Col<T> = { campo: keyof T & string; titulo: string; tipo?: 'moneda' | 'pct' | 'num'; render?: (f: T) => ReactNode };

function celda<T>(c: Col<T>, v: unknown, f?: T): ReactNode {
  if (c.render && f) return c.render(f);
  if (c.tipo === 'moneda') return formatoMoneda(v as string);
  if (c.tipo === 'pct') return pctTexto(v as string | null);
  if (c.tipo === 'num') return v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  return v as ReactNode;
}

/** Tabla con orden por columna y fila de totales. */
function TablaInforme<T extends object>({ filas, cols, totales, clave }: { filas: T[]; cols: Col<T>[]; totales?: Partial<Record<keyof T, unknown>>; clave: (f: T) => string }) {
  const { ordenadas, ordenar, orden } = useOrden(filas);
  const der = (c: Col<T>) => (c.tipo ? 'right' : undefined);
  return (
    <Table withTableBorder striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>{cols.map((c) => <Table.Th key={c.campo} ta={der(c)} style={{ cursor: 'pointer' }} onClick={() => ordenar(c.campo)}>{c.titulo}{orden?.campo === c.campo ? (orden.desc ? ' ↓' : ' ↑') : ''}</Table.Th>)}</Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {ordenadas.map((f) => <Table.Tr key={clave(f)}>{cols.map((c) => <Table.Td key={c.campo} ta={der(c)}>{celda(c, f[c.campo], f)}</Table.Td>)}</Table.Tr>)}
        {!filas.length && <Table.Tr><Table.Td colSpan={cols.length}><Text c="dimmed" size="sm">Sin datos en el período</Text></Table.Td></Table.Tr>}
      </Table.Tbody>
      {totales && <Table.Tfoot>
        <Table.Tr data-testid="fila-total">{cols.map((c, i) => <Table.Th key={c.campo} ta={der(c)}>{i === 0 ? 'Total' : c.campo in totales ? celda({ ...c, render: undefined }, totales[c.campo]) : ''}</Table.Th>)}</Table.Tr>
      </Table.Tfoot>}
    </Table>
  );
}

function Encabezado({ titulo, ruta, query, archivo }: { titulo: string; ruta: string; query: Record<string, string>; archivo: string }) {
  return (
    <Group justify="space-between" mb="md">
      <Title order={3}>{titulo}</Title>
      <Group gap="xs">
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar(ruta, { ...query, formato: 'xlsx' }, `${archivo}.xlsx`)}>Excel</Button>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar(ruta, { ...query, formato: 'pdf' }, `${archivo}.pdf`)}>PDF</Button>
      </Group>
    </Group>
  );
}

/** Desde/hasta tomados de la URL (paso desde el tablero) o el mes actual. */
function usePeriodo() {
  const [params] = useSearchParams();
  const def = rangoMes(mesActual());
  const [desde, setDesde] = useState(params.get('desde') ?? def.desde);
  const [hasta, setHasta] = useState(params.get('hasta') ?? def.hasta);
  const campos = <>
    <TextInput label="Desde" type="date" w={160} value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
    <TextInput label="Hasta" type="date" w={160} value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
  </>;
  return { desde, hasta, campos, params };
}

function InformeVentasBase({ tipo }: { tipo: 'ventas' | 'margenes' }) {
  const { desde, hasta, campos, params } = usePeriodo();
  const opciones = tipo === 'ventas' ? [{ value: 'cliente', label: 'Cliente' }, { value: 'articulo', label: 'Artículo' }, { value: 'mes', label: 'Mes' }] : [{ value: 'articulo', label: 'Artículo' }, { value: 'cliente', label: 'Cliente' }];
  const inicial = params.get('agrupar');
  const [agrupar, setAgrupar] = useState(opciones.some((o) => o.value === inicial) ? inicial! : opciones[0].value);
  const [reexpresar, setReexpresar] = useState(false);
  const query = { desde, hasta, agrupar, reexpresar: String(reexpresar) };
  const q = useQuery({ queryKey: [`/informes/${tipo}`, query], queryFn: () => api<InformeVentas>(`/informes/${tipo}`, { query }), enabled: !!desde && !!hasta });
  type F = InformeVentas['filas'][number];
  const cols: Col<F>[] = [
    { campo: 'nombre', titulo: agrupar === 'mes' ? 'Mes' : agrupar === 'cliente' ? 'Cliente' : 'Artículo', render: (f) => (agrupar === 'mes' ? mesCorto(f.clave) : f.nombre) },
    { campo: 'ventas', titulo: 'Ventas', tipo: 'moneda' }, { campo: 'costo', titulo: 'Costo', tipo: 'moneda' }, { campo: 'margen', titulo: 'Margen', tipo: 'moneda' },
    { campo: 'margenPct', titulo: 'Margen %', tipo: 'pct' }, ...(tipo === 'ventas' ? [{ campo: 'sinCosto' as const, titulo: 'Sin costo', tipo: 'moneda' as const }] : []),
  ];
  return (
    <Paper withBorder p="md" radius="md">
      <Encabezado titulo={tipo === 'ventas' ? 'Ventas' : 'Márgenes'} ruta={`/informes/${tipo}`} query={query} archivo={`${tipo}-${desde}-${hasta}`} />
      <Group mb="md" align="flex-end">
        {campos}
        <div><Text size="sm" fw={500} mb={2}>Agrupar por</Text><SegmentedControl data={opciones} value={agrupar} onChange={setAgrupar} /></div>
        <Checkbox label="En moneda de hoy" checked={reexpresar} onChange={(e) => setReexpresar(e.currentTarget.checked)} mb={8} />
      </Group>
      {errorConsulta(q.error)}
      {q.data?.aviso && <Alert color="orange" mb="md">{q.data.aviso}</Alert>}
      {q.data && <>
        <TablaInforme key={agrupar} filas={q.data.filas} cols={cols} totales={q.data.totales} clave={(f) => f.clave} />
        {tipo === 'margenes' && <Text size="sm" c="dimmed" mt="xs">Cobertura (ventas con costo sobre el total): {pctTexto(q.data.totales.cobertura)}</Text>}
      </>}
    </Paper>
  );
}

export const VentasInformePage = () => <InformeVentasBase tipo="ventas" />;
export const MargenesPage = () => <InformeVentasBase tipo="margenes" />;

/** Saldos por tramo de vencimiento con fila de totales. */
export function TablaAntiguedad({ datos }: { datos: InformeAntiguedad }) {
  type F = InformeAntiguedad['filas'][number];
  const m = (campo: keyof F & string, titulo: string): Col<F> => ({ campo, titulo, tipo: 'moneda' });
  return <TablaInforme filas={datos.filas} totales={datos.totales} clave={(f) => f.terceroId}
    cols={[{ campo: 'nombre', titulo: 'Tercero' }, m('aVencer', 'A vencer'), m('d1_30', '1–30'), m('d31_60', '31–60'), m('d61_90', '61–90'), m('mas90', 'Más de 90'), m('aFavor', 'A favor'), m('total', 'Total')]} />;
}

export function AntiguedadPage() {
  const [params] = useSearchParams();
  const [tipo, setTipo] = useState(params.get('tipo') === 'proveedores' ? 'proveedores' : 'clientes');
  const [fecha, setFecha] = useState(params.get('fecha') ?? hoy());
  const query = { tipo, fecha };
  const q = useQuery({ queryKey: ['/informes/antiguedad', query], queryFn: () => api<InformeAntiguedad>('/informes/antiguedad', { query }), enabled: !!fecha });
  return (
    <Paper withBorder p="md" radius="md">
      <Encabezado titulo="Antigüedad de saldos" ruta="/informes/antiguedad" query={query} archivo={`antiguedad-${tipo}-${fecha}`} />
      <Group mb="md" align="flex-end">
        <SegmentedControl data={[{ value: 'clientes', label: 'Clientes' }, { value: 'proveedores', label: 'Proveedores' }]} value={tipo} onChange={setTipo} />
        <TextInput label="Al" type="date" w={160} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      </Group>
      {errorConsulta(q.error)}
      {q.data && <TablaAntiguedad datos={q.data} />}
    </Paper>
  );
}

export function RotacionPage() {
  const { desde, hasta, campos } = usePeriodo();
  const query = { desde, hasta };
  const q = useQuery({ queryKey: ['/informes/rotacion', query], queryFn: () => api<InformeRotacion>('/informes/rotacion', { query }), enabled: !!desde && !!hasta });
  type F = InformeRotacion['filas'][number];
  const cols: Col<F>[] = [
    { campo: 'descripcion', titulo: 'Artículo', render: (f) => `${f.codigo} ${f.descripcion}` },
    { campo: 'stockInicial', titulo: 'Stock inicial', tipo: 'moneda' }, { campo: 'stockFinal', titulo: 'Stock final', tipo: 'moneda' },
    { campo: 'costoVendido', titulo: 'Costo vendido', tipo: 'moneda' }, { campo: 'rotacion', titulo: 'Rotación', tipo: 'num' }, { campo: 'diasCobertura', titulo: 'Días de cobertura', tipo: 'num' },
  ];
  return (
    <Paper withBorder p="md" radius="md">
      <Encabezado titulo="Rotación de stock" ruta="/informes/rotacion" query={query} archivo={`rotacion-${desde}-${hasta}`} />
      <Group mb="md" align="flex-end">{campos}</Group>
      {errorConsulta(q.error)}
      {q.data && <TablaInforme filas={q.data.filas} cols={cols} totales={q.data.totales} clave={(f) => f.articuloId} />}
    </Paper>
  );
}
