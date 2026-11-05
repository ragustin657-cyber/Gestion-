import { Alert, Badge, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Textarea, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErrorApi } from '../api/cliente';
import { ESTADOS_OC, hoy, numeroInterno } from './formato';
import { GrillaRenglones, RenglonEditable, renglonVacio } from './GrillaRenglones';
import { useMaestrosCompras } from './datos';

export interface RenglonOC {
  id: string; articuloId: string | null; descripcion: string; cantidad: string; precioUnitario: string; bonificacionPct: string;
  alicuotaIva: string; centroCostoId: string | null; importe: string; cantidadRecibida: string; cantidadFacturada: string; pendiente: string;
}
export interface OrdenCompra {
  id: string; numero: number | null; estado: string; version: number; terceroId: string; fecha: string; fechaEntrega: string | null;
  depositoId: string | null; monedaCodigo: string; diasPago: number; observaciones: string | null; neto: string; iva: string; total: string;
  totalPesos: string; creadoPor: string; aprobadoPor: string | null; motivoRechazo: string | null; motivoAnulacion: string | null;
  tercero: { id: string; razonSocial: string; cuit: string }; renglones: RenglonOC[];
}

const aEditable = (r: RenglonOC): RenglonEditable => ({
  articuloId: r.articuloId, descripcion: r.descripcion, cantidad: String(Number(r.cantidad)), precioUnitario: String(Number(r.precioUnitario)),
  bonificacionPct: String(Number(r.bonificacionPct)), alicuotaIva: String(Number(r.alicuotaIva)), centroCostoId: r.centroCostoId,
});

