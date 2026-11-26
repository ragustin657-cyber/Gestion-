import { nombreJurisdiccion } from '@gestion/shared';
import { ActionIcon, Button, Group, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useRef } from 'react';
import { calcularVenta, letraVenta, type AlicuotaVenta, type CondicionIva, type LetraVenta } from '@gestion/shared';
import { formatoMoneda } from '../compras/formato';
import { NOMBRE_TIPO, numero, type TipoVenta } from './comun';

export interface RenglonVentaEditable {
  articuloId: string | null; descripcion: string; cantidad: string; precioUnitario: string; alicuota: string;
  /** E51: % de bonificación del renglón (vacío = 0). */
  bonificacionPct?: string;
  /** Renglones que vienen de un remito o de un pedido (factura). */
  origen?: 'DIRECTO' | 'REMITO' | 'PEDIDO' | 'DEVOLUCION'; remitoRenglonId?: string | null; pedidoRenglonId?: string | null; etiqueta?: string;
  /** E54: renglón de remito de devolución que acredita una nota de crédito. */
  devolucionRenglonId?: string | null;
  /** Venta de un bien de uso (sin artículo, cantidad 1). */
  bienUsoId?: string | null;
  /** E56: la bonificación la escribió el usuario: no se reemplaza por la de la escala (no se manda a la API). */
  bonificacionManual?: boolean;
}
export interface ArticuloVenta { value: string; label: string; descripcion: string; alicuotaIva: string }

export const ALICUOTAS_VENTA = [
  { value: '21', label: '21%' }, { value: '10.5', label: '10,5%' }, { value: '27', label: '27%' }, { value: '5', label: '5%' }, { value: '2.5', label: '2,5%' },
  { value: '0', label: '0%' }, { value: 'EXENTO', label: 'Exento' }, { value: 'NO_GRAVADO', label: 'No gravado' },
];
export const renglonVacio = (): RenglonVentaEditable => ({ articuloId: null, descripcion: '', cantidad: '1', precioUnitario: '', alicuota: '21' });
export const alicuotaDe = (a: string): AlicuotaVenta => (a === 'EXENTO' || a === 'NO_GRAVADO' ? a : (Number(a) as AlicuotaVenta));

/** Aplica un precio sugerido solo si el renglón sigue con ese artículo y sin precio cargado (la respuesta puede llegar tarde). */
export function aplicarPrecioSugerido(renglones: RenglonVentaEditable[], i: number, articuloId: string, precio: string): RenglonVentaEditable[] {
  const r = renglones[i];
  if (!r || r.articuloId !== articuloId || r.precioUnitario !== '') return renglones;
  return renglones.map((x, j) => (j === i ? { ...x, precioUnitario: String(Number(precio)) } : x));
}

/**
 * E56: aplica la bonificación sugerida por la escala solo si el renglón sigue con ese artículo y cantidad, es directo y no
 * tiene bonificación escrita a mano (la respuesta puede llegar tarde); `null` la vacía.
 */
export function aplicarBonificacionSugerida(renglones: RenglonVentaEditable[], i: number, articuloId: string, cantidad: string, pct: string | null): RenglonVentaEditable[] {
  const r = renglones[i];
  if (!r || r.articuloId !== articuloId || r.cantidad !== cantidad || r.bonificacionManual || (r.origen ?? 'DIRECTO') !== 'DIRECTO') return renglones;
  const nuevo = pct ? String(Number(pct)) : '';
  if ((r.bonificacionPct ?? '') === nuevo) return renglones;
  return renglones.map((x, j) => (j === i ? { ...x, bonificacionPct: nuevo } : x));
}

/** Totales del comprobante con el mismo cálculo que el servidor (null si hay renglones incompletos). */
export function totalesVenta(renglones: RenglonVentaEditable[], letra: LetraVenta, descuentoPct = '0') {
  const validos = renglones.filter((r) => numero(r.cantidad) > 0 && numero(r.precioUnitario) > 0);
  const pct = (s: string | undefined) => { const n = numero(s ?? ''); return String(Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 0); };
  return calcularVenta(validos.map((r) => ({ cantidad: String(numero(r.cantidad)), precioUnitario: String(numero(r.precioUnitario)), alicuota: alicuotaDe(r.alicuota), bonificacionPct: pct(r.bonificacionPct) })), letra, String(Math.min(Number(pct(descuentoPct)), 99.99)));
}

/** Renglón para la API (E51: con la bonificación; vacía = 0). */
export const cuerpoRenglonVenta = (r: RenglonVentaEditable) => ({
  origen: r.origen ?? 'DIRECTO', remitoRenglonId: r.remitoRenglonId ?? null, pedidoRenglonId: r.pedidoRenglonId ?? null, devolucionRenglonId: r.devolucionRenglonId ?? null, articuloId: r.articuloId, bienUsoId: r.bienUsoId ?? null,
  descripcion: r.descripcion, cantidad: numero(r.cantidad), precioUnitario: numero(r.precioUnitario), alicuota: alicuotaDe(r.alicuota),
  bonificacionPct: r.bonificacionPct?.trim() ? numero(r.bonificacionPct) : 0,
});

