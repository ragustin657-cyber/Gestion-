import { PROVINCIAS_ARBA } from '@gestion/shared';
import { Alert, Button, Group, Modal, NumberInput, PasswordInput, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar, ErrorApi } from '../api/cliente';

/** E57: COT de ARBA en los remitos. */

export type EstadoCot = 'SIN_PEDIR' | 'PENDIENTE' | 'OTORGADO' | 'RECHAZADO' | 'NO_CORRESPONDE' | null;
export interface Traslado { calle?: string; numero?: string; codigoPostal?: string; localidad?: string; provincia?: string | null; transportistaId?: string | null; patente?: string; patenteAcoplado?: string; importeDeclarado?: string | number; fechaSalida?: string; horaSalida?: string }
export interface Transportista { id: string; razonSocial: string; cuit: string; patentePorDefecto: string | null }

const ESTADOS: Record<string, string> = { SIN_PEDIR: 'Sin pedir', PENDIENTE: 'Pendiente', RECHAZADO: 'Rechazado', NO_CORRESPONDE: 'No corresponde', OTORGADO: 'Otorgado' };
export const etiquetaCot = (r: { cot: string | null; cotEstado: EstadoCot }) => (r.cotEstado === 'OTORGADO' && r.cot ? r.cot : r.cotEstado ? ESTADOS[r.cotEstado] : '—');
export const puedePedirCot = (e: EstadoCot) => e === 'SIN_PEDIR' || e === 'PENDIENTE' || e === 'RECHAZADO';
export const PROVINCIAS = Object.entries(PROVINCIAS_ARBA).map(([value, label]) => ({ value, label }));

export interface FormConfigCot { activo: boolean; ambiente: string; usuario: string; clave: string; pedirAlConfirmar: boolean; borrarClave?: boolean }
/** La clave solo se manda si se escribió una nueva; E59: `borrarClave` la borra (null). */
export const cuerpoConfigCot = ({ clave, borrarClave, ...resto }: FormConfigCot): Partial<Omit<FormConfigCot, 'clave'>> & { clave?: string | null } => (borrarClave ? { ...resto, clave: null } : clave ? { ...resto, clave } : resto);

/** Revisión E59: el aviso usa el estado del COT solo tras pedirlo; las demás acciones muestran su propio mensaje. */
export const avisoTrasAccionCot = (r: { cotEstado?: EstadoCot; cotMensaje?: string | null } | undefined, esPedido: boolean, ok: string) =>
  esPedido && r && 'cotEstado' in r ? etiquetaResultadoCot({ cotEstado: r.cotEstado ?? null, cotMensaje: r.cotMensaje }) : { color: 'green', texto: ok };

/** E59: resultado del pedido del COT para el aviso (rojo si ARBA lo rechazó). */
export const etiquetaResultadoCot = (r: { cotEstado: EstadoCot; cotMensaje?: string | null }) =>
  r.cotEstado === 'RECHAZADO' ? { color: 'red', texto: `ARBA rechazó el COT: ${r.cotMensaje ?? ''}`.trim() }
  : r.cotEstado === 'OTORGADO' ? { color: 'green', texto: 'COT otorgado' } : { color: 'orange', texto: r.cotMensaje ?? 'COT pendiente' };

/**
 * Cuerpo del traslado para la API. En el alta los vacíos se omiten (el servidor los propone); en la edición un campo vaciado va
 * como null para borrarlo (revisión E57).
 */
export const cuerpoTraslado = (t: Traslado, edicion = false) => Object.fromEntries(Object.entries({ ...t, importeDeclarado: t.importeDeclarado === '' || t.importeDeclarado == null ? (edicion && t.importeDeclarado === '' ? null : undefined) : Number(t.importeDeclarado) })
  .map(([k, v]) => [k, edicion && v === '' ? null : v]).filter(([, v]) => v !== '' && v !== undefined));

export const useTransportistas = () => useQuery({ queryKey: ['/transportistas'], queryFn: () => api<(Transportista & { activo: boolean })[]>('/transportistas') }).data?.filter((t) => t.activo) ?? [];

