import { Alert, Badge, Button, Checkbox, Group, MultiSelect, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { api, descargar, ErrorApi } from '../api/cliente';
import { hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { useClientes, usePuntosVenta } from './comun';

/** Facturación por lotes (E55): una factura por cliente con sus remitos pendientes. */

export interface GrupoLote {
  terceroId: string; razonSocial: string; cuit: string; letra: string; monedaCodigo: 'ARS' | 'USD'; cotizacion: string | null; remitos: string[]; total: string; problemas: string[]; avisos: string[];
  renglones: { remitoRenglonId: string; pedidoRenglonId: string | null; numero: string; articuloId: string | null; descripcion: string; cantidad: string; precioUnitario: string | null; bonificacionPct: string; alicuota: string; importe: string | null }[];
}
export interface ItemLote { id: string; razonSocial: string; monedaCodigo: string; factura: string | null; resultado: 'PENDIENTE' | 'EMITIDA' | 'SIN_CAE' | 'ERROR' | 'OMITIDO'; fce: boolean; mensaje: string | null; total: string }
export interface Lote { id: string; numero: number; estado: 'EN_CURSO' | 'TERMINADO' | 'INTERRUMPIDO'; emitidas: number; sinCae: number; errores: number; omitidas: number; items: ItemLote[]; fecha?: string; creadoEn?: string }

const RESULTADOS: Record<ItemLote['resultado'], { etiqueta: string; color: string }> = {
  PENDIENTE: { etiqueta: 'Pendiente', color: 'gray' }, EMITIDA: { etiqueta: 'Emitida', color: 'green' }, SIN_CAE: { etiqueta: 'Sin CAE', color: 'orange' },
  ERROR: { etiqueta: 'Error', color: 'red' }, OMITIDO: { etiqueta: 'Omitido', color: 'gray' },
};
const ESTADOS_LOTE: Record<Lote['estado'], string> = { EN_CURSO: 'En curso', TERMINADO: 'Terminado', INTERRUMPIDO: 'Interrumpido' };
const clave = (g: GrupoLote) => `${g.terceroId}|${g.monedaCodigo}`;
const importe = (s: string | number) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TablaVistaPrevia({ grupos, elegidos, onChange }: { grupos: GrupoLote[]; elegidos: string[]; onChange: (e: string[]) => void }) {
  const [abiertos, setAbiertos] = useState<string[]>([]);
  if (!grupos.length) return <Text size="sm" c="dimmed">No hay remitos pendientes de facturar con esos filtros.</Text>;
  return (
    <Table withTableBorder>
      <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Cliente</Table.Th><Table.Th>Letra</Table.Th><Table.Th>Moneda</Table.Th><Table.Th>Remitos</Table.Th><Table.Th ta="right">Total estimado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {grupos.map((g) => {
          const k = clave(g);
          const abierto = abiertos.includes(k);
          return (
            <Fragment key={k}>
              <Table.Tr>
                <Table.Td><Checkbox aria-label={`Elegir ${g.razonSocial}`} disabled={!!g.problemas.length || !g.renglones.length} checked={elegidos.includes(k)} onChange={(e) => onChange(e.currentTarget.checked ? [...elegidos, k] : elegidos.filter((x) => x !== k))} /></Table.Td>
                <Table.Td>
                  {g.razonSocial}
                  {g.problemas.map((p) => <Text key={p} size="xs" c="red">{p}</Text>)}
                  {g.avisos.map((a) => <Text key={a} size="xs" c="orange">{a}</Text>)}
                </Table.Td>
                <Table.Td>{g.letra}</Table.Td>
                <Table.Td>{g.monedaCodigo}</Table.Td>
                <Table.Td>{g.remitos.join(', ')}</Table.Td>
                <Table.Td ta="right">{g.monedaCodigo === 'USD' ? 'US$ ' : '$ '}{importe(g.total)}</Table.Td>
                <Table.Td>{!!g.renglones.length && <Button size="compact-xs" variant="subtle" onClick={() => setAbiertos(abierto ? abiertos.filter((x) => x !== k) : [...abiertos, k])}>{abierto ? 'Ocultar' : 'Renglones'}</Button>}</Table.Td>
              </Table.Tr>
              {abierto && g.renglones.map((r) => (
                <Table.Tr key={r.remitoRenglonId} bg="var(--mantine-color-gray-0)">
                  <Table.Td /><Table.Td colSpan={2}>{r.numero} · {r.descripcion}</Table.Td>
                  <Table.Td>{Number(r.cantidad).toLocaleString('es-AR')}</Table.Td>
                  <Table.Td>{r.precioUnitario ? importe(r.precioUnitario) : '—'}{Number(r.bonificacionPct) ? ` (−${Number(r.bonificacionPct)} %)` : ''}</Table.Td>
                  <Table.Td ta="right">{r.importe ? importe(r.importe) : '—'}</Table.Td><Table.Td />
                </Table.Tr>
              ))}
            </Fragment>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

export function BotonGenerar({ cantidad, onClick, loading }: { cantidad: number; onClick: () => void; loading?: boolean }) {
  return <Button loading={loading} disabled={!cantidad} onClick={onClick}>{`Generar ${cantidad} ${cantidad === 1 ? 'factura' : 'facturas'}`}</Button>;
}

export function ResultadoLote({ lote }: { lote: Lote }) {
  return (
    <Stack gap="xs">
      <Group>
        <Text fw={600}>Lote N° {lote.numero} · {ESTADOS_LOTE[lote.estado]}</Text>
        <Text size="sm" c="dimmed">Emitidas {lote.emitidas} · Sin CAE {lote.sinCae} · Con error {lote.errores} · Omitidas {lote.omitidas}</Text>
        {lote.emitidas > 0 && <Button size="compact-xs" variant="default" onClick={() => void descargar(`/ventas/facturacion-lotes/${lote.id}/pdf`, {}, `lote-facturacion-${lote.numero}.pdf`)}>PDF del lote</Button>}
      </Group>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Cliente</Table.Th><Table.Th>Factura</Table.Th><Table.Th>Resultado</Table.Th><Table.Th>Detalle</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {lote.items.map((i) => (
            <Table.Tr key={i.id}>
              <Table.Td>{i.razonSocial}</Table.Td>
              <Table.Td>{i.factura ?? '—'}{i.fce && <Badge ml={6} size="xs">FCE</Badge>}</Table.Td>
              <Table.Td><Badge color={RESULTADOS[i.resultado].color} variant="light">{RESULTADOS[i.resultado].etiqueta}</Badge></Table.Td>
              <Table.Td>{i.mensaje}</Table.Td>
              <Table.Td ta="right">{i.monedaCodigo === 'USD' ? 'US$ ' : '$ '}{importe(i.total)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function LotesAnteriores({ onVer }: { onVer: (id: string) => void }) {
  const lotes = useQuery({ queryKey: ['/ventas/facturacion-lotes'], queryFn: () => api<(Omit<Lote, 'items'> & { fecha: string; creadoEn: string })[]>('/ventas/facturacion-lotes') }).data ?? [];
  if (!lotes.length) return null;
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={4} mb="sm">Lotes anteriores</Title>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Estado</Table.Th><Table.Th>Emitidas</Table.Th><Table.Th>Sin CAE</Table.Th><Table.Th>Con error</Table.Th><Table.Th>Omitidas</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {lotes.map((l) => (
            <Table.Tr key={l.id}>
              <Table.Td>{l.numero}</Table.Td><Table.Td>{l.fecha.slice(0, 10).split('-').reverse().join('/')}</Table.Td><Table.Td>{ESTADOS_LOTE[l.estado]}</Table.Td>
              <Table.Td>{l.emitidas}</Table.Td><Table.Td>{l.sinCae}</Table.Td><Table.Td>{l.errores}</Table.Td><Table.Td>{l.omitidas}</Table.Td>
              <Table.Td><Button size="compact-xs" variant="subtle" onClick={() => onVer(l.id)}>{`Ver lote ${l.numero}`}</Button></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

export function FacturacionLotesPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const clientes = useClientes();
  const puntos = usePuntosVenta();
  const [hasta, setHasta] = useState(hoy());
  const [fecha, setFecha] = useState(hoy());
  const [puntoVentaId, setPuntoVentaId] = useState<string | null>(null);
  const [terceroIds, setTerceroIds] = useState<string[]>([]);
  const [grupos, setGrupos] = useState<GrupoLote[] | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [lote, setLote] = useState<Lote | null>(null);
  useEffect(() => { if (!puntoVentaId && puntos.length) setPuntoVentaId(puntos.find((p) => p.electronico)?.id ?? puntos[0].id); }, [puntos, puntoVentaId]);

  /** Consulta sin notificación de éxito: el error va a la alerta de la pantalla. */
  const consultar = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    op.setError('');
    try {
      return await fn();
    } catch (e) {
      op.setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      return null;
    }
  };
  const ver = async () => {
    setLote(null);
    const g = await consultar(() => api<GrupoLote[]>('/ventas/facturacion-lotes/vista-previa', { query: { hasta, fecha, ...(terceroIds.length ? { terceroIds: terceroIds.join(',') } : {}) } }));
    if (g) { setGrupos(g); setElegidos(g.filter((x) => !x.problemas.length && x.renglones.length).map(clave)); }
  };
  const generar = async () => {
    const ids = [...new Set(elegidos.map((k) => k.split('|')[0]))];
    const r = await op.ejecutar(() => api<Lote>('/ventas/facturacion-lotes', { metodo: 'POST', body: { hasta, fecha, puntoVentaId, terceroIds: ids } }), (l) => `Lote N° ${l.numero}: ${l.emitidas} facturas emitidas`);
    if (r) {
      setLote(r); setGrupos(null);
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/ventas') });
    }
  };
  const verLote = async (id: string) => {
    const r = await consultar(() => api<Lote>(`/ventas/facturacion-lotes/${id}`));
    if (r) { setLote(r); setGrupos(null); }
  };

  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Facturación por lotes</Title>
        <Group align="flex-end" mb="md">
          <TextInput label="Remitos hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
          <Select label="Punto de venta" w={170} data={puntos.map((p) => ({ value: p.id, label: String(p.numero).padStart(4, '0') }))} value={puntoVentaId} onChange={setPuntoVentaId} />
          <TextInput label="Fecha de emisión" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <MultiSelect label="Clientes" placeholder={terceroIds.length ? undefined : 'Todos'} w={340} searchable clearable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroIds} onChange={setTerceroIds} />
          <Button variant="default" onClick={() => void ver()}>Ver</Button>
        </Group>
        {grupos && <TablaVistaPrevia grupos={grupos} elegidos={elegidos} onChange={setElegidos} />}
        {op.alerta}
        {grupos && !!grupos.length && (
          <Group justify="space-between" mt="md">
            <Text size="sm" c="dimmed">Las facturas se emiten en ARCA de a una; si un cliente falla, los demás siguen.</Text>
            <BotonGenerar cantidad={elegidos.length} loading={op.enviando} onClick={() => void generar()} />
          </Group>
        )}
        {lote && <Alert color={lote.errores || lote.sinCae ? 'orange' : 'green'} mt="md" p="sm"><ResultadoLote lote={lote} /></Alert>}
      </Paper>
      <LotesAnteriores onVer={(id) => void verLote(id)} />
    </Stack>
  );
}
