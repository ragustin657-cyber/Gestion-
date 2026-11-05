import { Badge, Button, Group, Modal, Paper, Select, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TablaAbm } from '../abm/TablaAbm';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { DetalleOrdenPago } from './DetalleOrdenPago';
import { ESTADOS_OP, numeroOP } from './tipos';

interface Fila { id: string; numero: number | null; fecha: string; estado: string; totalCancelarPesos: string; netoPagar: string; tercero: { razonSocial: string } }

/** Lista de OP. Con `estadoFijo` funciona como bandeja (aprobación o pago). */
export function OrdenesPagoPage({ estadoFijo, titulo, detalle }: {
  estadoFijo?: string; titulo?: string; detalle?: (id: string, cerrar: () => void) => ReactNode;
}) {
  const { puede } = useAuth();
  const navegar = useNavigate();
  const [estado, setEstado] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const cerrar = () => setAbierta(null);
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Title order={3}>{titulo ?? 'Órdenes de pago'}</Title>
        {!estadoFijo && (
          <Select placeholder="Todos los estados" clearable w={230} value={estado} onChange={setEstado}
            data={Object.entries(ESTADOS_OP).map(([value, e]) => ({ value, label: e.etiqueta }))} />
        )}
      </Group>
      <TablaAbm<Fila>
        ruta="/pagos/ordenes" paginado buscador={false}
        filtros={{ estado: estadoFijo ?? estado ?? undefined }}
        onSeleccionar={(f) => setAbierta(f.id)}
        acciones={!estadoFijo && puede('op.crear') && <Button leftSection={<IconPlus size={16} />} onClick={() => navegar('/pagos/op/nueva')}>Nueva</Button>}
        columnas={[
          { campo: 'numero', titulo: 'Número', render: (f) => numeroOP(f.numero) },
          { campo: 'fecha', titulo: 'Fecha', render: (f) => formatoFecha(f.fecha) },
          { campo: 'tercero', titulo: 'Proveedor', render: (f) => f.tercero.razonSocial },
          { campo: 'totalCancelarPesos', titulo: 'Total', render: (f) => formatoMoneda(f.totalCancelarPesos) },
          { campo: 'netoPagar', titulo: 'Neto a pagar', render: (f) => formatoMoneda(f.netoPagar) },
          { campo: 'estado', titulo: 'Estado', render: (f) => <Badge size="sm" variant="light" color={ESTADOS_OP[f.estado].color}>{ESTADOS_OP[f.estado].etiqueta}</Badge> },
        ]}
      />
      <Modal opened={!!abierta} onClose={cerrar} title="Orden de pago" size="xl">
        {abierta && (detalle ? detalle(abierta, cerrar) : <DetalleOrdenPago id={abierta} alCerrar={cerrar} />)}
      </Modal>
    </Paper>
  );
}

export const AprobacionOpPage = () => <OrdenesPagoPage estadoFijo="PENDIENTE_APROBACION" titulo="Aprobación de órdenes de pago" />;