export function SeccionTraslado({ valor, onChange, transportistas, etiquetaDomicilio = 'Destino' }: { valor: Traslado; onChange: (t: Traslado) => void; transportistas: Transportista[]; etiquetaDomicilio?: string }) {
  const c = (x: Partial<Traslado>) => onChange({ ...valor, ...x });
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>{`Traslado (COT de ARBA) · ${etiquetaDomicilio}: vacío = el domicilio de entrega del cliente`}</Text>
      <Group align="flex-end">
        <TextInput label="Calle" w={200} value={valor.calle ?? ''} onChange={(e) => c({ calle: e.currentTarget.value })} />
        <TextInput label="Número" w={90} value={valor.numero ?? ''} onChange={(e) => c({ numero: e.currentTarget.value })} />
        <TextInput label="Código postal" w={110} value={valor.codigoPostal ?? ''} onChange={(e) => c({ codigoPostal: e.currentTarget.value })} />
        <TextInput label="Localidad" w={170} value={valor.localidad ?? ''} onChange={(e) => c({ localidad: e.currentTarget.value })} />
        <Select label="Provincia" w={200} clearable searchable data={PROVINCIAS} value={valor.provincia ?? null} onChange={(v) => c({ provincia: v })} />
      </Group>
      <Group align="flex-end">
        <Select label="Transportista" w={240} allowDeselect={false} data={[{ value: '', label: 'Transporte propio' }, ...transportistas.map((t) => ({ value: t.id, label: t.razonSocial }))]} value={valor.transportistaId ?? ''}
          onChange={(v) => { const t = transportistas.find((x) => x.id === v); c({ transportistaId: v || null, patente: t?.patentePorDefecto ?? '' }); }} />
        <TextInput label="Patente" w={120} value={valor.patente ?? ''} onChange={(e) => c({ patente: e.currentTarget.value.toUpperCase() })} />
        <TextInput label="Acoplado" w={120} value={valor.patenteAcoplado ?? ''} onChange={(e) => c({ patenteAcoplado: e.currentTarget.value.toUpperCase() })} />
        <TextInput label="Fecha de salida" type="date" w={160} value={valor.fechaSalida ?? ''} onChange={(e) => c({ fechaSalida: e.currentTarget.value })} />
        <TextInput label="Hora de salida (HHMM)" w={150} placeholder="La de confirmación" value={valor.horaSalida ?? ''} onChange={(e) => c({ horaSalida: e.currentTarget.value.replace(/\D/g, '').slice(0, 4) })} />
        <NumberInput label="Importe declarado (sin IVA)" w={200} min={0} decimalScale={2} decimalSeparator="," thousandSeparator="." placeholder="Del pedido o la lista" value={valor.importeDeclarado ?? ''} onChange={(v) => c({ importeDeclarado: v })} />
      </Group>
    </Stack>
  );
}

/** Acciones del COT en la consulta de remitos. */
export interface RemitoCot { id: string; cot: string | null; cotEstado: EstadoCot; cotMensaje?: string | null; estado: string; trasladoCalle?: string | null; trasladoNumero?: string | null; trasladoCodigoPostal?: string | null; trasladoLocalidad?: string | null; trasladoProvincia?: string | null; transportistaId?: string | null; patente?: string | null; patenteAcoplado?: string | null; importeDeclarado?: string | null; fechaSalida?: string | null; horaSalida?: string | null }