/** Alta y edición de órdenes de compra (borradores). */
export function OrdenCompraPage() {
  const { id } = useParams();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const m = useMaestrosCompras();
  const [oc, setOc] = useState<OrdenCompra | null>(null);
  const [cab, setCab] = useState({ terceroId: '', fecha: hoy(), fechaEntrega: '', depositoId: '', monedaCodigo: 'ARS', observaciones: '' });
  const [renglones, setRenglones] = useState<RenglonEditable[]>([renglonVacio()]);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = async (ocId: string) => {
    const o = await api<OrdenCompra>(`/compras/ordenes/${ocId}`);
    setOc(o);
    setCab({
      terceroId: o.terceroId, fecha: o.fecha.slice(0, 10), fechaEntrega: o.fechaEntrega?.slice(0, 10) ?? '', depositoId: o.depositoId ?? '',
      monedaCodigo: o.monedaCodigo, observaciones: o.observaciones ?? '',
    });
    setRenglones(o.renglones.map(aEditable));
  };
  useEffect(() => {
    if (id) cargar(id).catch((e) => setError(e));
  }, [id]);

  const editable = !oc || oc.estado === 'BORRADOR';
  const cuerpo = () => ({
    terceroId: cab.terceroId, fecha: cab.fecha, fechaEntrega: cab.fechaEntrega || null, depositoId: cab.depositoId || null,
    monedaCodigo: cab.monedaCodigo, observaciones: cab.observaciones || null,
    renglones: renglones.map((r) => ({
      articuloId: r.articuloId || null, descripcion: r.descripcion, cantidad: Number(r.cantidad), precioUnitario: Number(r.precioUnitario),
      bonificacionPct: Number(r.bonificacionPct || 0), alicuotaIva: Number(r.alicuotaIva), centroCostoId: r.centroCostoId || null,
    })),
  });

  async function ejecutar(fn: () => Promise<void>) {
    setError(null);
    setOcupado(true);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ['/compras/ordenes'] });
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 409 && oc) {
        notifications.show({ color: 'yellow', message: 'La orden fue modificada por otro usuario. Se recargaron los datos.' });
        await cargar(oc.id);
      } else setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error inesperado'));
    } finally {
      setOcupado(false);
    }
  }

  const guardar = () =>
    ejecutar(async () => {
      const r = oc
        ? await api<OrdenCompra>(`/compras/ordenes/${oc.id}`, { metodo: 'PATCH', body: cuerpo() })
        : await api<OrdenCompra>('/compras/ordenes', { metodo: 'POST', body: cuerpo() });
      setOc(r);
      notifications.show({ color: 'green', message: 'Borrador guardado' });
      if (!oc) navegar(`/compras/oc/${r.id}`, { replace: true });
    });

  const confirmar = () =>
    ejecutar(async () => {
      const b = oc
        ? await api<OrdenCompra>(`/compras/ordenes/${oc.id}`, { metodo: 'PATCH', body: cuerpo() })
        : await api<OrdenCompra>('/compras/ordenes', { metodo: 'POST', body: cuerpo() });
      const r = await api<OrdenCompra>(`/compras/ordenes/${b.id}/confirmar`, { metodo: 'POST', body: { version: b.version } });
      setOc(r);
      notifications.show({ color: 'green', message: `Orden ${numeroInterno(r.numero)} confirmada: ${ESTADOS_OC[r.estado].etiqueta}` });
      if (!oc) navegar(`/compras/oc/${r.id}`, { replace: true });
    });

  const eliminar = () =>
    ejecutar(async () => {
      await api(`/compras/ordenes/${oc!.id}`, { metodo: 'DELETE' });
      notifications.show({ color: 'green', message: 'Borrador eliminado' });
      navegar('/compras/oc');
    });

  if (id && !oc && !error) return <Loader size="sm" />;

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>{oc?.numero ? `Orden de compra ${numeroInterno(oc.numero)}` : oc ? 'Orden de compra (borrador)' : 'Nueva orden de compra'}</Title>
        {oc && <Badge color={ESTADOS_OC[oc.estado].color} variant="light">{ESTADOS_OC[oc.estado].etiqueta}</Badge>}
      </Group>
      <Stack>
        {error && (
          <Alert color="red">
            {error.mensaje}
            {error.campos && Object.entries(error.campos).map(([k, v]) => <div key={k}>{k}: {v}</div>)}
          </Alert>
        )}
        {oc?.motivoRechazo && oc.estado === 'BORRADOR' && <Alert color="yellow">Rechazada: {oc.motivoRechazo}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Proveedor" withAsterisk searchable data={m.opcionesProveedor} value={cab.terceroId || null} disabled={!editable} onChange={(v) => setCab({ ...cab, terceroId: v ?? '' })} />
          <TextInput label="Fecha" type="date" value={cab.fecha} disabled={!editable} onChange={(e) => setCab({ ...cab, fecha: e.currentTarget.value })} />
          <TextInput label="Fecha de entrega" type="date" value={cab.fechaEntrega} disabled={!editable} onChange={(e) => setCab({ ...cab, fechaEntrega: e.currentTarget.value })} />
          <Select label="Moneda" data={[{ value: 'ARS', label: 'Pesos' }, { value: 'USD', label: 'Dólares' }]} value={cab.monedaCodigo} disabled={!editable} allowDeselect={false} onChange={(v) => setCab({ ...cab, monedaCodigo: v ?? 'ARS' })} />
          <Select label="Lugar de entrega" clearable data={m.depositos} value={cab.depositoId || null} disabled={!editable} onChange={(v) => setCab({ ...cab, depositoId: v ?? '' })} />
        </SimpleGrid>
        <GrillaRenglones renglones={renglones} onChange={editable ? setRenglones : () => {}} discriminaIva articulos={m.articulos} centrosCosto={m.centros} moneda={cab.monedaCodigo} permitirAgregar={editable} />
        <Textarea label="Observaciones" value={cab.observaciones} disabled={!editable} onChange={(e) => setCab({ ...cab, observaciones: e.currentTarget.value })} />
        <Group justify="flex-end">
          {oc && <Button variant="default" onClick={() => navegar('/compras/oc')}>Volver a la lista</Button>}
          {editable && oc && <Button color="red" variant="light" loading={ocupado} onClick={eliminar}>Eliminar borrador</Button>}
          {editable && <Button variant="default" loading={ocupado} onClick={guardar}>Guardar borrador</Button>}
          {editable && <Button loading={ocupado} onClick={confirmar}>Confirmar</Button>}
        </Group>
      </Stack>
    </Paper>
  );
}
