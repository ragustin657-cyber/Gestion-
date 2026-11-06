import { Alert, Badge, Button, Group, Text } from '@mantine/core';
import { descargar } from '../api/cliente';
import { formatoFecha } from '../compras/formato';
import { ESTADOS_VENTA, numeroVenta } from './comun';

export interface EstadoComprobante { id?: string; estado: string; ultimoError: string | null; cae: string | null; caeVencimiento?: string | null; numero: number | null; puntoVenta: number; letra?: string }

/** Estado de la emisión: autorizado con su CAE y PDF, o el error de ARCA con Reintentar. */
export function EstadoEmision({ comprobante: c, onReintentar, enviando }: { comprobante: EstadoComprobante; onReintentar: () => void; enviando?: boolean }) {
  const e = ESTADOS_VENTA[c.estado] ?? { etiqueta: c.estado, color: 'gray' };
  if (c.estado === 'AUTORIZADO')
    return (
      <Alert color="green" title={<Group gap="xs"><Badge color="green">{e.etiqueta}</Badge><Text fw={600}>{numeroVenta(c.puntoVenta, c.numero)}</Text></Group>}>
        <Group justify="space-between">
          <Text size="sm" data-testid="cae">CAE {c.cae}{c.caeVencimiento ? ` · vence ${formatoFecha(c.caeVencimiento)}` : ''}</Text>
          {c.id && <Button size="xs" variant="light" onClick={() => void descargar(`/ventas/comprobantes/${c.id}/pdf`, {}, `comprobante-${c.letra ?? ''}-${numeroVenta(c.puntoVenta, c.numero)}.pdf`)}>Descargar PDF</Button>}
        </Group>
        {c.ultimoError && <Text size="xs" c="dimmed" mt={4}>{c.ultimoError}</Text>}
      </Alert>
    );
  return (
    <Alert color={c.estado === 'RECHAZADO' ? 'red' : 'yellow'} title={<Badge color={e.color}>{e.etiqueta}</Badge>}>
      {c.ultimoError && <Text size="sm">{c.ultimoError}</Text>}
      <Group justify="flex-end" mt="xs"><Button size="xs" loading={enviando} onClick={onReintentar}>{c.ultimoError ? 'Reintentar' : 'Emitir'}</Button></Group>
    </Alert>
  );
}
