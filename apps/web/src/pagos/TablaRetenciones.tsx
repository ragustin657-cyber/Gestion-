import { Button, Table, Text, Tooltip } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { descargar } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { descripcionRetencion, numeroCertificado, RetencionOP } from './tipos';

const DETALLE: Record<string, string> = {
  basePago: 'Base del pago', acumuladoPrevio: 'Acumulado previo del mes', acumulado: 'Acumulado', minimoNoSujeto: 'Mínimo no sujeto',
  sujetoRetencion: 'Sujeto a retención', impuestoDeterminado: 'Impuesto determinado', retenidoPrevio: 'Retenido en el mes', origenAlicuota: 'Origen de la alícuota',
};

export function TablaRetenciones({ retenciones, opId, certificados }: { retenciones: RetencionOP[]; opId?: string; certificados?: boolean }) {
  const visibles = retenciones.filter((r) => Number(r.importe) > 0);
  if (!visibles.length) return <Text size="sm" c="dimmed">Sin retenciones.</Text>;
  return (
    <Table withTableBorder>
      <Table.Thead>
        <Table.Tr><Table.Th>Retención</Table.Th><Table.Th ta="right">Base</Table.Th><Table.Th ta="right">Alícuota</Table.Th><Table.Th ta="right">Importe</Table.Th>{certificados && <Table.Th>Certificado</Table.Th>}</Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {visibles.map((r) => (
          <Table.Tr key={r.id} style={r.anulada ? { textDecoration: 'line-through' } : undefined}>
            <Table.Td>
              <Tooltip multiline w={300} label={Object.entries(r.detalle).map(([k, v]) => `${DETALLE[k] ?? k}: ${Number.isNaN(Number(v)) ? v : formatoMoneda(v)}`).join(' · ')}>
                <Text size="sm" style={{ cursor: 'help' }}>{descripcionRetencion(r)}</Text>
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
  );
}
