import { ActionIcon, Button, Group, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { calcularVenta, letraVenta, type AlicuotaVenta, type CondicionIva, type LetraVenta } from '@gestion/shared';
import { formatoMoneda } from '../compras/formato';
import { NOMBRE_TIPO, numero, type TipoVenta } from './comun';

export interface RenglonVentaEditable {
  articuloId: string | null; descripcion: string; cantidad: string; precioUnitario: string; alicuota: string;
  /** Renglones que vienen de un remito o de un pedido (factura). */
  origen?: 'DIRECTO' | 'REMITO' | 'PEDIDO'; remitoRenglonId?: string | null; pedidoRenglonId?: string | null; etiqueta?: string;
}
export interface ArticuloVenta { value: string; label: string; descripcion: string; alicuotaIva: string }

export const ALICUOTAS_VENTA = [
  { value: '21', label: '21%' }, { value: '10.5', label: '10,5%' }, { value: '27', label: '27%' }, { value: '5', label: '5%' }, { value: '2.5', label: '2,5%' },
  { value: '0', label: '0%' }, { value: 'EXENTO', label: 'Exento' }, { value: 'NO_GRAVADO', label: 'No gravado' },
];
export const renglonVacio = (): RenglonVentaEditable => ({ articuloId: null, descripcion: '', cantidad: '1', precioUnitario: '', alicuota: '21' });
export const alicuotaDe = (a: string): AlicuotaVenta => (a === 'EXENTO' || a === 'NO_GRAVADO' ? a : (Number(a) as AlicuotaVenta));

/** Totales del comprobante con el mismo cálculo que el servidor (null si hay renglones incompletos). */
export function totalesVenta(renglones: RenglonVentaEditable[], letra: LetraVenta) {
  const validos = renglones.filter((r) => numero(r.cantidad) > 0 && numero(r.precioUnitario) > 0);
  return calcularVenta(validos.map((r) => ({ cantidad: String(numero(r.cantidad)), precioUnitario: String(numero(r.precioUnitario)), alicuota: alicuotaDe(r.alicuota) })), letra);
}

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

export function GrillaVenta({ renglones, onChange, letra, moneda, articulos, sugerirPrecio }: {
  renglones: RenglonVentaEditable[]; onChange: (r: RenglonVentaEditable[]) => void; letra: LetraVenta; moneda: string; articulos: ArticuloVenta[];
  /** Precio de la lista del cliente para el artículo elegido. */
  sugerirPrecio?: (articuloId: string) => Promise<string | null>;
}) {
  const cambiar = (i: number, c: Partial<RenglonVentaEditable>) => onChange(renglones.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const t = totalesVenta(renglones, letra);
  const discrimina = letra !== 'C';
  return (
    <Stack gap="xs">
      <ScrollArea>
        <Table withTableBorder miw={900}>
          <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Descripción</Table.Th><Table.Th w={90}>Cantidad</Table.Th><Table.Th w={130}>Precio unitario</Table.Th><Table.Th w={120}>IVA</Table.Th><Table.Th ta="right" w={130}>Neto</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {renglones.map((r, i) => {
              const neto = numero(r.cantidad) * numero(r.precioUnitario);
              return (
                <Table.Tr key={i}>
                  <Table.Td>{r.etiqueta ? <Text size="xs" fw={600}>{r.etiqueta}</Text> : <Select size="xs" w={180} aria-label="Artículo" searchable clearable placeholder="Texto libre" data={articulos} value={r.articuloId}
                    onChange={async (v) => {
                      const a = articulos.find((x) => x.value === v);
                      if (!a) return cambiar(i, { articuloId: null });
                      const base = { articuloId: v, descripcion: a.descripcion, alicuota: String(Number(a.alicuotaIva)) };
                      cambiar(i, base);
                      const precio = sugerirPrecio && v ? await sugerirPrecio(v) : null;
                      if (precio) onChange(renglones.map((x, j) => (j === i ? { ...x, ...base, precioUnitario: String(Number(precio)) } : x)));
                    }} />}</Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Descripción" value={r.descripcion} onChange={(e) => cambiar(i, { descripcion: e.currentTarget.value })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Cantidad" inputMode="decimal" value={r.cantidad} onChange={(e) => cambiar(i, { cantidad: e.currentTarget.value })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Precio unitario" inputMode="decimal" value={r.precioUnitario} onChange={(e) => cambiar(i, { precioUnitario: e.currentTarget.value })} /></Table.Td>
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
          {discrimina && <Text size="sm">Neto gravado {formatoMoneda(t.netoGravado, moneda)}</Text>}
          {discrimina && t.ivas.map((x) => <Text size="sm" key={x.alicuota}>{`IVA ${String(x.alicuota).replace('.', ',')}%`}</Text>)}
          {discrimina && t.ivas.map((x) => <Text size="xs" c="dimmed" key={`i${x.alicuota}`}>{formatoMoneda(x.importe, moneda)}</Text>)}
          {discrimina && Number(t.exento) > 0 && <Text size="sm">Exento {formatoMoneda(t.exento, moneda)}</Text>}
          {discrimina && Number(t.noGravado) > 0 && <Text size="sm">No gravado {formatoMoneda(t.noGravado, moneda)}</Text>}
          <Text fw={700} data-testid="total-venta">Total {formatoMoneda(t.total, moneda)}</Text>
        </Stack>
      </Group>
    </Stack>
  );
}
