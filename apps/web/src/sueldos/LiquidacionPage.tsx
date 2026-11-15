import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { formatoCuil, LiquidacionDetalle, Novedad, periodoLiquidacion, Recibo } from './comun';

const cantidad = (x: Recibo['renglones'][number]) =>
  x.porcentaje !== null && x.base !== null ? `${formatoMoneda(x.base)} × ${Number(x.porcentaje).toLocaleString('es-AR')} %` : x.cantidad !== null ? Number(x.cantidad).toLocaleString('es-AR') : '';

/** Detalle de un recibo: un renglón por concepto con su importe en la columna de su clase. */
export function TablaRecibo({ recibo }: { recibo: Recibo }) {
  const celda = (clase: string, x: Recibo['renglones'][number]) => <Table.Td ta="right">{x.clase === clase ? formatoMoneda(x.importe) : ''}</Table.Td>;
  return (
    <Table withTableBorder striped>
      <Table.Thead>
        <Table.Tr><Table.Th>Cód.</Table.Th><Table.Th>Concepto</Table.Th><Table.Th ta="right">Cantidad / Base</Table.Th><Table.Th ta="right">Remunerativo</Table.Th><Table.Th ta="right">No remunerativo</Table.Th><Table.Th ta="right">Descuentos</Table.Th></Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {recibo.renglones.map((x) => (
          <Table.Tr key={x.codigo}>
            <Table.Td>{x.codigo}</Table.Td><Table.Td>{x.nombre}</Table.Td><Table.Td ta="right">{cantidad(x)}</Table.Td>
            {celda('REMUNERATIVO', x)}{celda('NO_REMUNERATIVO', x)}{celda('DESCUENTO', x)}
          </Table.Tr>
        ))}
        <Table.Tr fw={700}>
          <Table.Td /><Table.Td>Totales</Table.Td><Table.Td />
          <Table.Td ta="right">{formatoMoneda(recibo.totalRemunerativo)}</Table.Td><Table.Td ta="right">{formatoMoneda(recibo.totalNoRemunerativo)}</Table.Td><Table.Td ta="right">{formatoMoneda(recibo.totalDescuentos)}</Table.Td>
        </Table.Tr>
      </Table.Tbody>
      <Table.Caption style={{ captionSide: 'bottom', textAlign: 'right', fontWeight: 700 }}>{`Neto ${formatoMoneda(recibo.neto)}`}</Table.Caption>
    </Table>
  );
}

const CAMPOS: { tipo: Novedad['tipo']; etiqueta: string; importe?: boolean }[] = [
  { tipo: 'HORAS_EXTRA_50', etiqueta: 'Horas extra 50 %' },
  { tipo: 'HORAS_EXTRA_100', etiqueta: 'Horas extra 100 %' },
  { tipo: 'AUSENCIA_INJUSTIFICADA', etiqueta: 'Días de ausencia injustificada' },
];

/** Novedades del mes de un empleado: horas extra y ausencias. */
export function PanelNovedades({ novedades, onCambiar, deshabilitado }: { novedades: Novedad[]; onCambiar: (n: Novedad[]) => void; deshabilitado?: boolean }) {
  const inicial = () => Object.fromEntries(CAMPOS.map((c) => [c.tipo, novedades.find((n) => n.tipo === c.tipo)?.cantidad ?? 0])) as Record<string, number>;
  const [valores, setValores] = useState(inicial);
  useEffect(() => setValores(inicial()), [JSON.stringify(novedades)]); // eslint-disable-line react-hooks/exhaustive-deps
  const otras = novedades.filter((n) => !CAMPOS.some((c) => c.tipo === n.tipo));
  const guardar = () => onCambiar([...CAMPOS.filter((c) => Number(valores[c.tipo]) > 0).map((c) => ({ tipo: c.tipo, cantidad: Number(valores[c.tipo]) })), ...otras]);
  return (
    <Group align="flex-end">
      {CAMPOS.map((c) => (
        <NumberInput key={c.tipo} label={c.etiqueta} min={0} decimalScale={2} decimalSeparator="," w={190} disabled={deshabilitado}
          value={valores[c.tipo] || ''} onChange={(v) => setValores((x) => ({ ...x, [c.tipo]: Number(v) || 0 }))} />
      ))}
      <Button variant="light" onClick={guardar} disabled={deshabilitado}>Guardar novedades</Button>
    </Group>
  );
}

