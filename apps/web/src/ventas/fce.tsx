import { Alert, Badge, Button, Checkbox, Group, Modal, MultiSelect, Paper, Select, Stack, Switch, Table, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';

/** Factura de crédito electrónica MiPyME (E50). */

export interface ConfigFceDatos { mipyme: boolean; cuentaBancariaFceId: string | null; transferenciaFce: string }
const TRANSFERENCIAS = [{ value: 'SCA', label: 'Sistema de circulación abierta (SCA)' }, { value: 'ADC', label: 'Agente de depósito colectivo (ADC)' }];
const ESTADOS: Record<string, { label: string; color: string }> = {
  PENDIENTE: { label: 'Pendiente', color: 'yellow' }, ACEPTADA: { label: 'Aceptada', color: 'green' },
  RECHAZADA: { label: 'Rechazada', color: 'red' }, ACEPTADA_TACITA: { label: 'Aceptada sola', color: 'teal' },
};
const NOMBRE_CBTE: Record<number, string> = { 0: 'FCE', 1: 'ND FCE', 2: 'NC FCE' };
const nombreCbte = (t: number) => { const b = t - 200; const letra = b <= 3 ? 'A' : b <= 8 ? 'B' : 'C'; return `${NOMBRE_CBTE[(b - (letra === 'A' ? 1 : letra === 'B' ? 6 : 11))]} ${letra}`; };
const numeroCbte = (p: number, n: number) => `${String(p).padStart(5, '0')}-${String(n).padStart(8, '0')}`;
const pesos = (s: string) => Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sección de la configuración de ARCA: MiPyME, cuenta con CBU y transferencia por defecto. */
export function ConfigFce({ config, onGuardar }: { config: ConfigFceDatos; onGuardar: (d: Partial<ConfigFceDatos>) => Promise<void> }) {
  const cuentas = useQuery({
    queryKey: ['/tesoreria/cuentas-bancarias'],
    queryFn: () => api<{ id: string; numero: string; cbu: string | null; activa: boolean; banco: { nombre: string } }[]>('/tesoreria/cuentas-bancarias'),
  }).data ?? [];
  return (
    <Stack gap="xs">
      <Title order={5}>Factura de crédito electrónica MiPyME</Title>
      <Switch label="La empresa es MiPyME" checked={config.mipyme} onChange={(e) => void onGuardar({ mipyme: e.currentTarget.checked })} />
      <Select label="Cuenta bancaria para la factura de crédito" w={420} clearable placeholder="Cuenta con CBU" value={config.cuentaBancariaFceId}
        data={cuentas.filter((c) => c.activa && c.cbu).map((c) => ({ value: c.id, label: `${c.banco.nombre} - ${c.numero} · CBU ${c.cbu}` }))}
        onChange={(v) => void onGuardar({ cuentaBancariaFceId: v })} />
      <Select label="Transferencia por defecto" w={420} allowDeselect={false} data={TRANSFERENCIAS} value={config.transferenciaFce} onChange={(v) => v && void onGuardar({ transferenciaFce: v })} />
    </Stack>
  );
}

interface Obligacion { obligado: boolean; montoMinimo: string | null; corresponde: boolean; aviso: string | null; consultadoEn: string | null }

/** Campos FCE del comprobante de venta: propone la marca cuando corresponde (una vez por cliente) y avisa el mínimo. */
export function CamposFce(p: {
  tipo: string; terceroId: string | null; fecha: string; totalPesos: number; fce: boolean; onFce: (v: boolean) => void;
  transferencia: string | null; onTransferencia: (v: string | null) => void; anulacion: boolean; onAnulacion: (v: boolean) => void; disabled?: boolean; fijo?: boolean;
}) {
  const factura = p.tipo === 'FACTURA';
  const total = Math.round(p.totalPesos * 100) / 100;
  const q = useQuery({
    queryKey: ['/ventas/fce/obligacion', p.terceroId, p.fecha, total],
    queryFn: () => api<Obligacion>('/ventas/fce/obligacion', { query: { terceroId: p.terceroId ?? '', fecha: p.fecha, total: String(total) } }),
    enabled: factura && !!p.terceroId && !!p.fecha, staleTime: 60000,
  }).data;
  const propuesto = useRef<string | null>(null);
  useEffect(() => {
    const clave = `${p.terceroId}`;
    if (q?.corresponde && !p.fce && !p.disabled && propuesto.current !== clave) {
      propuesto.current = clave;
      p.onFce(true);
    }
  }, [q?.corresponde, p.terceroId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Stack gap={4} mt="sm">
      <Group align="flex-end">
        <Checkbox label="Factura de crédito MiPyME (FCE)" checked={p.fce} disabled={p.disabled || (!factura && p.fijo)} onChange={(e) => p.onFce(e.currentTarget.checked)} />
        {factura && p.fce && <Select label="Transferencia" w={300} clearable placeholder="La de la configuración" data={TRANSFERENCIAS} value={p.transferencia} onChange={p.onTransferencia} disabled={p.disabled} />}
        {!factura && p.fce && <Checkbox label="Anulación (rechazo de la factura)" checked={p.anulacion} onChange={(e) => p.onAnulacion(e.currentTarget.checked)} disabled={p.disabled} />}
      </Group>
      {factura && q?.corresponde && <Alert color={p.fce ? 'blue' : 'orange'} p="xs">{q.montoMinimo ? `Corresponde factura de crédito: el cliente está obligado desde $ ${pesos(q.montoMinimo)}` : 'Corresponde factura de crédito: el cliente está obligado'}</Alert>}
      {factura && q?.aviso && <Alert color="yellow" p="xs">{q.aviso}</Alert>}
    </Stack>
  );
}

export interface FilaFce {
  id: string; cuitContraparte: string; cbteTipo: number; puntoVenta: number; numero: number; fecha: string; importe: string; moneda: string; fechaVencimientoPago: string | null;
  estado: string; fechaLimite: string | null; diasRestantes: number | null; motivosRechazo: string[]; comprobanteVentaId: string | null; compraCargada: boolean; cliente: string | null;
  notas: { id: string; tipo: string; numero: number | null; total: string; anulacion: boolean | null }[];
}

/** Tabla de FCE emitidas o recibidas; resalta las pendientes con 5 días o menos de plazo. */
export function TablaFce({ rol, filas, puedeResponder, onAceptar, onRechazar, onAnular }: {
  rol: 'EMISOR' | 'RECEPTOR'; filas: FilaFce[]; puedeResponder?: boolean; onAceptar?: (f: FilaFce) => void; onRechazar?: (f: FilaFce) => void; onAnular?: (f: FilaFce) => void;
}) {
  if (!filas.length) return <Text size="sm" c="dimmed">Sin facturas de crédito en los últimos 90 días.</Text>;
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr>
        <Table.Th>{rol === 'EMISOR' ? 'Cliente' : 'Proveedor'}</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Fecha</Table.Th><Table.Th ta="right">Importe</Table.Th>
        <Table.Th>Vto. del pago</Table.Th><Table.Th>Estado</Table.Th><Table.Th>Plazo</Table.Th>{rol === 'RECEPTOR' && <Table.Th>Compra</Table.Th>}<Table.Th />
      </Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((f) => {
          const urgente = f.diasRestantes !== null && f.diasRestantes <= 5;
          return (
            <Table.Tr key={f.id}>
              <Table.Td>{f.cliente ?? f.cuitContraparte}</Table.Td>
              <Table.Td>{nombreCbte(f.cbteTipo)} {numeroCbte(f.puntoVenta, f.numero)}{f.notas.length ? <Text size="xs" c="dimmed">{f.notas.map((n) => `${n.tipo === 'NOTA_CREDITO' ? 'NC' : 'ND'} ${n.numero ?? 'pendiente'} ${pesos(n.total)}${n.anulacion ? ' (anulación)' : ''}`).join(' · ')}</Text> : null}</Table.Td>
              <Table.Td>{formatoFecha(f.fecha)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.importe, f.moneda === 'DOL' ? 'USD' : 'ARS')}</Table.Td>
              <Table.Td>{formatoFecha(f.fechaVencimientoPago)}</Table.Td>
              <Table.Td><Badge color={ESTADOS[f.estado]?.color}>{ESTADOS[f.estado]?.label ?? f.estado}</Badge>{f.motivosRechazo.length ? <Text size="xs">{f.motivosRechazo.join(', ')}</Text> : null}</Table.Td>
              <Table.Td>{f.diasRestantes !== null && <Text size="sm" fw={urgente ? 700 : undefined} c={urgente ? 'red' : undefined} data-urgente={String(urgente)}>{f.diasRestantes} días</Text>}</Table.Td>
              {rol === 'RECEPTOR' && <Table.Td>{f.compraCargada ? 'Cargada' : <Text size="sm" c="orange">No cargada</Text>}</Table.Td>}
              <Table.Td>
                {rol === 'RECEPTOR' && puedeResponder && f.estado === 'PENDIENTE' && <Group gap={4}>
                  <Button size="compact-xs" onClick={() => onAceptar?.(f)}>Aceptar</Button>
                  <Button size="compact-xs" color="red" variant="light" onClick={() => onRechazar?.(f)}>Rechazar</Button>
                </Group>}
                {rol === 'EMISOR' && f.estado === 'RECHAZADA' && f.comprobanteVentaId && !f.notas.some((n) => n.anulacion) && onAnular &&
                  <Button size="compact-xs" color="red" variant="light" onClick={() => onAnular(f)}>Emitir nota de crédito de anulación</Button>}
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

/** Rechazo con uno o más motivos del registro y un texto. */
export function ModalRechazo({ abierto, motivos, onCerrar, onConfirmar }: { abierto: boolean; motivos: { codigo: string; descripcion: string }[]; onCerrar: () => void; onConfirmar: (motivos: string[], texto: string) => void }) {
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [texto, setTexto] = useState('');
  return (
    <Modal opened={abierto} onClose={onCerrar} title="Rechazar factura de crédito">
      <Stack>
        <MultiSelect label="Motivos" data={motivos.map((m) => ({ value: m.codigo, label: m.descripcion }))} value={elegidos} onChange={setElegidos} />
        <Textarea label="Detalle" maxLength={250} value={texto} onChange={(e) => setTexto(e.currentTarget.value)} />
        <Group><Button color="red" disabled={!elegidos.length} onClick={() => onConfirmar(elegidos, texto)}>Rechazar</Button></Group>
      </Stack>
    </Modal>
  );
}

const FILTRO = [{ value: '', label: 'Todos' }, ...Object.entries(ESTADOS).map(([value, e]) => ({ value, label: e.label }))];

function PaginaFce({ rol }: { rol: 'EMISOR' | 'RECEPTOR' }) {
  const base = rol === 'EMISOR' ? '/ventas/fce' : '/compras/fce';
  const qc = useQueryClient();
  const op = useOperacion();
  const navigate = useNavigate();
  const { puede } = useAuth();
  const [estado, setEstado] = useState('');
  const [rechazo, setRechazo] = useState<FilaFce | null>(null);
  const q = useQuery({ queryKey: [base, estado], queryFn: () => api<{ filas: FilaFce[]; aviso: string | null }>(base, { query: estado ? { estado } : {} }) });
  const motivos = useQuery({ queryKey: ['/compras/fce/motivos'], queryFn: () => api<{ codigo: string; descripcion: string }[]>('/compras/fce/motivos'), enabled: !!rechazo }).data ?? [];
  const refrescar = () => void qc.invalidateQueries({ queryKey: [base] });
  const avisar = (r: { aviso: string | null } | null) => { if (r?.aviso) notifications.show({ color: 'yellow', message: r.aviso }); };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>{rol === 'EMISOR' ? 'Facturas de crédito MiPyME' : 'Facturas de crédito MiPyME recibidas'}</Title>
        <Button variant="light" size="xs" loading={op.enviando} onClick={async () => { if (await op.ejecutar(() => api<{ actualizadas: number }>(`${base}/actualizar`, { metodo: 'POST' }), (r) => `${r.actualizadas} facturas de crédito actualizadas`)) refrescar(); }}>Actualizar desde ARCA</Button>
      </Group>
      <Select label="Estado" w={200} mb="md" allowDeselect={false} data={FILTRO} value={estado} onChange={(v) => setEstado(v ?? '')} />
      {q.data?.aviso && <Alert color="yellow" mb="sm">{q.data.aviso}</Alert>}
      {op.alerta}
      {q.data && <TablaFce rol={rol} filas={q.data.filas} puedeResponder={puede('fc.crear')}
        onAceptar={async (f) => { const r = await op.ejecutar(() => api<{ aviso: string | null }>(`/compras/fce/${f.id}/aceptar`, { metodo: 'POST' }), () => 'Factura de crédito aceptada'); avisar(r); refrescar(); }}
        onRechazar={setRechazo}
        onAnular={puede('venta.emitir') ? (f) => navigate(`/ventas/comprobante?anularFce=${f.comprobanteVentaId}`) : undefined} />}
      <ModalRechazo abierto={!!rechazo} motivos={motivos} onCerrar={() => setRechazo(null)}
        onConfirmar={async (m, texto) => {
          const f = rechazo!;
          const r = await op.ejecutar(() => api<{ aviso: string | null }>(`/compras/fce/${f.id}/rechazar`, { metodo: 'POST', body: { motivos: m, texto } }), () => 'Factura de crédito rechazada');
          avisar(r);
          setRechazo(null);
          refrescar();
        }} />
    </Paper>
  );
}

export const FceEmitidasPage = () => <PaginaFce rol="EMISOR" />;
export const FceRecibidasPage = () => <PaginaFce rol="RECEPTOR" />;
