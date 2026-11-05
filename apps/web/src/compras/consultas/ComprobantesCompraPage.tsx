import { Badge, Group, Modal, Paper, Select, Title } from '@mantine/core';
import { useState } from 'react';
import { TablaAbm } from '../../abm/TablaAbm';
import { formatoFecha, formatoMoneda, formatoNumero } from '../formato';
import { DetalleComprobante, TIPOS_FC } from './DetalleComprobante';

interface Fila { id: string; tipo: string; letra: string; puntoVenta: number; numero: number; fechaContable: string; monedaCodigo: string; total: string; estado: string; tercero: { razonSocial: string } }

export function ComprobantesCompraPage() {
  const [estado, setEstado] = useState<string | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Title order={3}>Comprobantes de compra</Title>
        <Group gap="xs">
          <Select placeholder="Tipo" clearable w={170} value={tipo} onChange={setTipo} data={Object.entries(TIPOS_FC).map(([value, label]) => ({ value, label }))} />
          <Select placeholder="Estado" clearable w={150} value={estado} onChange={setEstado} data={[{ value: 'CONFIRMADO', label: 'Confirmado' }, { value: 'ANULADO', label: 'Anulado' }]} />
        </Group>
      </Group>
      <TablaAbm<Fila>
        ruta="/compras/comprobantes" paginado buscador={false}
        filtros={{ estado: estado ?? undefined, tipo: tipo ?? undefined }}
        onSeleccionar={(f) => setAbierto(f.id)}
        columnas={[
          { campo: 'fechaContable', titulo: 'Fecha', render: (f) => formatoFecha(f.fechaContable) },
          { campo: 'tipo', titulo: 'Comprobante', render: (f) => `${TIPOS_FC[f.tipo]} ${f.letra} ${formatoNumero(f.puntoVenta, f.numero)}` },
          { campo: 'tercero', titulo: 'Proveedor', render: (f) => f.tercero.razonSocial },
          { campo: 'total', titulo: 'Total', render: (f) => formatoMoneda(f.total, f.monedaCodigo) },
          { campo: 'estado', titulo: 'Estado', render: (f) => <Badge size="sm" variant="light" color={f.estado === 'ANULADO' ? 'red' : 'green'}>{f.estado === 'ANULADO' ? 'Anulado' : 'Confirmado'}</Badge> },
        ]}
      />
      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title="Comprobante de compra" size="xl">{abierto && <DetalleComprobante id={abierto} />}</Modal>
    </Paper>
  );
}