/** Empleados de la liquidación con sus totales, errores y el botón de cierre (deshabilitado con errores). */
export function TablaLiquidacion({ datos, onElegir, onCerrar, puedeLiquidar = true }: { datos: LiquidacionDetalle; onElegir: (r: Recibo) => void; onCerrar?: () => void; puedeLiquidar?: boolean }) {
  const borrador = datos.estado === 'BORRADOR';
  return (
    <Stack>
      {datos.errores.length > 0 && (
        <Alert color="red" title="Empleados que no se pueden liquidar">
          {datos.errores.map((e) => <Text key={e.empleadoId} size="sm" data-error-empleado={e.empleadoId}>{e.mensaje}</Text>)}
        </Alert>
      )}
      {datos.aviso && <Alert color="yellow">{datos.aviso}</Alert>}
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead>
          <Table.Tr><Table.Th>Legajo</Table.Th><Table.Th>Empleado</Table.Th><Table.Th>CUIL</Table.Th><Table.Th>Categoría</Table.Th><Table.Th ta="right">Remunerativo</Table.Th><Table.Th ta="right">No remunerativo</Table.Th><Table.Th ta="right">Descuentos</Table.Th><Table.Th ta="right">Neto</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {datos.recibos.map((r) => (
            <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onElegir(r)}>
              <Table.Td>{r.legajo}</Table.Td><Table.Td>{r.apellido}, {r.nombre}</Table.Td><Table.Td>{formatoCuil(r.cuil)}</Table.Td><Table.Td>{r.categoria}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(r.totalRemunerativo)}</Table.Td><Table.Td ta="right">{formatoMoneda(r.totalNoRemunerativo)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(r.totalDescuentos)}</Table.Td><Table.Td ta="right">{formatoMoneda(r.neto)}</Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr fw={700}>
            <Table.Td colSpan={4}>Totales</Table.Td>
            <Table.Td ta="right">{formatoMoneda(datos.totales.remunerativo)}</Table.Td><Table.Td ta="right">{formatoMoneda(datos.totales.noRemunerativo)}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(datos.totales.descuentos)}</Table.Td><Table.Td ta="right">{formatoMoneda(datos.totales.neto)}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      {borrador && puedeLiquidar && (
        <Group justify="flex-end">
          <Button onClick={onCerrar} disabled={datos.errores.length > 0 || !datos.recibos.length}>Cerrar liquidación</Button>
        </Group>
      )}
    </Stack>
  );
}

