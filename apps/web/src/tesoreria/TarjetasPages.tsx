import { ActionIcon, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, numero, opcionesCuentas, useCuentasBancarias, useOperacion } from './comun';

export interface Tarjeta { id: string; nombre: string; tipo?: string; cuentaBancariaId?: string; cuentaContableId?: string; activa: boolean }
export interface CuponEditable { tarjetaId: string | null; lote: string; numero: string; cuotas: number; importe: string }
export interface CuponPendiente { id: string; fecha: string; numero: string | null; lote: string | null; cuotas: number; importe: string; cliente: string; tarjeta?: string; dias?: number; estado?: string }
interface ImpuestoEditable { clase: 'RETENCION' | 'PERCEPCION'; tipo: 'IVA' | 'GANANCIAS' | 'IIBB'; jurisdiccion: string; importe: string }

export const useTarjetas = () => useQuery({ queryKey: ['/tesoreria/tarjetas'], queryFn: () => api<Tarjeta[]>('/tesoreria/tarjetas') }).data ?? [];
const n0 = (s: string) => numero(s) || 0;

/** Cupones del cobro: tarjeta, lote, cupón, cuotas e importe (suman al total). */
export function RenglonesCupones({ tarjetas, cupones, onCambiar }: { tarjetas: Tarjeta[]; cupones: CuponEditable[]; onCambiar: (c: CuponEditable[]) => void }) {
  const activas = tarjetas.filter((t) => t.activa);
  const cambiar = (i: number, c: Partial<CuponEditable>) => onCambiar(cupones.map((x, j) => (j === i ? { ...x, ...c } : x)));
  return (
    <>
      <Group justify="space-between" mt="sm"><Text fw={500}>Tarjetas</Text>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} disabled={!activas.length} onClick={() => onCambiar([...cupones, { tarjetaId: activas[0]?.id ?? null, lote: '', numero: '', cuotas: 1, importe: '' }])}>Agregar cupón</Button></Group>
      {cupones.map((c, i) => (
        <Group key={i} gap="xs" mt={4}>
          <Select size="xs" w={200} aria-label="Tarjeta" data={activas.map((t) => ({ value: t.id, label: t.nombre }))} value={c.tarjetaId} onChange={(v) => cambiar(i, { tarjetaId: v })} />
          <TextInput size="xs" w={90} aria-label="Lote" placeholder="Lote" value={c.lote} onChange={(e) => cambiar(i, { lote: e.currentTarget.value })} />
          <TextInput size="xs" w={110} aria-label="Número de cupón" placeholder="Cupón" value={c.numero} onChange={(e) => cambiar(i, { numero: e.currentTarget.value })} />
          <NumberInput size="xs" w={80} aria-label="Cuotas" min={1} max={60} value={c.cuotas} onChange={(v) => cambiar(i, { cuotas: Number(v) || 1 })} />
          <TextInput size="xs" w={130} aria-label="Importe del cupón" inputMode="decimal" value={c.importe} onChange={(e) => cambiar(i, { importe: e.currentTarget.value })} />
          <ActionIcon variant="subtle" color="red" aria-label="Quitar cupón" onClick={() => onCambiar(cupones.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
        </Group>
      ))}
    </>
  );
}

/** Cupones para enviar a la API (los vacíos se descartan). */
export const cuponesParaApi = (cs: CuponEditable[]) => cs.filter((c) => c.tarjetaId && n0(c.importe) > 0)
  .map((c) => ({ tarjetaId: c.tarjetaId!, lote: c.lote || null, numero: c.numero || null, cuotas: c.cuotas || 1, importe: n0(c.importe) }));
export const totalCupones = (cs: CuponEditable[]) => cs.reduce((s, c) => s + n0(c.importe), 0);

/** Diferencia entre el bruto menos los descuentos y el neto (redondeada al centavo). */
export function diferenciaLiquidacion(d: { bruto: number; arancel: number; ivaArancel: number; costoFinanciero: number; ivaCostoFinanciero: number; impuestos: number[]; neto: number }): number {
  const centavos = Math.round(d.bruto * 100) - Math.round(d.arancel * 100) - Math.round(d.ivaArancel * 100) - Math.round(d.costoFinanciero * 100) - Math.round(d.ivaCostoFinanciero * 100)
    - d.impuestos.reduce((s, x) => s + Math.round(x * 100), 0) - Math.round(d.neto * 100);
  return Math.abs(centavos) / 100;
}

export interface DatosLiquidacionWeb { cuponIds: string[]; arancel: number; ivaArancel: number; costoFinanciero: number; ivaCostoFinanciero: number; impuestos: { clase: string; tipo: string; jurisdiccion: string | null; importe: number }[]; neto: number; fecha: string; referencia: string | null }

/** Liquidación: cupones tildados, descuentos, impuestos sufridos y neto, con la diferencia en vivo. */
export function FormLiquidacion({ cupones, onConfirmar, enviando }: { cupones: CuponPendiente[]; onConfirmar: (d: DatosLiquidacionWeb) => void; enviando?: boolean }) {
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [v, setV] = useState({ arancel: '', ivaArancel: '', costoFinanciero: '', ivaCostoFinanciero: '', neto: '', fecha: hoy(), referencia: '' });
  const [impuestos, setImpuestos] = useState<ImpuestoEditable[]>([]);
  // Un cupón que sale de la lista (p. ej. al refrescar) se destilda: si vuelve, no reaparece tildado
  useEffect(() => { setElegidos((x) => (x.every((id) => cupones.some((c) => c.id === id)) ? x : x.filter((id) => cupones.some((c) => c.id === id)))); }, [cupones]);
  // Solo cuentan los tildados que siguen pendientes (un refresco puede sacar los que ya se liquidaron)
  const vigentes = elegidos.filter((id) => cupones.some((c) => c.id === id));
  const bruto = cupones.filter((c) => vigentes.includes(c.id)).reduce((s, c) => s + Number(c.importe), 0);
  const dif = diferenciaLiquidacion({ bruto, arancel: n0(v.arancel), ivaArancel: n0(v.ivaArancel), costoFinanciero: n0(v.costoFinanciero), ivaCostoFinanciero: n0(v.ivaCostoFinanciero), impuestos: impuestos.map((i) => n0(i.importe)), neto: n0(v.neto) });
  const campo = (k: keyof typeof v, etiqueta: string) => <TextInput label={etiqueta} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.currentTarget.value })} />;
  const cambiarImp = (i: number, c: Partial<ImpuestoEditable>) => setImpuestos(impuestos.map((x, j) => (j === i ? { ...x, ...c } : x)));
  return (
    <Stack>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Fecha</Table.Th><Table.Th>Cupón</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Cliente</Table.Th><Table.Th ta="right">Cuotas</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {cupones.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td><Checkbox aria-label={`Cupón ${c.numero ?? c.id.slice(0, 6)}`} checked={elegidos.includes(c.id)} onChange={() => setElegidos((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} /></Table.Td>
              <Table.Td>{formatoFecha(c.fecha)}</Table.Td><Table.Td>{c.numero}</Table.Td><Table.Td>{c.lote}</Table.Td><Table.Td>{c.cliente}</Table.Td><Table.Td ta="right">{c.cuotas}</Table.Td><Table.Td ta="right">{formatoMoneda(c.importe)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fw={600}>{`Bruto ${formatoMoneda(bruto)}`}</Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <TextInput type="date" label="Fecha" value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.currentTarget.value })} />
        {campo('referencia', 'Referencia')}
        {campo('arancel', 'Arancel')}{campo('ivaArancel', 'IVA del arancel')}
        {campo('costoFinanciero', 'Costo financiero')}{campo('ivaCostoFinanciero', 'IVA del costo financiero')}
      </SimpleGrid>
      <Group justify="space-between"><Text fw={500}>Retenciones y percepciones sufridas</Text>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setImpuestos([...impuestos, { clase: 'RETENCION', tipo: 'IVA', jurisdiccion: '', importe: '' }])}>Agregar</Button></Group>
      {impuestos.map((imp, i) => (
        <Group key={i} gap="xs">
          <Select size="xs" w={140} aria-label="Clase" data={[{ value: 'RETENCION', label: 'Retención' }, { value: 'PERCEPCION', label: 'Percepción' }]} value={imp.clase} onChange={(x) => cambiarImp(i, { clase: (x ?? 'RETENCION') as ImpuestoEditable['clase'] })} />
          <Select size="xs" w={130} aria-label="Impuesto" data={['IVA', 'GANANCIAS', 'IIBB']} value={imp.tipo} onChange={(x) => cambiarImp(i, { tipo: (x ?? 'IVA') as ImpuestoEditable['tipo'] })} />
          {imp.tipo === 'IIBB' && <TextInput size="xs" w={100} aria-label="Jurisdicción" placeholder="902" value={imp.jurisdiccion} onChange={(e) => cambiarImp(i, { jurisdiccion: e.currentTarget.value })} />}
          <TextInput size="xs" w={130} aria-label="Importe del impuesto" inputMode="decimal" value={imp.importe} onChange={(e) => cambiarImp(i, { importe: e.currentTarget.value })} />
          <ActionIcon variant="subtle" color="red" aria-label="Quitar impuesto" onClick={() => setImpuestos(impuestos.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
        </Group>
      ))}
      <Group align="flex-end" justify="space-between">
        <TextInput label="Neto acreditado" inputMode="decimal" value={v.neto} onChange={(e) => setV({ ...v, neto: e.currentTarget.value })} w={200} />
        <Text fw={700} c={dif ? 'red' : 'green'}>{`Diferencia ${formatoMoneda(dif)}`}</Text>
        <Button disabled={!vigentes.length || dif !== 0 || n0(v.neto) <= 0} loading={enviando} onClick={() => onConfirmar({
          cuponIds: vigentes, arancel: n0(v.arancel), ivaArancel: n0(v.ivaArancel), costoFinanciero: n0(v.costoFinanciero), ivaCostoFinanciero: n0(v.ivaCostoFinanciero),
          impuestos: impuestos.filter((x) => n0(x.importe) > 0).map((x) => ({ clase: x.clase, tipo: x.tipo, jurisdiccion: x.tipo === 'IIBB' ? x.jurisdiccion || null : null, importe: n0(x.importe) })),
          neto: n0(v.neto), fecha: v.fecha, referencia: v.referencia || null,
        })}>Confirmar liquidación</Button>
      </Group>
    </Stack>
  );
}

export function CuponesTarjetasPage() {
  const tarjetas = useTarjetas();
  const [tarjetaId, setTarjetaId] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>('PENDIENTE');
  const q = useQuery({ queryKey: ['/tesoreria/cupones', tarjetaId, estado], queryFn: () => api<{ cupones: CuponPendiente[]; totales: { tarjetaId: string; tarjeta: string; cantidad: number; importe: string }[] }>('/tesoreria/cupones', { query: { tarjetaId, estado } }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Cupones de tarjetas</Title>
        <Group>
          <Select clearable placeholder="Todas las tarjetas" data={tarjetas.map((t) => ({ value: t.id, label: t.nombre }))} value={tarjetaId} onChange={setTarjetaId} aria-label="Tarjeta" />
          <Select clearable data={[{ value: 'PENDIENTE', label: 'Pendientes' }, { value: 'LIQUIDADO', label: 'Liquidados' }, { value: 'ANULADO', label: 'Anulados' }]} value={estado} onChange={setEstado} aria-label="Estado" />
        </Group>
      </Group>
      {errorConsulta(q.error)}
      <Group mb="sm">{(q.data?.totales ?? []).map((t) => <Badge key={t.tarjetaId} size="lg" variant="light">{t.tarjeta}: {t.cantidad} · {formatoMoneda(t.importe)}</Badge>)}</Group>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Tarjeta</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Cupón</Table.Th><Table.Th ta="right">Cuotas</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Días</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data?.cupones ?? []).map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>{formatoFecha(c.fecha)}</Table.Td><Table.Td>{c.tarjeta}</Table.Td><Table.Td>{c.cliente}</Table.Td><Table.Td>{c.lote}</Table.Td><Table.Td>{c.numero}</Table.Td>
              <Table.Td ta="right">{c.cuotas}</Table.Td><Table.Td ta="right">{formatoMoneda(c.importe)}</Table.Td><Table.Td ta="right">{c.dias}</Table.Td><Table.Td>{c.estado}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

interface LiquidacionLista { id: string; numero: number; fecha: string; tarjeta: string; bruto: string; neto: string; estado: string; referencia: string | null }

export function LiquidacionesTarjetaPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const tarjetas = useTarjetas();
  const [tarjetaId, setTarjetaId] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const lista = useQuery({ queryKey: ['/tesoreria/liquidaciones-tarjeta'], queryFn: () => api<LiquidacionLista[]>('/tesoreria/liquidaciones-tarjeta') });
  const pendientes = useQuery({ queryKey: ['/tesoreria/cupones', tarjetaId, 'PENDIENTE'], enabled: !!tarjetaId, queryFn: () => api<{ cupones: CuponPendiente[] }>('/tesoreria/cupones', { query: { tarjetaId, estado: 'PENDIENTE' } }) });
  const refrescar = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/tesoreria') });
  const confirmar = async (d: DatosLiquidacionWeb) => {
    if (await op.ejecutar(() => api('/tesoreria/liquidaciones-tarjeta', { metodo: 'POST', body: { ...d, tarjetaId } }), () => 'Liquidación registrada')) { setNueva(false); refrescar(); }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Liquidaciones de tarjetas</Title>
        {puede('tesoreria.tarjetas') && <Button size="xs" onClick={() => setNueva(true)}>Nueva liquidación</Button>}
      </Group>
      {op.alerta}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Tarjeta</Table.Th><Table.Th>Referencia</Table.Th><Table.Th ta="right">Bruto</Table.Th><Table.Th ta="right">Neto</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(lista.data ?? []).map((l) => (
            <Table.Tr key={l.id}>
              <Table.Td>{l.numero}</Table.Td><Table.Td>{formatoFecha(l.fecha)}</Table.Td><Table.Td>{l.tarjeta}</Table.Td><Table.Td>{l.referencia}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(l.bruto)}</Table.Td><Table.Td ta="right">{formatoMoneda(l.neto)}</Table.Td>
              <Table.Td>{l.estado === 'ANULADO' ? <Badge color="gray" variant="light">Anulada</Badge> : <Badge color="green" variant="light">Confirmada</Badge>}</Table.Td>
              <Table.Td>{puede('tesoreria.tarjetas') && l.estado !== 'ANULADO' && (
                <Button size="compact-xs" variant="subtle" color="red" disabled={op.enviando} onClick={async () => {
                  const motivo = window.prompt('Motivo de la anulación');
                  if (motivo && (await op.ejecutar(() => api(`/tesoreria/liquidaciones-tarjeta/${l.id}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Liquidación anulada'))) refrescar();
                }}>Anular</Button>
              )}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={nueva} onClose={() => setNueva(false)} size="xl" title="Nueva liquidación de tarjeta">
        <Stack>
          <Select label="Tarjeta" data={tarjetas.map((t) => ({ value: t.id, label: t.nombre }))} value={tarjetaId} onChange={setTarjetaId} />
          {tarjetaId && <FormLiquidacion key={tarjetaId} cupones={pendientes.data?.cupones ?? []} onConfirmar={confirmar} enviando={op.enviando} />}
          {op.alerta}
        </Stack>
      </Modal>
    </Paper>
  );
}

interface FilaCosto { tarjetaId: string; tarjeta: string; bruto: string; comisiones: string; iva: string; impuestos: string; neto: string; costoPct: string; descuentoTotalPct: string }

export function CostoTarjetasPage() {
  const [desde, setDesde] = useState(`${hoy().slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy());
  const q = useQuery({ queryKey: ['/tesoreria/tarjetas/costo', desde, hasta], enabled: !!desde && !!hasta, queryFn: () => api<FilaCosto[]>('/tesoreria/tarjetas/costo', { query: { desde, hasta } }) });
  const pct = (s: string) => `${Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2 })} %`;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Costo por tarjeta</Title>
        <Group>
          <TextInput type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
          <TextInput type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/tesoreria/tarjetas/costo', { desde, hasta, formato: 'xlsx' }, `costo-tarjetas-${desde}-${hasta}.xlsx`)}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/tesoreria/tarjetas/costo', { desde, hasta, formato: 'pdf' }, `costo-tarjetas-${desde}-${hasta}.pdf`)}>PDF</Button>
        </Group>
      </Group>
      {errorConsulta(q.error)}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Tarjeta</Table.Th><Table.Th ta="right">Bruto</Table.Th><Table.Th ta="right">Comisiones</Table.Th><Table.Th ta="right">IVA</Table.Th><Table.Th ta="right">Retenciones y percepciones</Table.Th><Table.Th ta="right">Neto</Table.Th><Table.Th ta="right">Costo %</Table.Th><Table.Th ta="right">Descuento total %</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((f) => (
            <Table.Tr key={f.tarjetaId}>
              <Table.Td>{f.tarjeta}</Table.Td><Table.Td ta="right">{formatoMoneda(f.bruto)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.comisiones)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.iva)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.impuestos)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.neto)}</Table.Td><Table.Td ta="right">{pct(f.costoPct)}</Table.Td><Table.Td ta="right">{pct(f.descuentoTotalPct)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/** Maestro de tarjetas. */
export function TarjetasMaestroPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const tarjetas = useTarjetas();
  const cuentas = useCuentasBancarias().filter((c) => c.monedaCodigo === 'ARS');
  const [form, setForm] = useState<{ id?: string; nombre: string; tipo: string; cuentaBancariaId: string | null; activa: boolean } | null>(null);
  const guardar = async () => {
    if (!form) return;
    const body = { nombre: form.nombre, tipo: form.tipo, cuentaBancariaId: form.cuentaBancariaId, activa: form.activa };
    if (await op.ejecutar(() => api(form.id ? `/tesoreria/tarjetas/${form.id}` : '/tesoreria/tarjetas', { metodo: form.id ? 'PUT' : 'POST', body }), () => 'Tarjeta guardada')) { setForm(null); void qc.invalidateQueries({ queryKey: ['/tesoreria/tarjetas'] }); }
  };
  const tipos: Record<string, string> = { CREDITO: 'Crédito', DEBITO: 'Débito', QR: 'QR / billetera' };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md"><Title order={3}>Tarjetas</Title><Button size="xs" onClick={() => setForm({ nombre: '', tipo: 'CREDITO', cuentaBancariaId: cuentas[0]?.id ?? null, activa: true })}>Nueva tarjeta</Button></Group>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Nombre</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {tarjetas.map((t) => (
            <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setForm({ id: t.id, nombre: t.nombre, tipo: t.tipo ?? 'CREDITO', cuentaBancariaId: t.cuentaBancariaId ?? null, activa: t.activa })}>
              <Table.Td>{t.nombre}</Table.Td><Table.Td>{tipos[t.tipo ?? ''] ?? t.tipo}</Table.Td>
              <Table.Td>{t.activa ? <Badge color="green" variant="light">Activa</Badge> : <Badge color="gray" variant="light">Inactiva</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar tarjeta' : 'Nueva tarjeta'}>
        {form && (
          <Stack>
            <TextInput label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.currentTarget.value })} />
            <Select label="Tipo" data={Object.entries(tipos).map(([value, label]) => ({ value, label }))} value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v ?? 'CREDITO' })} />
            <Select label="Acredita en" data={opcionesCuentas(cuentas)} value={form.cuentaBancariaId} onChange={(v) => setForm({ ...form, cuentaBancariaId: v })} />
            <Checkbox label="Activa" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.currentTarget.checked })} />
            {op.alerta}
            <Button onClick={guardar} loading={op.enviando} disabled={!form.nombre || !form.cuentaBancariaId}>Guardar</Button>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}