export function AccionesCot({ remito, onCambio }: { remito: RemitoCot; onCambio: () => void }) {
  const transportistas = useTransportistas();
  const [error, setError] = useState('');
  const [cargar, setCargar] = useState(false);
  const [cot, setCot] = useState('');
  const [editar, setEditar] = useState<Traslado | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  if (remito.estado === 'ANULADO' || !remito.cotEstado) return null;
  const hacer = async (fn: () => Promise<unknown>, ok: string, esPedido = false) => {
    setError('');
    try {
      const r = await fn() as { cotEstado?: EstadoCot; cotMensaje?: string | null } | undefined;
      // E59: un pedido rechazado por ARBA no muestra el aviso verde
      const e = avisoTrasAccionCot(r, esPedido, ok);
      notifications.show({ color: e.color, message: e.texto }); onCambio(); return e.color !== 'red';
    } catch (e) { setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado'); onCambio(); return false; }
  };
  return (
    <>
      {puedePedirCot(remito.cotEstado) && <Button size="compact-xs" variant="light" loading={pidiendo} disabled={pidiendo} onClick={() => { setPidiendo(true); void hacer(() => api(`/ventas/remitos/${remito.id}/cot`, { metodo: 'POST' }), 'Pedido del COT enviado', true).finally(() => setPidiendo(false)); }}>Pedir COT</Button>}
      {puedePedirCot(remito.cotEstado) && <Button size="compact-xs" variant="subtle" onClick={() => void descargar(`/ventas/remitos/${remito.id}/cot/archivo`, {}).catch((e) => setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado'))}>Archivo COT</Button>}
      {puedePedirCot(remito.cotEstado) && <Button size="compact-xs" variant="subtle" onClick={() => setCargar(true)}>Cargar COT</Button>}
      {remito.cotEstado !== 'OTORGADO' && <Button size="compact-xs" variant="subtle" onClick={() => setEditar({ calle: remito.trasladoCalle ?? '', numero: remito.trasladoNumero ?? '', codigoPostal: remito.trasladoCodigoPostal ?? '', localidad: remito.trasladoLocalidad ?? '', provincia: remito.trasladoProvincia ?? null, transportistaId: remito.transportistaId ?? null, patente: remito.patente ?? '', patenteAcoplado: remito.patenteAcoplado ?? '', importeDeclarado: remito.importeDeclarado ? Number(remito.importeDeclarado) : '', fechaSalida: remito.fechaSalida?.slice(0, 10) ?? '', horaSalida: remito.horaSalida ?? '' })}>Editar traslado</Button>}
      {remito.cotMensaje && <Text size="xs" c="dimmed">{remito.cotMensaje}</Text>}
      {error && <Text size="xs" c="red">{error}</Text>}
      <Modal opened={cargar} onClose={() => setCargar(false)} title="Cargar COT">
        <TextInput label="COT" description="16 dígitos, el que devolvió ARBA al subir el archivo" value={cot} onChange={(e) => setCot(e.currentTarget.value.replace(/\D/g, ''))} />
        <Group mt="md"><Button disabled={cot.length !== 16} onClick={() => void hacer(() => api(`/ventas/remitos/${remito.id}/cot`, { metodo: 'PUT', body: { cot } }), 'COT cargado').then((ok) => ok && setCargar(false))}>Guardar</Button></Group>
      </Modal>
      <Modal opened={!!editar} onClose={() => setEditar(null)} title="Datos del traslado" size="xl">
        {editar && <SeccionTraslado valor={editar} onChange={setEditar} transportistas={transportistas} />}
        <Group mt="md"><Button onClick={() => void hacer(() => api(`/ventas/remitos/${remito.id}/traslado`, { metodo: 'PUT', body: cuerpoTraslado(editar ?? {}, true) }), 'Traslado guardado').then((ok) => ok && setEditar(null))}>Guardar</Button></Group>
      </Modal>
    </>
  );
}

/** Configuración del COT (en Impuestos → Configuración). */
export function ConfigCot() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/ventas/cot/config'], queryFn: () => api<{ activo: boolean; ambiente: string; usuario: string | null; pedirAlConfirmar: boolean; tieneClave: boolean }>('/ventas/cot/config') });
  const [f, setF] = useState<FormConfigCot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (q.data) setF({ activo: q.data.activo, ambiente: q.data.ambiente, usuario: q.data.usuario ?? '', clave: '', pedirAlConfirmar: q.data.pedirAlConfirmar }); }, [q.data]);
  if (!f) return null;
  const guardar = async () => {
    setError('');
    try {
      await api('/ventas/cot/config', { metodo: 'PUT', body: { ...cuerpoConfigCot(f), usuario: f.usuario || null } });
      notifications.show({ color: 'green', message: 'Configuración del COT guardada' });
      void qc.invalidateQueries({ queryKey: ['/ventas/cot/config'] });
    } catch (e) { setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado'); }
  };
  return (
    <Stack gap="xs">
      <Title order={5}>COT de ARBA</Title>
      <Switch label="Pedir COT en los remitos" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.currentTarget.checked })} />
      <Group align="flex-end">
        <Select label="Ambiente" w={180} allowDeselect={false} data={[{ value: 'SIMULADO', label: 'Simulado' }, { value: 'PRUEBA', label: 'Prueba (ARBA)' }, { value: 'PRODUCCION', label: 'Producción' }]} value={f.ambiente} onChange={(v) => setF({ ...f, ambiente: v ?? 'SIMULADO' })} />
        <TextInput label="Usuario (CUIT)" w={180} value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.currentTarget.value.replace(/\D/g, '') })} />
        <PasswordInput label="Clave CIT" w={200} placeholder={q.data?.tieneClave ? 'Clave cargada (vacío = no cambia)' : ''} value={f.clave} onChange={(e) => setF({ ...f, clave: e.currentTarget.value, borrarClave: false })} />
        {q.data?.tieneClave && <Button variant="subtle" color="red" onClick={() => setF({ ...f, clave: '', borrarClave: true })}>{f.borrarClave ? 'Se borrará al guardar' : 'Borrar clave'}</Button>}
      </Group>
      <Switch label="Pedir el COT al confirmar el remito" checked={f.pedirAlConfirmar} onChange={(e) => setF({ ...f, pedirAlConfirmar: e.currentTarget.checked })} />
      {error && <Alert color="red">{error}</Alert>}
      <Group><Button onClick={() => void guardar()}>Guardar COT</Button></Group>
    </Stack>
  );
}