export function LiquidacionPage() {
  const { id = '' } = useParams();
  const { puede } = useAuth();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const op = useOperacion();
  const clave = [`/sueldos/liquidaciones/${id}`];
  const q = useQuery({ queryKey: clave, queryFn: () => api<LiquidacionDetalle>(`/sueldos/liquidaciones/${id}`) });
  const [elegido, setElegido] = useState<string | null>(null);
  const [deposito, setDeposito] = useState<{ fecha: string; banco: string; periodo: string } | null>(null);
  const l = q.data;
  const recibo = l?.recibos.find((r) => r.empleadoId === elegido) ?? null;
  const liquidar = puede('sueldos.liquidar');
  const accion = async (fn: () => Promise<unknown>, mensaje: string) => {
    const r = await op.ejecutar(fn, () => mensaje);
    if (r) { qc.setQueryData(clave, r); void qc.invalidateQueries({ queryKey: ['/sueldos/liquidaciones'] }); }
    return r;
  };
  if (!l) return <Paper withBorder p="md">{errorConsulta(q.error) ?? 'Cargando…'}</Paper>;
  const nombre = `${l.anio}-${String(l.mes).padStart(2, '0')}${l.tipo === 'SAC' ? '-sac' : ''}`;
  const bajar = (ruta: string, query: Record<string, string>, archivo: string) => op.ejecutar(() => descargar(ruta, query, archivo), () => 'Archivo descargado');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Group>
          <Title order={3}>Liquidación {periodoLiquidacion(l)}</Title>
          <Badge color={l.estado === 'CERRADA' ? 'green' : 'yellow'}>{l.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</Badge>
        </Group>
        <Group>
          <Button variant="default" size="xs" onClick={() => navegar('/sueldos/liquidaciones')}>Volver</Button>
          <Button variant="light" size="xs" onClick={() => bajar(`/sueldos/liquidaciones/${id}/recibos.pdf`, {}, `recibos-${nombre}.pdf`)}>Recibos PDF</Button>
          <Button variant="light" size="xs" onClick={() => bajar(`/sueldos/liquidaciones/${id}/resumen`, { formato: 'xlsx' }, `resumen-sueldos-${nombre}.xlsx`)}>Resumen Excel</Button>
          <Button variant="light" size="xs" onClick={() => bajar(`/sueldos/liquidaciones/${id}/resumen`, { formato: 'pdf' }, `resumen-sueldos-${nombre}.pdf`)}>Resumen PDF</Button>
          {liquidar && l.estado === 'BORRADOR' && <Button variant="light" size="xs" onClick={() => accion(() => api(`/sueldos/liquidaciones/${id}/recalcular`, { metodo: 'POST' }), 'Liquidación recalculada')}>Recalcular</Button>}
          {liquidar && <Button variant="light" size="xs" onClick={() => setDeposito({ fecha: l.ultimoDepositoFecha ?? '', banco: l.ultimoDepositoBanco ?? '', periodo: l.ultimoDepositoPeriodo ?? '' })}>Último depósito</Button>}
          {liquidar && l.estado === 'CERRADA' && <Button variant="light" color="orange" size="xs" onClick={() => accion(() => api(`/sueldos/liquidaciones/${id}/reabrir`, { metodo: 'POST' }), 'Liquidación reabierta')}>Reabrir</Button>}
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Fecha de pago {formatoFecha(l.fechaPago)} · Último depósito: {l.ultimoDepositoFecha ? `${formatoFecha(l.ultimoDepositoFecha)} · ${l.ultimoDepositoBanco} · período ${l.ultimoDepositoPeriodo}` : 'sin informar'}
      </Text>
      {op.alerta}
      <TablaLiquidacion datos={l} puedeLiquidar={liquidar} onElegir={(r) => setElegido(r.empleadoId)} onCerrar={() => accion(() => api(`/sueldos/liquidaciones/${id}/cerrar`, { metodo: 'POST' }), 'Liquidación cerrada')} />
      <Modal opened={!!recibo} onClose={() => setElegido(null)} size="xl" title={recibo ? `Legajo ${recibo.legajo} · ${recibo.apellido}, ${recibo.nombre}` : ''}>
        {recibo && (
          <Stack>
            <Text size="sm">CUIL {formatoCuil(recibo.cuil)} · {recibo.categoria} · Ingreso {formatoFecha(recibo.fechaIngreso)} · Antigüedad {recibo.antiguedadAnios} años · Días trabajados {recibo.diasTrabajados}</Text>
            {l.tipo === 'MENSUAL' && (
              <PanelNovedades novedades={recibo.novedades} deshabilitado={!liquidar || l.estado === 'CERRADA'}
                onCambiar={(n) => accion(() => api(`/sueldos/liquidaciones/${id}/novedades`, { metodo: 'PUT', body: { empleadoId: recibo.empleadoId, novedades: n } }), 'Novedades guardadas')} />
            )}
            <TablaRecibo recibo={recibo} />
            <Group justify="flex-end">
              <Button variant="light" onClick={() => bajar(`/sueldos/liquidaciones/${id}/recibos.pdf`, { empleadoId: recibo.empleadoId }, `recibo-${nombre}-legajo-${recibo.legajo}.pdf`)}>Recibo PDF</Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!deposito} onClose={() => setDeposito(null)} title="Último depósito de aportes">
        {deposito && (
          <Stack>
            <TextInput type="date" label="Fecha" value={deposito.fecha} onChange={(e) => setDeposito({ ...deposito, fecha: e.currentTarget.value })} />
            <TextInput label="Banco" value={deposito.banco} onChange={(e) => setDeposito({ ...deposito, banco: e.currentTarget.value })} />
            <TextInput label="Período (MM/AAAA)" value={deposito.periodo} onChange={(e) => setDeposito({ ...deposito, periodo: e.currentTarget.value })} />
            <Button onClick={async () => { if (await accion(() => api(`/sueldos/liquidaciones/${id}/deposito`, { metodo: 'PUT', body: deposito }), 'Depósito guardado')) setDeposito(null); }}>Guardar</Button>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
