import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { letraVenta, type LetraVenta } from '@gestion/shared';
import { api, descargar } from '../api/cliente';
import { hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { numero, useClientes, useEmpresa } from './comun';
import { alicuotaDe, GrillaVenta, renglonVacio, type ArticuloVenta, type RenglonVentaEditable } from './GrillaVenta';
import { precioSugerido } from './precios';

export interface PedidoVenta {
  id: string; numero: number; terceroId: string; fecha: string; validoHasta: string | null; monedaCodigo: string; cotizacion: string; depositoId: string | null; estado: string;
  observaciones: string | null; total: string; version: number; motivoCierre: string | null;
  renglones: { id: string; articuloId: string | null; descripcion: string; cantidad: string; precioUnitario: string; alicuota: string; cantidadEntregada: string; cantidadFacturada: string; pendienteEntregar: string; pendienteFacturar: string }[];
}
export const ESTADOS_PEDIDO: Record<string, { etiqueta: string; color: string }> = {
  PRESUPUESTO: { etiqueta: 'Presupuesto', color: 'gray' }, CONFIRMADO: { etiqueta: 'Confirmado', color: 'blue' }, PARCIALMENTE_ENTREGADO: { etiqueta: 'Parcialmente entregado', color: 'yellow' },
  ENTREGADO: { etiqueta: 'Entregado', color: 'green' }, CERRADO: { etiqueta: 'Cerrado', color: 'dark' }, ANULADO: { etiqueta: 'Anulado', color: 'red' },
};

export function PedidoVentaPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const [params] = useSearchParams();
  const clientes = useClientes();
  const empresa = useEmpresa();
  const articulos: ArticuloVenta[] = (useQuery({ queryKey: ['/articulos', 'venta'], queryFn: () => api<{ items: { id: string; codigo: string; descripcion: string; alicuotaIva: string; activo: boolean }[] }>('/articulos', { query: { porPagina: 200 } }) }).data?.items ?? [])
    .filter((a) => a.activo).map((a) => ({ value: a.id, label: `${a.codigo} ${a.descripcion}`, descripcion: a.descripcion, alicuotaIva: a.alicuotaIva }));
  const depositos = (useQuery({ queryKey: ['/depositos', 'pedido'], queryFn: () => api<{ id: string; nombre: string }[]>('/depositos') }).data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
  const [actual, setActual] = useState<PedidoVenta | null>(null);
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [validoHasta, setValidoHasta] = useState('');
  const [moneda, setMoneda] = useState('ARS');
  const [cotizacion, setCotizacion] = useState('');
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonVentaEditable[]>([renglonVacio()]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [accion, setAccion] = useState<'cerrar' | 'anular' | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = (p: PedidoVenta) => {
    setActual(p); setTerceroId(p.terceroId); setFecha(p.fecha.slice(0, 10)); setValidoHasta(p.validoHasta?.slice(0, 10) ?? ''); setMoneda(p.monedaCodigo);
    setCotizacion(p.monedaCodigo === 'USD' ? String(Number(p.cotizacion)) : ''); setDepositoId(p.depositoId); setObservaciones(p.observaciones ?? '');
    setRenglones(p.renglones.map((r) => ({ articuloId: r.articuloId, descripcion: r.descripcion, cantidad: String(Number(r.cantidad)), precioUnitario: String(Number(r.precioUnitario)), alicuota: r.alicuota })));
  };
  useEffect(() => { const id = params.get('id'); if (id) void api<PedidoVenta>(`/ventas/pedidos/${id}`).then(cargar); }, [params]);

  const cliente = clientes.find((c) => c.id === terceroId);
  let letra: LetraVenta = 'B';
  try { if (empresa && cliente) letra = letraVenta(empresa.condicionIva, cliente.condicionIva); } catch { /* lo informa el servidor */ }
  const editable = !actual || actual.estado === 'PRESUPUESTO';
  const cuerpo = (confirmar: boolean) => ({
    terceroId, fecha, validoHasta: validoHasta || null, monedaCodigo: moneda, cotizacion: moneda === 'USD' && cotizacion ? numero(cotizacion) : null, depositoId, observaciones: observaciones || null, confirmar,
    renglones: renglones.filter((r) => r.descripcion).map((r) => ({ articuloId: r.articuloId, descripcion: r.descripcion, cantidad: numero(r.cantidad), precioUnitario: numero(r.precioUnitario), alicuota: alicuotaDe(r.alicuota) })),
  });
  const guardar = async (confirmar: boolean) => {
    const r = await op.ejecutar(() => (actual
      ? api<PedidoVenta & { advertencias: string[] }>(`/ventas/pedidos/${actual.id}`, { metodo: 'PUT', body: { ...cuerpo(confirmar), version: actual.version } })
      : api<PedidoVenta & { advertencias: string[] }>('/ventas/pedidos', { metodo: 'POST', body: cuerpo(confirmar) })), (x) => `${x.estado === 'PRESUPUESTO' ? 'Presupuesto' : 'Pedido'} N° ${x.numero} guardado`);
    if (r) { cargar(r); setAvisos(r.advertencias ?? []); void qc.invalidateQueries({ queryKey: ['/ventas/pedidos'] }); }
  };
  const confirmarCambio = async () => {
    const r = await op.ejecutar(() => api<PedidoVenta>(`/ventas/pedidos/${actual!.id}/${accion}`, { metodo: 'POST', body: { motivo } }), () => (accion === 'cerrar' ? 'Pedido cerrado' : 'Pedido anulado'));
    setAccion(null); setMotivo('');
    if (r) cargar(r);
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>{actual ? `${actual.estado === 'PRESUPUESTO' ? 'Presupuesto' : 'Pedido de venta'} N° ${actual.numero}` : 'Pedido de venta'}</Title>
        {actual && <Badge color={ESTADOS_PEDIDO[actual.estado]?.color}>{ESTADOS_PEDIDO[actual.estado]?.etiqueta}</Badge>}
      </Group>
      <Group align="flex-end" mb="md">
        <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId} onChange={setTerceroId} disabled={!editable} />
        <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} disabled={!editable} />
        <TextInput label="Válido hasta" type="date" value={validoHasta} onChange={(e) => setValidoHasta(e.currentTarget.value)} disabled={!editable} />
        <Select label="Moneda" w={100} data={['ARS', 'USD']} allowDeselect={false} value={moneda} onChange={(v) => setMoneda(v ?? 'ARS')} disabled={!editable} />
        {moneda === 'USD' && <TextInput label="Cotización" w={110} placeholder="Del día" value={cotizacion} onChange={(e) => setCotizacion(e.currentTarget.value)} disabled={!editable} />}
        <Select label="Depósito" w={180} clearable data={depositos} value={depositoId} onChange={setDepositoId} disabled={!editable} />
      </Group>
      <GrillaVenta renglones={renglones} onChange={setRenglones} letra={letra} moneda={moneda} articulos={articulos}
        sugerirPrecio={(articuloId) => precioSugerido({ terceroId, articuloId, monedaCodigo: moneda, cotizacion })} />
      <TextInput label="Observaciones" mt="md" value={observaciones} onChange={(e) => setObservaciones(e.currentTarget.value)} disabled={!editable} />
      {op.alerta}
      {avisos.map((a) => <Alert key={a} color="yellow" mt="sm">{a}</Alert>)}
      <Group mt="md">
        {editable && <Button variant="default" loading={op.enviando} disabled={!terceroId} onClick={() => void guardar(false)}>Guardar presupuesto</Button>}
        {editable && <Button loading={op.enviando} disabled={!terceroId} onClick={() => void guardar(true)}>Confirmar</Button>}
        {actual && <Button variant="light" onClick={() => void descargar(`/ventas/pedidos/${actual.id}/pdf`, {}, `pedido-${actual.numero}.pdf`)}>PDF</Button>}
        {actual && ['PRESUPUESTO', 'CONFIRMADO', 'PARCIALMENTE_ENTREGADO'].includes(actual.estado) && <Button variant="subtle" onClick={() => setAccion('cerrar')}>Cerrar</Button>}
        {actual && actual.estado !== 'ANULADO' && <Button variant="subtle" color="red" onClick={() => setAccion('anular')}>Anular</Button>}
      </Group>
      <Modal opened={!!accion} onClose={() => setAccion(null)} title={accion === 'cerrar' ? 'Cerrar pedido' : 'Anular pedido'}>
        <Stack>
          <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <Button color={accion === 'anular' ? 'red' : undefined} disabled={!motivo.trim()} onClick={() => void confirmarCambio()}>{accion === 'cerrar' ? 'Cerrar' : 'Anular'}</Button>
        </Stack>
      </Modal>
    </Paper>
  );
}