export function TituloComprobante({ tipo, empresa, cliente, letra }: { tipo: TipoVenta; empresa?: CondicionIva | `${CondicionIva}`; cliente?: CondicionIva | `${CondicionIva}`; letra?: string }) {
  let l = letra;
  if (!l && empresa && cliente) {
    try {
      l = letraVenta(empresa, cliente);
    } catch {
      l = '';
    }
  }
  return <Title order={4}>{`${NOMBRE_TIPO[tipo]} ${l ?? ''}`.trim()}</Title>;
}

/** Percepción practicada guardada en el comprobante (E39). */
export interface PercepcionVenta { tipo: string; jurisdiccion: string | null; tramo?: string | null; alicuota: string; importe: string; origenAlicuota: string }
const ORIGEN: Record<string, string> = { PADRON: 'padrón', FICHA: 'ficha', DEFECTO: 'alícuota por defecto', REGIMEN: 'régimen', ASOCIADA: 'comprobante asociado' };
export const etiquetaPercepcion = (p: PercepcionVenta) =>
  `Percepción ${p.tipo === 'IVA' ? 'IVA' : `IIBB ${nombreJurisdiccion(p.jurisdiccion ?? '')}`} ${Number(p.alicuota).toLocaleString('es-AR', { maximumFractionDigits: 4 })} % (${ORIGEN[p.origenAlicuota] ?? p.origenAlicuota})`;

