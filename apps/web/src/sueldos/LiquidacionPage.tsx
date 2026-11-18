import { Alert, Badge, Button, Card, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, opcionesCajas, opcionesCuentas, useCajas, useCuentasBancarias, useOperacion } from '../tesoreria/comun';
import { PanelPagos } from './PanelPagos';
import { DialogoBaja, TarjetaEgreso } from './DialogoBaja';
import { DESTINOS_CONTRIBUCION, DestinoContribucion, formatoCuil, useConceptos, LiquidacionDetalle, Novedad, periodoLiquidacion, Recibo } from './comun';

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
export function PanelNovedades({ novedades, onCambiar, deshabilitado, conceptosFijos = [] }: { novedades: Novedad[]; onCambiar: (n: Novedad[]) => void; deshabilitado?: boolean; conceptosFijos?: { id: string; codigo: string; nombre: string }[] }) {
  const inicial = () => Object.fromEntries(CAMPOS.map((c) => [c.tipo, novedades.find((n) => n.tipo === c.tipo)?.cantidad ?? 0])) as Record<string, number>;
  // Las novedades cargadas por una liquidación de comisiones (E24) se muestran pero no se editan ni se envían
  const deComisiones = novedades.filter((n) => n.liquidacionComisionesId);
  const manuales = novedades.filter((n) => !n.liquidacionComisionesId);
  const inicialImportes = () => Object.fromEntries(conceptosFijos.map((c) => [c.id, manuales.find((n) => n.tipo === 'IMPORTE' && n.conceptoId === c.id)?.importe ?? 0])) as Record<string, number>;
  const [valores, setValores] = useState(inicial);
  const [importes, setImportes] = useState(inicialImportes);
  useEffect(() => { setValores(inicial()); setImportes(inicialImportes()); }, [JSON.stringify(novedades), conceptosFijos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Se conservan las novedades de importe de conceptos que no se muestran (p. ej. inactivos)
  const otras = manuales.filter((n) => !CAMPOS.some((c) => c.tipo === n.tipo) && !(n.tipo === 'IMPORTE' && conceptosFijos.some((c) => c.id === n.conceptoId)));
  const guardar = () => onCambiar([
    ...CAMPOS.filter((c) => Number(valores[c.tipo]) > 0).map((c) => ({ tipo: c.tipo, cantidad: Number(valores[c.tipo]) })),
    ...conceptosFijos.filter((c) => Number(importes[c.id]) > 0).map((c) => ({ tipo: 'IMPORTE' as const, conceptoId: c.id, importe: Number(importes[c.id]) })),
    ...otras,
  ]);
  return (
    <Stack gap="xs">
      <Group align="flex-end">
        {CAMPOS.map((c) => (
          <NumberInput key={c.tipo} label={c.etiqueta} min={0} decimalScale={2} decimalSeparator="," w={190} disabled={deshabilitado}
            value={valores[c.tipo] || ''} onChange={(v) => setValores((x) => ({ ...x, [c.tipo]: Number(v) || 0 }))} />
        ))}
      </Group>
      {conceptosFijos.length > 0 && (
        <Group align="flex-end">
          {conceptosFijos.map((c) => (
            <NumberInput key={c.id} label={`${c.codigo} ${c.nombre}`} min={0} decimalScale={2} decimalSeparator="," thousandSeparator="." w={190} disabled={deshabilitado}
              value={importes[c.id] || ''} onChange={(v) => setImportes((x) => ({ ...x, [c.id]: Number(v) || 0 }))} />
          ))}
        </Group>
      )}
      {deComisiones.map((n, i) => <Text key={i} size="sm" c="dimmed">{`${n.detalle ?? 'Comisiones'}: ${formatoMoneda(n.importe ?? 0)} (de la liquidación de comisiones)`}</Text>)}
      <Group justify="flex-end"><Button variant="light" onClick={guardar} disabled={deshabilitado}>Guardar novedades</Button></Group>
    </Stack>
  );
}

/** Empleados de la liquidación con sus totales, errores y el botón de cierre (deshabilitado con errores). */
export function TablaLiquidacion({ datos, onElegir, onCerrar, puedeLiquidar = true, enviando = false }: { datos: LiquidacionDetalle; onElegir: (r: Recibo) => void; onCerrar?: () => void; puedeLiquidar?: boolean; enviando?: boolean }) {
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
          <Button onClick={onCerrar} loading={enviando} disabled={datos.errores.length > 0 || !datos.recibos.length}>Cerrar liquidación</Button>
        </Group>
      )}
    </Stack>
  );
}

