import { Alert, Button, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { descargar } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { descripcionRetencion, numeroCertificado, RetencionOP } from './tipos';

const DETALLE: Record<string, string> = {
  basePago: 'Base del pago', acumuladoPrevio: 'Acumulado previo del mes', acumulado: 'Acumulado', minimoNoSujeto: 'Mínimo no sujeto',
  sujetoRetencion: 'Sujeto a retención', impuestoDeterminado: 'Impuesto determinado', retenidoPrevio: 'Retenido en el mes', origenAlicuota: 'Origen de la alícuota',
  pagado: 'Pagado de la factura', total: 'Total de la factura', fecha: 'Fecha de la factura', exclusion: 'Exclusión (%)',
};
const OCULTOS = new Set(['tipo', 'letra', 'puntoVenta', 'numero', 'exclusionPublicacion']);
// Pulido E49: códigos como texto y marcas como Sí/No (no como importes)
const TEXTO = new Set(['codigoSire', 'codigoAlicuota']);
const MARCAS = new Set(['aplicaCdi', 'acrecentamiento']);
Object.assign(DETALLE, { codigoSire: 'Código SIRE', codigoAlicuota: 'Código de alícuota', aplicaCdi: 'Convenio de doble imposición', acrecentamiento: 'Acrecentamiento' });
const valorDetalle = (k: string, v: unknown) =>
  MARCAS.has(k) ? (String(v) === 'true' ? 'Sí' : 'No') : TEXTO.has(k) || Number.isNaN(Number(v)) ? String(v) : formatoMoneda(v as string);
export const textoDetalle = (detalle: Record<string, unknown>) =>
  Object.entries(detalle).filter(([k]) => !OCULTOS.has(k)).map(([k, v]) => `${DETALLE[k] ?? k}: ${valorDetalle(k, v)}`).join(' · ');

export function TablaRetenciones({ retenciones, opId, certificados }: { retenciones: RetencionOP[]; opId?: string; certificados?: boolean }) {
  const visibles = retenciones.filter((r) => Number(r.importe) > 0);
  // Revisión E43: las filas en cero con aviso (p. ej. proveedor del exterior sin régimen) se muestran como alerta
  const avisos = [...new Set(retenciones.map((r) => r.detalle?.aviso).filter((a): a is string => !!a))];
  const alertas = avisos.map((a) => <Alert key={a} color="orange" p="xs">{a}</Alert>);
  if (!visibles.length) return <Stack gap="xs">{alertas}<Text size="sm" c="dimmed">Sin retenciones.</Text></Stack>;
  return (
    <Stack gap="xs">
    {alertas}
    <Table withTableBorder>
      <Table.Thead>
        <Table.Tr><Table.Th>Retención</Table.Th><Table.Th ta="right">Base</Table.Th><Table.Th ta="right">Alícuota</Table.Th><Table.Th ta="right">Importe</Table.Th>{certificados && <Table.Th>Certificado</Table.Th>}</Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {visibles.map((r) => (
          <Table.Tr key={r.id} style={r.anulada ? { textDecoration: 'line-through' } : undefined}>
            <Table.Td>
              <Tooltip multiline w={300} label={textoDetalle(r.detalle)}>
                <Text size="sm" style={{ cursor: 'help' }}>{descripcionRetencion(r)}{r.detalle?.acrecentamiento === 'true' ? ' (asumida por la empresa)' : ''}</Text>
              </Tooltip>
            </Table.Td>
            <Table.Td ta="right">{formatoMoneda(r.base)}</Table.Td>
            <Table.Td ta="right">{r.alicuota === 'escala' ? 'Escala' : `${Number(r.alicuota).toLocaleString('es-AR')} %`}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(r.importe)}</Table.Td>
            {certificados && (
              <Table.Td>
                {r.certificadoNumero && opId && (
                  <Button size="compact-xs" variant="subtle" leftSection={<IconDownload size={12} />}
                    onClick={() => void descargar(`/pagos/ordenes/${opId}/certificados/${r.id}/pdf`, {}, `certificado-${numeroCertificado(r).replace(' ', '-')}.pdf`)}>
                    {numeroCertificado(r)}
                  </Button>
                )}
              </Table.Td>
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
    </Stack>
  );
}