export function GrillaVenta({ renglones, onChange, letra, moneda, articulos, sugerirPrecio, sugerirBonificacion, percepciones, percepcionesDesactualizadas, descuentoPct = '', onDescuento, disabled }: {
  renglones: RenglonVentaEditable[]; onChange: (r: RenglonVentaEditable[]) => void; letra: LetraVenta; moneda: string; articulos: ArticuloVenta[];
  /** Precio de la lista del cliente para el artículo elegido. */
  sugerirPrecio?: (articuloId: string) => Promise<string | null>;
  /** E56: % de la escala de descuento por cantidad (solo pedido y factura). */
  sugerirBonificacion?: (articuloId: string, cantidad: string) => Promise<string | null>;
  /** Percepciones calculadas al guardar (E39); se recalculan al emitir. */
  percepciones?: PercepcionVenta[];
  /** Pulido E42: los renglones cambiaron desde lo guardado: no se suman las percepciones guardadas. */
  percepcionesDesactualizadas?: boolean;
  /** E51: descuento general del comprobante (el pedido no lo tiene). */
  descuentoPct?: string; onDescuento?: (v: string) => void; disabled?: boolean;
}) {
  const cambiar = (i: number, c: Partial<RenglonVentaEditable>) => onChange(renglones.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const ultimos = useRef(renglones);
  ultimos.current = renglones;
  /** E56: consulta la escala para el renglón i con ese artículo y cantidad y la aplica si nada cambió. */
  const bonificar = async (i: number, articuloId: string | null, cantidad: string) => {
    const r = ultimos.current[i];
    if (!sugerirBonificacion || !articuloId || !r || r.bonificacionManual || (r.origen ?? 'DIRECTO') !== 'DIRECTO' || !(numero(cantidad) > 0)) return;
    const pct = await sugerirBonificacion(articuloId, String(numero(cantidad)));
    const nuevos = aplicarBonificacionSugerida(ultimos.current, i, articuloId, cantidad, pct);
    // Se actualiza ya: otra respuesta que llegue antes del próximo render parte de estos renglones (revisión E56)
    if (nuevos !== ultimos.current) { ultimos.current = nuevos; onChange(nuevos); }
  };
  const t = totalesVenta(renglones, letra, descuentoPct || '0');
  const hayDescuento = Number(t.descuentoGeneral) > 0;
  const discrimina = letra !== 'C';
  return (
    <Stack gap="xs">
      <ScrollArea>
        <Table withTableBorder miw={900}>
          <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Descripción</Table.Th><Table.Th w={90}>Cantidad</Table.Th><Table.Th w={130}>Precio unitario</Table.Th><Table.Th w={90}>% Bonif.</Table.Th><Table.Th w={120}>IVA</Table.Th><Table.Th ta="right" w={130}>Neto</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {renglones.map((r, i) => {
              const b = numero(r.bonificacionPct ?? '');
              const neto = numero(r.cantidad) * numero(r.precioUnitario) * (1 - (Number.isFinite(b) ? b : 0) / 100);
              return (
                <Table.Tr key={i}>
                  <Table.Td>{r.etiqueta ? <Text size="xs" fw={600}>{r.etiqueta}</Text> : <Select size="xs" w={180} aria-label="Artículo" searchable clearable placeholder="Texto libre" data={articulos} value={r.articuloId}
                    onChange={async (v) => {
                      const a = articulos.find((x) => x.value === v);
                      if (!a) return cambiar(i, { articuloId: null });
                      const base = { articuloId: v, descripcion: a.descripcion, alicuota: String(Number(a.alicuotaIva)), ...(sugerirPrecio ? { precioUnitario: '' } : {}) };
                      cambiar(i, base);
                      ultimos.current = ultimos.current.map((x, j) => (j === i ? { ...x, ...base } : x));
                      void bonificar(i, v, r.cantidad);
                      const precio = sugerirPrecio && v ? await sugerirPrecio(v) : null;
                      if (precio) {
                        const nuevos = aplicarPrecioSugerido(ultimos.current, i, v!, precio);
                        if (nuevos !== ultimos.current) { ultimos.current = nuevos; onChange(nuevos); }
                      }
                    }} />}</Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Descripción" value={r.descripcion} onChange={(e) => cambiar(i, { descripcion: e.currentTarget.value })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Cantidad" inputMode="decimal" value={r.cantidad} onChange={(e) => { const c = e.currentTarget.value; cambiar(i, { cantidad: c }); ultimos.current = ultimos.current.map((x, j) => (j === i ? { ...x, cantidad: c } : x)); void bonificar(i, r.articuloId, c); }} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Precio unitario" inputMode="decimal" value={r.precioUnitario} onChange={(e) => cambiar(i, { precioUnitario: e.currentTarget.value })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Bonificación %" inputMode="decimal" placeholder="0" value={r.bonificacionPct ?? ''} onChange={(e) => cambiar(i, { bonificacionPct: e.currentTarget.value, bonificacionManual: true })} /></Table.Td>
                  <Table.Td><Select size="xs" aria-label="Alícuota" allowDeselect={false} data={ALICUOTAS_VENTA} value={r.alicuota} onChange={(v) => cambiar(i, { alicuota: v ?? '21' })} /></Table.Td>
                  <Table.Td ta="right">{Number.isFinite(neto) ? formatoMoneda(neto, moneda) : ''}</Table.Td>
                  <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar renglón" onClick={() => onChange(renglones.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify="space-between" align="flex-start">
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => onChange([...renglones, renglonVacio()])}>Agregar renglón</Button>
        <Stack gap={2} align="flex-end">
          {onDescuento && <TextInput size="xs" w={160} label="Descuento general (%)" inputMode="decimal" placeholder="0" value={descuentoPct} disabled={disabled} onChange={(e) => onDescuento(e.currentTarget.value)} />}
          {hayDescuento && <Text size="sm">Subtotal {formatoMoneda(t.subtotal, moneda)}</Text>}
          {hayDescuento && <Group gap={6}><Text size="sm">{`Descuento general ${String(numero(descuentoPct)).replace('.', ',')} %`}</Text><Text size="sm">-{formatoMoneda(t.descuentoGeneral, moneda)}</Text></Group>}
          {discrimina && <Text size="sm">Neto gravado {formatoMoneda(t.netoGravado, moneda)}</Text>}
          {discrimina && t.ivas.map((x) => <Text size="sm" key={x.alicuota}>{`IVA ${String(x.alicuota).replace('.', ',')}%`}</Text>)}
          {discrimina && t.ivas.map((x) => <Text size="xs" c="dimmed" key={`i${x.alicuota}`}>{formatoMoneda(x.importe, moneda)}</Text>)}
          {discrimina && Number(t.exento) > 0 && <Text size="sm">Exento {formatoMoneda(t.exento, moneda)}</Text>}
          {discrimina && Number(t.noGravado) > 0 && <Text size="sm">No gravado {formatoMoneda(t.noGravado, moneda)}</Text>}
          {percepcionesDesactualizadas && (percepciones ?? []).length > 0 && <Text size="xs" c="dimmed">Las percepciones se recalculan al guardar</Text>}
          {(percepcionesDesactualizadas ? [] : percepciones ?? []).map((p) => <Group gap={6} key={`${p.tipo}${p.jurisdiccion ?? ''}${p.tramo ?? ''}${p.alicuota}`}><Text size="sm">{etiquetaPercepcion(p)}</Text><Text size="sm">{formatoMoneda(p.importe, moneda)}</Text></Group>)}
          <Text fw={700} data-testid="total-venta">Total {formatoMoneda(Number(t.total) + (percepcionesDesactualizadas ? [] : percepciones ?? []).reduce((a, p) => a + Number(p.importe), 0), moneda)}</Text>
        </Stack>
      </Group>
    </Stack>
  );
}