/** Descarga del Libro de Sueldos Digital de una liquidación cerrada, con su número del Libro (spec E30 §6). */
export function AccionesLibro({ estado, numeroLsd, onDescargar }: { estado: string; numeroLsd?: number | null; onDescargar: () => void }) {
  if (estado !== 'CERRADA') return null;
  return (
    <>
      <Button size="xs" variant="light" onClick={onDescargar}>Libro de Sueldos Digital</Button>
      {numeroLsd ? <Text size="sm" c="dimmed">{`Liquidación N° ${numeroLsd} del Libro`}</Text> : null}
    </>
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
  const [editarEgreso, setEditarEgreso] = useState(false);
  const conceptosFijos = (useConceptos().data ?? []).filter((c) => c.tipo === 'FIJO' && c.activo).map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));
  const [pago, setPago] = useState<{ reciboIds: string[]; fecha: string; origen: string | null } | null>(null);
  const bancos = useCuentasBancarias().filter((c) => c.monedaCodigo === 'ARS');
  const cajas = useCajas().filter((c) => c.monedaCodigo === 'ARS');
  const origenes = [...opcionesCuentas(bancos).map((o) => ({ ...o, value: `b:${o.value}` })), ...opcionesCajas(cajas).map((o) => ({ ...o, value: `c:${o.value}` }))];
  const l = q.data;
  const recibo = l?.recibos.find((r) => r.empleadoId === elegido) ?? null;
  const liquidar = puede('sueldos.liquidar');
  const accion = async (fn: () => Promise<unknown>, mensaje: string) => {
    const r = await op.ejecutar(fn, () => mensaje);
    if (r) { qc.setQueryData(clave, r); void qc.invalidateQueries({ queryKey: ['/sueldos/liquidaciones'] }); void qc.invalidateQueries({ queryKey: ['/sueldos/cargas-sociales'] }); }
    return r;
  };
  if (!l) return <Paper withBorder p="md">{errorConsulta(q.error) ?? 'Cargando…'}</Paper>;
  const nombre = `${l.anio}-${String(l.mes).padStart(2, '0')}${l.tipo === 'SAC' ? '-sac' : l.tipo === 'FINAL' ? `-final-legajo-${l.egreso?.empleado?.legajo ?? ''}` : ''}`;
  const bajar = (ruta: string, query: Record<string, string>, archivo: string) => op.ejecutar(() => descargar(ruta, query, archivo), () => 'Archivo descargado');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Group>
          <Title order={3}>Liquidación {periodoLiquidacion({ ...l, empleado: l.egreso?.empleado })}</Title>
          <Badge color={l.estado === 'CERRADA' ? 'green' : 'yellow'}>{l.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</Badge>
        </Group>
        <Group>
          <Button variant="default" size="xs" onClick={() => navegar('/sueldos/liquidaciones')}>Volver</Button>
          <Button variant="light" size="xs" onClick={() => bajar(`/sueldos/liquidaciones/${id}/recibos.pdf`, {}, `recibos-${nombre}.pdf`)}>Recibos PDF</Button>
          <Button variant="light" size="xs" onClick={() => bajar(`/sueldos/liquidaciones/${id}/resumen`, { formato: 'xlsx' }, `resumen-sueldos-${nombre}.xlsx`)}>Resumen Excel</Button>
          <Button variant="light" size="xs" onClick={() => bajar(`/sueldos/liquidaciones/${id}/resumen`, { formato: 'pdf' }, `resumen-sueldos-${nombre}.pdf`)}>Resumen PDF</Button>
          {liquidar && l.estado === 'BORRADOR' && <Button variant="light" size="xs" loading={op.enviando} onClick={() => accion(() => api(`/sueldos/liquidaciones/${id}/recalcular`, { metodo: 'POST' }), 'Liquidación recalculada')}>Recalcular</Button>}
          {liquidar && <Button variant="light" size="xs" onClick={() => setDeposito({ fecha: l.ultimoDepositoFecha ?? '', banco: l.ultimoDepositoBanco ?? '', periodo: l.ultimoDepositoPeriodo ?? '' })}>Último depósito</Button>}
          {liquidar && l.estado === 'CERRADA' && <Button variant="light" color="orange" size="xs" loading={op.enviando} onClick={() => accion(() => api(`/sueldos/liquidaciones/${id}/reabrir`, { metodo: 'POST' }), 'Liquidación reabierta')}>Reabrir</Button>}
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Fecha de pago {formatoFecha(l.fechaPago)} · Último depósito: {l.ultimoDepositoFecha ? `${formatoFecha(l.ultimoDepositoFecha)} · ${l.ultimoDepositoBanco} · período ${l.ultimoDepositoPeriodo}` : 'sin informar'}
      </Text>
      {op.alerta}
      {l.egreso && <TarjetaEgreso egreso={l.egreso} onEditar={liquidar && l.estado === 'BORRADOR' ? () => setEditarEgreso(true) : undefined} />}
      {l.egreso?.empleado && (
        <Modal opened={editarEgreso} onClose={() => setEditarEgreso(false)} title="Editar egreso">
          <DialogoBaja empleado={l.egreso.empleado} causaInicial={l.egreso.causa} textoBoton="Guardar" enviando={op.enviando}
            inicial={{ fechaEgreso: l.egreso.fechaEgreso, fechaPago: l.fechaPago, preavisoOtorgado: l.egreso.preavisoOtorgado, gratificacion: Number(l.egreso.gratificacion) || undefined, mejorRemuneracion: l.egreso.mejorRemuneracion ? Number(l.egreso.mejorRemuneracion) : undefined }}
            onConfirmar={async ({ empleadoId: _e, ...d }) => { if (await accion(() => api(`/sueldos/egresos/${id}`, { metodo: 'PUT', body: d }), 'Egreso actualizado')) setEditarEgreso(false); }} />
          {op.alerta}
        </Modal>
      )}
      {l.contribuciones && (
        <SimpleGrid cols={{ base: 2, sm: 5 }} mb="md">
          {(Object.keys(DESTINOS_CONTRIBUCION) as DestinoContribucion[]).map((k) => (
            <Card key={k} withBorder padding="xs"><Text size="xs" c="dimmed">{DESTINOS_CONTRIBUCION[k]}</Text><Text fw={600}>{formatoMoneda(l.contribuciones!.porDestino[k])}</Text></Card>
          ))}
          <Card withBorder padding="xs"><Text size="xs" c="dimmed">Contribuciones patronales{l.estado === 'BORRADOR' ? ' (estimadas)' : ''}</Text><Text fw={700}>{formatoMoneda(l.contribuciones.total)}</Text></Card>
        </SimpleGrid>
      )}
      {l.estado === 'CERRADA' && (
        <Group mb="sm">
          {l.asiento ? <Text size="sm">Asiento N° <Text span fw={600} c="blue" style={{ cursor: 'pointer' }} onClick={() => navegar(`/contabilidad/asientos/${l.asiento!.id}`)}>{l.asiento.numero}</Text></Text>
            : liquidar && <Button size="xs" variant="light" loading={op.enviando} onClick={() => accion(() => api(`/sueldos/liquidaciones/${id}/contabilizar`, { metodo: 'POST' }), 'Liquidación contabilizada')}>Contabilizar</Button>}
          <Button size="xs" variant="light" onClick={() => bajar('/sueldos/f931', { anio: String(l.anio), mes: String(l.mes) }, `F931-${l.anio}${String(l.mes).padStart(2, '0')}.txt`)}>Descargar F.931</Button>
          <AccionesLibro estado={l.estado} numeroLsd={l.numeroLsd} onDescargar={async () => {
            await bajar(`/sueldos/liquidaciones/${id}/lsd`, {}, `LSD-${l.anio}${String(l.mes).padStart(2, '0')}.txt`);
            // La primera descarga asigna el número del Libro
            void qc.invalidateQueries({ queryKey: clave });
          }} />
        </Group>
      )}
      <Tabs defaultValue="recibos">
        <Tabs.List>
          <Tabs.Tab value="recibos">Recibos</Tabs.Tab>
          {l.estado === 'CERRADA' && <Tabs.Tab value="pagos">Pagos{l.pendientePago && Number(l.pendientePago) > 0 ? ` (pendiente ${formatoMoneda(l.pendientePago)})` : ''}</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="recibos" pt="sm">
          <TablaLiquidacion datos={l} puedeLiquidar={liquidar} enviando={op.enviando} onElegir={(r) => setElegido(r.empleadoId)} onCerrar={() => accion(() => api(`/sueldos/liquidaciones/${id}/cerrar`, { metodo: 'POST' }), 'Liquidación cerrada')} />
        </Tabs.Panel>
        {l.estado === 'CERRADA' && (
          <Tabs.Panel value="pagos" pt="sm">
            <PanelPagos recibos={l.recibos} pagados={l.pagos?.length ?? 0} deshabilitado={!liquidar || !l.asiento} onPagar={(ids) => setPago({ reciboIds: ids, fecha: hoy(), origen: null })} />
            <Title order={5} mt="md" mb="xs">Pagos registrados</Title>
            <Table withTableBorder striped>
              <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Desde</Table.Th><Table.Th ta="right">Empleados</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {(l.pagos ?? []).map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{p.numero}</Table.Td><Table.Td>{formatoFecha(p.fecha)}</Table.Td><Table.Td>{p.cuenta}</Table.Td><Table.Td ta="right">{p.empleados}</Table.Td><Table.Td ta="right">{formatoMoneda(p.importe)}</Table.Td>
                    <Table.Td>{p.anulado ? <Badge color="gray" variant="light">Anulado</Badge> : <Badge color="green" variant="light">Vigente</Badge>}</Table.Td>
                    <Table.Td>{liquidar && !p.anulado && <Button size="compact-xs" variant="subtle" color="red" disabled={op.enviando} onClick={() => accion(async () => { await api(`/sueldos/pagos/${p.id}/anular`, { metodo: 'POST' }); return api(`/sueldos/liquidaciones/${id}`); }, 'Pago anulado')}>Anular</Button>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
        )}
      </Tabs>
      <Modal opened={!!pago} onClose={() => setPago(null)} title="Pagar sueldos">
        {pago && (
          <Stack>
            <Text size="sm">{pago.reciboIds.length} recibo(s) por {formatoMoneda(l.recibos.filter((r) => pago.reciboIds.includes(r.id)).reduce((s, r) => s + Number(r.neto), 0))}</Text>
            <TextInput type="date" label="Fecha" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.currentTarget.value })} />
            <Select label="Desde" data={origenes} value={pago.origen} onChange={(v) => setPago({ ...pago, origen: v })} />
            {op.alerta}
            <Button disabled={!pago.origen} loading={op.enviando} onClick={async () => {
              const [t, o] = pago.origen!.split(':');
              const body = { fecha: pago.fecha, reciboIds: pago.reciboIds, ...(t === 'b' ? { cuentaBancariaId: o } : { cajaId: o }) };
              if (await accion(async () => { await api(`/sueldos/liquidaciones/${id}/pagos`, { metodo: 'POST', body }); return api(`/sueldos/liquidaciones/${id}`); }, 'Pago registrado')) setPago(null);
            }}>Pagar</Button>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!recibo} onClose={() => setElegido(null)} size="xl" title={recibo ? `Legajo ${recibo.legajo} · ${recibo.apellido}, ${recibo.nombre}` : ''}>
        {recibo && (
          <Stack>
            <Text size="sm">CUIL {formatoCuil(recibo.cuil)} · {recibo.categoria} · Ingreso {formatoFecha(recibo.fechaIngreso)} · Antigüedad {recibo.antiguedadAnios} años · Días trabajados {recibo.diasTrabajados}</Text>
            {l.tipo === 'MENSUAL' && (
              <PanelNovedades novedades={recibo.novedades} conceptosFijos={conceptosFijos} deshabilitado={!liquidar || l.estado === 'CERRADA'}
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
