import { ActionIcon, Button, Group, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { ALICUOTAS_IVA, calcularTotales, EntradaTotales, importeRenglon } from '@gestion/shared';
import { Fragment } from 'react';
import { Opcion } from '../abm/tipos';
import { BienRenglon, CamposBien, Rubro } from '../bienes-uso/comun';
import { formatoMoneda } from './formato';

export interface RenglonEditable {
  articuloId?: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  bonificacionPct: string;
  alicuotaIva: string;
  centroCostoId?: string | null;
  cuentaContableId?: string | null;
  soloLectura?: ('cantidad' | 'precioUnitario' | 'articuloId')[];
  origen?: unknown;
  etiqueta?: string;
  /** Datos del bien de uso cuando la cuenta es la de un rubro. */
  bien?: BienRenglon;
}

export interface ArticuloGrilla { id: string; codigo: string; descripcion: string; alicuotaIva: string | number }

export const renglonVacio = (): RenglonEditable => ({ descripcion: '', cantidad: '1', precioUnitario: '0', bonificacionPct: '0', alicuotaIva: '21' });

/** Importe del renglón o null si los valores no son válidos. */
export function importeSeguro(r: RenglonEditable): string | null {
  try {
    return importeRenglon(r);
  } catch {
    return null;
  }
}

/** Totales calculados con los renglones válidos. */
export type ExtrasTotales = Omit<EntradaTotales, 'renglones' | 'discriminaIva'>;

export function totalesGrilla(renglones: RenglonEditable[], discriminaIva: boolean, extras: ExtrasTotales = {}) {
  const validos = renglones.map((r) => ({ importe: importeSeguro(r), alicuotaIva: r.alicuotaIva })).filter((r): r is { importe: string; alicuotaIva: string } => r.importe !== null);
  return calcularTotales({ discriminaIva, renglones: validos, ...extras });
}

const ALICUOTAS: Opcion[] = ALICUOTAS_IVA.map((a) => ({ value: String(a), label: `${String(a).replace('.', ',')} %` }));
const limpiar = (v: string) => v.replace(',', '.');

export interface PropsGrilla {
  renglones: RenglonEditable[];
  onChange: (r: RenglonEditable[]) => void;
  discriminaIva: boolean;
  articulos: ArticuloGrilla[];
  centrosCosto: { id: string; codigo: string; nombre: string }[];
  cuentas?: Opcion[];
  mostrarCuenta?: boolean;
  moneda?: string;
  permitirAgregar?: boolean;
  extrasTotales?: ExtrasTotales;
  /** Rubros de bienes de uso: un renglón a su cuenta pide los datos del bien. */
  rubros?: Rubro[];
}

export function GrillaRenglones({
  renglones, onChange, discriminaIva, articulos, centrosCosto, cuentas = [], mostrarCuenta, moneda = 'ARS', permitirAgregar = true, extrasTotales, rubros = [],
}: PropsGrilla) {
  const rubroDe = (r: RenglonEditable) => (mostrarCuenta && r.cuentaContableId ? rubros.find((x) => x.cuentaOrigenId === r.cuentaContableId) : undefined);
  const cambiar = (i: number, cambios: Partial<RenglonEditable>) => onChange(renglones.map((r, j) => (j === i ? { ...r, ...cambios } : r)));
  const opcionesArticulo = articulos.map((a) => ({ value: a.id, label: `${a.codigo} - ${a.descripcion}` }));
  const opcionesCentro = centrosCosto.map((c) => ({ value: c.id, label: `${c.codigo} - ${c.nombre}` }));
  const tot = totalesGrilla(renglones, discriminaIva, extrasTotales);
  const bloqueado = (r: RenglonEditable, campo: 'cantidad' | 'precioUnitario' | 'articuloId') => !!r.soloLectura?.includes(campo);

  return (
    <Stack gap="xs">
      <ScrollArea>
        <Table withTableBorder verticalSpacing={4} miw={mostrarCuenta ? 1100 : 950}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={200}>Artículo</Table.Th>
              <Table.Th>Descripción</Table.Th>
              <Table.Th w={90}>Cantidad</Table.Th>
              <Table.Th w={110}>Precio unit.</Table.Th>
              <Table.Th w={70}>Bonif. %</Table.Th>
              <Table.Th w={95}>IVA</Table.Th>
              {mostrarCuenta && <Table.Th w={200}>Cuenta contable</Table.Th>}
              <Table.Th w={150}>Centro de costo</Table.Th>
              <Table.Th w={120} ta="right">Importe</Table.Th>
              <Table.Th w={36} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {renglones.map((r, i) => {
              const imp = importeSeguro(r);
              const rubro = rubroDe(r);
              return (
                <Fragment key={i}>
                <Table.Tr>
                  <Table.Td>
                    {r.etiqueta && <Text size="xs" c="dimmed">{r.etiqueta}</Text>}
                    <Select
                      size="xs" aria-label="Artículo" searchable clearable data={opcionesArticulo} value={r.articuloId ?? null} disabled={bloqueado(r, 'articuloId')}
                      onChange={(id) => {
                        const a = articulos.find((x) => x.id === id);
                        cambiar(i, a ? { articuloId: a.id, descripcion: a.descripcion, alicuotaIva: String(Number(a.alicuotaIva)) } : { articuloId: null });
                      }}
                    />
                  </Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Descripción" value={r.descripcion} onChange={(e) => cambiar(i, { descripcion: e.currentTarget.value })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Cantidad" inputMode="decimal" value={r.cantidad} disabled={bloqueado(r, 'cantidad')} onChange={(e) => cambiar(i, { cantidad: limpiar(e.currentTarget.value) })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Precio unitario" inputMode="decimal" value={r.precioUnitario} disabled={bloqueado(r, 'precioUnitario')} onChange={(e) => cambiar(i, { precioUnitario: limpiar(e.currentTarget.value) })} /></Table.Td>
                  <Table.Td><TextInput size="xs" aria-label="Bonificación" inputMode="decimal" value={r.bonificacionPct} onChange={(e) => cambiar(i, { bonificacionPct: limpiar(e.currentTarget.value) })} /></Table.Td>
                  <Table.Td><Select size="xs" aria-label="Alícuota IVA" data={ALICUOTAS} value={String(Number(r.alicuotaIva))} onChange={(v) => v && cambiar(i, { alicuotaIva: v })} allowDeselect={false} /></Table.Td>
                  {mostrarCuenta && (
                    <Table.Td><Select size="xs" aria-label="Cuenta contable" searchable clearable data={cuentas} value={r.cuentaContableId ?? null} placeholder="Por defecto" onChange={(v) => cambiar(i, { cuentaContableId: v })} /></Table.Td>
                  )}
                  <Table.Td><Select size="xs" aria-label="Centro de costo" clearable data={opcionesCentro} value={r.centroCostoId ?? null} onChange={(v) => cambiar(i, { centroCostoId: v })} /></Table.Td>
                  <Table.Td ta="right"><Text size="sm">{imp === null ? '—' : formatoMoneda(imp, moneda)}</Text></Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label="Quitar renglón" onClick={() => onChange(renglones.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
                  </Table.Td>
                </Table.Tr>
                {rubro && (
                  <Table.Tr>
                    <Table.Td colSpan={mostrarCuenta ? 10 : 9}>
                      <CamposBien rubro={rubro} valor={r.bien ?? { descripcion: r.descripcion, vidaUtilMeses: '', valorResidual: '' }} onChange={(bien) => cambiar(i, { bien })} />
                    </Table.Td>
                  </Table.Tr>
                )}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        {permitirAgregar ? (
          <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => onChange([...renglones, renglonVacio()])}>Agregar renglón</Button>
        ) : <span />}
        <Stack gap={2} align="flex-end">
          <Text size="sm">Neto: {formatoMoneda(tot.netoGravado, moneda)}</Text>
          {tot.ivaPorAlicuota.map((x) => (
            <Text size="sm" key={x.alicuota}>IVA {x.alicuota.replace('.', ',')} %: {formatoMoneda(x.importe, moneda)}</Text>
          ))}
          {Number(tot.percepciones) !== 0 && <Text size="sm">Percepciones: {formatoMoneda(tot.percepciones, moneda)}</Text>}
          <Text fw={700} data-testid="total-comprobante">Total: {formatoMoneda(tot.total, moneda)}</Text>
        </Stack>
      </Group>
    </Stack>
  );
}
