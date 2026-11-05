import { Badge, Button, Group, Modal, Paper, Select, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TablaAbm } from '../abm/TablaAbm';
import { DetalleOrdenCompra } from './DetalleOrdenCompra';
import { ESTADOS_OC, formatoFecha, formatoMoneda, numeroInterno } from './formato';

interface FilaOC { id: string; numero: number | null; fecha: string; estado: string; monedaCodigo: string; total: string; tercero: { razonSocial: string } }

/** Lista de OC. Con `soloPendientes` funciona como bandeja de aprobación. */
export function OrdenesCompraPage({ soloPendientes = false }: { soloPendientes?: boolean }) {
  const { puede } = useAuth();
  const navegar = useNavigate();
  const [estado, setEstado] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Title order={3}>{soloPendientes ? 'Aprobación de órdenes de compra' : 'Órdenes de compra'}</Title>
        {!soloPendientes && (
          <Select placeholder="Todos los estados" clearable w={230} value={estado} onChange={setEstado}
            data={Object.entries(ESTADOS_OC).map(([value, e]) => ({ value, label: e.etiqueta }))} />
        )}
      </Group>
      <TablaAbm<FilaOC>
        ruta="/compras/ordenes"
        paginado
        buscador={false}
        filtros={{ estado: soloPendientes ? 'PENDIENTE_APROBACION' : (estado ?? undefined) }}
        onSeleccionar={(f) => setAbierta(f.id)}
        acciones={!soloPendientes && puede('oc.crear') && <Button leftSection={<IconPlus size={16} />} onClick={() => navegar('/compras/oc/nueva')}>Nueva</Button>}
        columnas={[
          { campo: 'numero', titulo: 'Número', render: (f) => numeroInterno(f.numero) },
          { campo: 'fecha', titulo: 'Fecha', render: (f) => formatoFecha(f.fecha) },
          { campo: 'tercero', titulo: 'Proveedor', render: (f) => f.tercero.razonSocial },
          { campo: 'total', titulo: 'Total', render: (f) => formatoMoneda(f.total, f.monedaCodigo) },
          { campo: 'estado', titulo: 'Estado', render: (f) => <Badge size="sm" variant="light" color={ESTADOS_OC[f.estado].color}>{ESTADOS_OC[f.estado].etiqueta}</Badge> },
        ]}
      />
      <Modal opened={!!abierta} onClose={() => setAbierta(null)} title="Orden de compra" size="xl">
        {abierta && <DetalleOrdenCompra id={abierta} alCerrar={() => setAbierta(null)} />}
      </Modal>
    </Paper>
  );
}

export const AprobacionOcPage = () => <OrdenesCompraPage soloPendientes />;
