import { Alert, Button, Group, Paper, Select, SimpleGrid, Stack, Textarea, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { useMaestrosCompras } from './datos';
import { formatoFecha, hoy, numeroInterno } from './formato';
import { Seleccion, SelectorPendientes } from './SelectorPendientes';

interface PendienteRecibir { ordenCompraRenglonId: string; ocNumero: number; fechaEntrega: string | null; descripcion: string; cantidad: string; recibido: string; pendiente: string }

export function RecepcionPage() {
  const qc = useQueryClient();
  const m = useMaestrosCompras();
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [cab, setCab] = useState({ fecha: hoy(), depositoId: '', remitoNumero: '', observaciones: '' });
  const [seleccion, setSeleccion] = useState<Seleccion>({});
  const [error, setError] = useState<ErrorApi | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pendientes = useQuery({
    queryKey: ['/compras/ordenes/pendientes-recibir', terceroId],
    queryFn: () => api<PendienteRecibir[]>('/compras/ordenes/pendientes-recibir', { query: { terceroId } }),
    enabled: !!terceroId,
  });

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      const r = await api<{ numero: number }>('/compras/recepciones', {
        metodo: 'POST',
        body: {
          terceroId, fecha: cab.fecha, depositoId: cab.depositoId || null, remitoNumero: cab.remitoNumero, observaciones: cab.observaciones || null,
          renglones: Object.entries(seleccion).map(([ordenCompraRenglonId, cantidad]) => ({ ordenCompraRenglonId, cantidad: Number(cantidad) })),
        },
      });
      notifications.show({ color: 'green', message: `Recepción ${numeroInterno(r.numero)} registrada` });
      setSeleccion({});
      setCab({ ...cab, remitoNumero: '', observaciones: '' });
      void qc.invalidateQueries({ queryKey: ['/compras/ordenes/pendientes-recibir'] });
      void qc.invalidateQueries({ queryKey: ['/compras/ordenes'] });
      void qc.invalidateQueries({ queryKey: ['/compras/recepciones'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error inesperado'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Informe de recepción</Title>
      <Stack>
        {error && <Alert color="red">{error.mensaje}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Select label="Proveedor" withAsterisk searchable data={m.opcionesProveedor} value={terceroId} onChange={(v) => { setTerceroId(v); setSeleccion({}); }} />
          <TextInput label="Fecha" type="date" value={cab.fecha} onChange={(e) => setCab({ ...cab, fecha: e.currentTarget.value })} />
          <TextInput label="Remito del proveedor" withAsterisk placeholder="0001-00001234" value={cab.remitoNumero} onChange={(e) => setCab({ ...cab, remitoNumero: e.currentTarget.value })} />
          <Select label="Depósito" clearable data={m.depositos} value={cab.depositoId || null} onChange={(v) => setCab({ ...cab, depositoId: v ?? '' })} />
        </SimpleGrid>
        {terceroId && (
          <SelectorPendientes
            titulos={['OC', 'Entrega', 'Descripción', 'Pedido']}
            seleccion={seleccion}
            onChange={setSeleccion}
            filas={(pendientes.data ?? []).map((p) => ({
              clave: p.ordenCompraRenglonId, pendiente: p.pendiente,
              columnas: [numeroInterno(p.ocNumero), formatoFecha(p.fechaEntrega), p.descripcion, Number(p.cantidad).toLocaleString('es-AR')],
            }))}
          />
        )}
        <Textarea label="Observaciones" value={cab.observaciones} onChange={(e) => setCab({ ...cab, observaciones: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button loading={enviando} disabled={!terceroId || !Object.keys(seleccion).length || !cab.remitoNumero} onClick={confirmar}>Confirmar recepción</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
