import { Alert, Badge, Button, Checkbox, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErrorApi } from '../api/cliente';
import { useMaestrosCompras } from '../compras/datos';
import { formatoMoneda, hoy } from '../compras/formato';
import { Pendiente, SelectorComprobantes, SeleccionImputaciones } from './SelectorComprobantes';
import { TablaRetenciones } from './TablaRetenciones';
import { ESTADOS_OP, numeroOP, OrdenPago } from './tipos';

export function OrdenPagoPage() {
  const { id } = useParams();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const m = useMaestrosCompras();
  const [op, setOp] = useState<OrdenPago | null>(null);
  const [cab, setCab] = useState({ terceroId: '', fecha: hoy(), cotizacion: '', observaciones: '' });
  const [seleccion, setSeleccion] = useState<SeleccionImputaciones>({});
  const [conAnticipo, setConAnticipo] = useState(false);
  const [anticipo, setAnticipo] = useState({ monedaCodigo: 'ARS', importe: '' });
  const [error, setError] = useState<ErrorApi | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pendientesQ = useQuery({
    queryKey: ['/pagos/pendientes', cab.terceroId, op?.id],
    queryFn: () => api<Pendiente[]>('/pagos/pendientes', { query: { terceroId: cab.terceroId } }),
    enabled: !!cab.terceroId,
  });
  // En edición, lo ya imputado por esta OP figura como comprometido: se suma al disponible
  const pendientes: Pendiente[] = (pendientesQ.data ?? []).map((p) => {
    const propia = op?.imputaciones.find((i) => i.movimientoId === p.movimientoId);
    return propia ? { ...p, comprometido: String(Number(p.comprometido) - Number(propia.importe)), disponible: String(Number(p.disponible) + Number(propia.importe)) } : p;
  });
  for (const i of op?.imputaciones ?? [])
    if (!pendientes.some((p) => p.movimientoId === i.movimientoId))
      pendientes.push({ movimientoId: i.movimientoId, comprobante: i.comprobante, fecha: '', fechaVencimiento: i.fechaVencimiento, monedaCodigo: i.monedaCodigo, saldo: i.importe, comprometido: '0', disponible: i.importe });

  const cargar = async (opId: string) => {
    const o = await api<OrdenPago>(`/pagos/ordenes/${opId}`);
    setOp(o);
    setCab({ terceroId: o.terceroId, fecha: o.fecha.slice(0, 10), cotizacion: Number(o.cotizacion) > 1 ? String(Number(o.cotizacion)) : '', observaciones: o.observaciones ?? '' });
    setSeleccion(Object.fromEntries(o.imputaciones.map((i) => [i.movimientoId, String(Number(i.importe))])));
    setConAnticipo(!!o.anticipo);
    if (o.anticipo) setAnticipo({ monedaCodigo: o.anticipo.monedaCodigo, importe: String(Number(o.anticipo.importe)) });
  };
  useEffect(() => {
    if (id) cargar(id).catch((e) => setError(e));
  }, [id]);

  const editable = !op || op.estado === 'BORRADOR';
  const cuerpo = () => ({
    terceroId: cab.terceroId, fecha: cab.fecha, cotizacion: Number(cab.cotizacion) > 1 ? Number(cab.cotizacion) : null, observaciones: cab.observaciones || null,
    imputaciones: Object.entries(seleccion).map(([movimientoId, importe]) => ({ movimientoId, importe: Number(importe) })),
    anticipo: conAnticipo && anticipo.importe ? { monedaCodigo: anticipo.monedaCodigo, importe: Number(anticipo.importe) } : null,
  });

  async function ejecutar(fn: () => Promise<void>) {
    setError(null);
    setOcupado(true);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ['/pagos/ordenes'] });
      void qc.invalidateQueries({ queryKey: ['/pagos/pendientes'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error inesperado'));
    } finally {
      setOcupado(false);
    }
  }
  const guardar = async () => (op ? api<OrdenPago>(`/pagos/ordenes/${op.id}`, { metodo: 'PATCH', body: cuerpo() }) : api<OrdenPago>('/pagos/ordenes', { metodo: 'POST', body: cuerpo() }));

  if (id && !op && !error) return <Loader size="sm" />;

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>{op?.numero ? `Orden de pago ${numeroOP(op.numero)}` : op ? 'Orden de pago (borrador)' : 'Nueva orden de pago'}</Title>
        {op && <Badge variant="light" color={ESTADOS_OP[op.estado].color}>{ESTADOS_OP[op.estado].etiqueta}</Badge>}
      </Group>
      <Stack>
        {error && <Alert color="red">{error.mensaje}{error.campos && Object.entries(error.campos).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</Alert>}
        {op?.motivoRechazo && op.estado === 'BORRADOR' && <Alert color="yellow">Rechazada: {op.motivoRechazo}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Proveedor" withAsterisk searchable data={m.opcionesProveedor} value={cab.terceroId || null} disabled={!editable}
            onChange={(v) => { setCab({ ...cab, terceroId: v ?? '' }); setSeleccion({}); }} />
          <TextInput label="Fecha" type="date" value={cab.fecha} disabled={!editable} onChange={(e) => setCab({ ...cab, fecha: e.currentTarget.value })} />
          <TextInput label="Cotización del dólar" placeholder="La del día" inputMode="decimal" value={cab.cotizacion} disabled={!editable}
            onChange={(e) => setCab({ ...cab, cotizacion: e.currentTarget.value.replace(',', '.') })} />
        </SimpleGrid>
        {cab.terceroId && <SelectorComprobantes pendientes={pendientes} seleccion={seleccion} onChange={setSeleccion} cotizacion={cab.cotizacion || '0'} soloLectura={!editable} />}
        <Group align="flex-end">
          <Checkbox label="Pago a cuenta (anticipo)" checked={conAnticipo} disabled={!editable} onChange={(e) => setConAnticipo(e.currentTarget.checked)} />
          {conAnticipo && (
            <>
              <Select w={110} data={['ARS', 'USD']} value={anticipo.monedaCodigo} disabled={!editable} allowDeselect={false} onChange={(v) => setAnticipo({ ...anticipo, monedaCodigo: v ?? 'ARS' })} aria-label="Moneda del anticipo" />
              <TextInput w={160} placeholder="Importe" aria-label="Importe del anticipo" inputMode="decimal" value={anticipo.importe} disabled={!editable}
                onChange={(e) => setAnticipo({ ...anticipo, importe: e.currentTarget.value.replace(',', '.') })} />
            </>
          )}
        </Group>
        <Textarea label="Observaciones" value={cab.observaciones} disabled={!editable} onChange={(e) => setCab({ ...cab, observaciones: e.currentTarget.value })} />
        {op && op.numero && (
          <Stack gap="xs">
            <Text fw={600} size="sm">Retenciones {op.estado === 'PAGADA' ? '' : '(vista previa, se recalculan al pagar)'}</Text>
            <TablaRetenciones retenciones={op.retenciones} />
            <Group justify="flex-end" gap="lg">
              <Text size="sm">Total a cancelar {formatoMoneda(op.totalCancelarPesos)}</Text>
              <Text size="sm">Retenciones {formatoMoneda(op.totalRetenciones)}</Text>
              <Text fw={700}>Neto a pagar {formatoMoneda(op.netoPagar)}</Text>
            </Group>
          </Stack>
        )}
        <Group justify="flex-end">
          {op && <Button variant="default" onClick={() => navegar('/pagos/op')}>Volver a la lista</Button>}
          {editable && op && (
            <Button color="red" variant="light" loading={ocupado} onClick={() => ejecutar(async () => {
              await api(`/pagos/ordenes/${op.id}`, { metodo: 'DELETE' });
              navegar('/pagos/op');
            })}>Eliminar borrador</Button>
          )}
          {editable && (
            <Button variant="default" loading={ocupado} onClick={() => ejecutar(async () => {
              const r = await guardar();
              setOp(r);
              notifications.show({ color: 'green', message: 'Borrador guardado' });
              if (!op) navegar(`/pagos/op/${r.id}`, { replace: true });
            })}>Guardar borrador</Button>
          )}
          {editable && (
            <Button loading={ocupado} onClick={() => ejecutar(async () => {
              const b = await guardar();
              const r = await api<OrdenPago>(`/pagos/ordenes/${b.id}/confirmar`, { metodo: 'POST', body: { version: b.version } });
              setOp(r);
              notifications.show({ color: 'green', message: `Orden ${numeroOP(r.numero)} confirmada: ${ESTADOS_OP[r.estado].etiqueta}` });
              if (!op) navegar(`/pagos/op/${r.id}`, { replace: true });
            })}>Confirmar</Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
