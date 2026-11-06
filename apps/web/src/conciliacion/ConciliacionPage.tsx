import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useCuentasImputables } from '../abm/opciones';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { puedeConciliar, sumaSeleccion } from './seleccion';
import { SugerenciasModal } from './SugerenciasModal';
import { DetalleConciliacion, Linea, Sugerencia } from './tipos';

function Dato({ titulo, valor, testid, color, cuadra }: { titulo: string; valor: string | number; testid?: string; color?: string; cuadra?: boolean }) {
  return (
    <Paper withBorder p="xs" radius="md">
      <Text size="xs" c="dimmed">{titulo}</Text>
      <Text fw={700} c={color} data-testid={testid} data-cuadra={cuadra === undefined ? undefined : cuadra ? 'si' : 'no'}>{formatoMoneda(valor)}</Text>
    </Paper>
  );
}

export function ConciliacionPage({ idInicial }: { idInicial?: string }) {
  const params = useParams();
  const id = idInicial ?? params.id!;
  const q = useQuery({ queryKey: ['/conciliacion/conciliaciones', id], queryFn: () => api<DetalleConciliacion>(`/conciliacion/conciliaciones/${id}`) });
  const imputables = useCuentasImputables();
  const op = useOperacion();
  const [selL, setSelL] = useState<string[]>([]);
  const [selM, setSelM] = useState<string[]>([]);
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  const [registrando, setRegistrando] = useState<Linea[] | null>(null);
  const [cuentaReg, setCuentaReg] = useState<string | null>(null);
  const [conceptoReg, setConceptoReg] = useState('');
  const [ignorando, setIgnorando] = useState<Linea | null>(null);
  const [motivo, setMotivo] = useState('');
  if (!q.data) return errorConsulta(q.error) ?? <Text c="dimmed">Cargando…</Text>;
  const c = q.data;
  const abierta = c.estado === 'ABIERTA';
  const url = `/conciliacion/conciliaciones/${id}`;
  const dif = Number(c.resumen.diferencia);
  const sumaL = sumaSeleccion(c.lineas, selL);
  const sumaM = sumaSeleccion(c.movimientos, selM);
  const conRegla = c.lineas.filter((l) => l.estado === 'PENDIENTE' && l.reglaSugerida);
  // Primera conciliación: los movimientos anteriores al período que el banco ya refleja se marcan como conciliados al inicio
  const puedeApertura = !!c.primera && !selL.length && selM.length > 0 && selM.every((m) => (c.movimientos.find((x) => x.id === m)?.fecha ?? '') < c.desde.slice(0, 10));
  const ejecutar = async <T,>(fn: () => Promise<T>, msj: string) => {
    const r = await op.ejecutar(fn, () => msj);
    if (r !== null) {
      setSelL([]);
      setSelM([]);
      void q.refetch();
    }
    return r;
  };
  const abrirRegistro = (ls: Linea[]) => {
    setRegistrando(ls);
    setCuentaReg(ls.length === 1 ? ls[0].reglaSugerida?.cuentaContableId ?? null : null);
    setConceptoReg(ls.length === 1 ? ls[0].reglaSugerida?.concepto ?? ls[0].concepto : '');
  };
  const alternar = (lista: string[], set: (x: string[]) => void, v: string) => set(lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md">
          <div>
            <Title order={3}>Conciliación del {formatoFecha(c.desde)} al {formatoFecha(c.hasta)}</Title>
            <Badge color={abierta ? 'blue' : 'green'} variant="light">{abierta ? 'Abierta' : 'Cerrada'}</Badge>
          </div>
          <Group gap="xs">
            <Button variant="default" onClick={() => void descargar(`${url}/reporte`, { formato: 'pdf' }, `conciliacion-${c.desde.slice(0, 10)}.pdf`)}>PDF</Button>
            <Button variant="default" onClick={() => void descargar(`${url}/reporte`, { formato: 'xlsx' }, `conciliacion-${c.desde.slice(0, 10)}.xlsx`)}>Excel</Button>
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 5 }}>
          <Dato titulo="Saldo según extracto" valor={c.saldoFinal} />
          <Dato titulo="Saldo según sistema" valor={c.resumen.saldoSistema} />
          <Dato titulo="Pendientes del sistema" valor={c.resumen.pendientesSistema} />
          <Dato titulo="Pendientes del extracto" valor={c.resumen.pendientesExtracto} />
          <Dato titulo="Diferencia" valor={c.resumen.diferencia} testid="diferencia" color={dif === 0 ? 'green' : 'red'} cuadra={dif === 0} />
        </SimpleGrid>
        {c.resumen.advertencia && <Alert color="yellow" mt="sm">{c.resumen.advertencia}</Alert>}
        {abierta && (
          <Group mt="md" gap="xs">
            <Button variant="light" onClick={async () => { const r = await op.ejecutar(() => api<Sugerencia[]>(`${url}/sugerencias`, { metodo: 'POST' }), (x) => `${x.length} coincidencias encontradas`); if (r) setSugerencias(r); }}>Buscar coincidencias</Button>
            <Button variant="light" disabled={!conRegla.length} onClick={() => abrirRegistro(conRegla)}>Registrar todas las que tienen regla ({conRegla.length})</Button>
            <Button ml="auto" disabled={dif !== 0 || c.resumen.lineasPendientes > 0}
              onClick={() => void ejecutar(() => api(`${url}/cerrar`, { metodo: 'POST', body: { version: c.version } }), 'Conciliación cerrada')}>Cerrar conciliación</Button>
          </Group>
        )}
        {op.alerta}
      </Paper>

      <Tabs defaultValue="pendientes" keepMounted={false}>
        <Tabs.List><Tabs.Tab value="pendientes">Pendientes</Tabs.Tab><Tabs.Tab value="conciliado">Conciliado ({c.vinculos.length})</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="pendientes" pt="sm">
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Paper withBorder p="sm" radius="md">
              <Title order={5} mb="xs">Extracto</Title>
              <ScrollArea>
                <Table withTableBorder striped miw={520}>
                  <Table.Thead><Table.Tr><Table.Th w={30} /><Table.Th>Fecha</Table.Th><Table.Th>Concepto</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Regla</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {c.lineas.map((l) => (
                      <Table.Tr key={l.id} style={l.estado === 'IGNORADA' ? { opacity: 0.5 } : undefined}>
                        <Table.Td>{l.estado === 'PENDIENTE' && abierta && <Checkbox aria-label={`Línea ${l.concepto}`} checked={selL.includes(l.id)} onChange={() => alternar(selL, setSelL, l.id)} />}</Table.Td>
                        <Table.Td>{formatoFecha(l.fecha)}</Table.Td>
                        <Table.Td><Text size="sm">{l.concepto}</Text>{l.referencia && <Text size="xs" c="dimmed">Ref. {l.referencia}</Text>}{l.estado === 'IGNORADA' && <Text size="xs" c="dimmed">Ignorada: {l.motivoIgnorada}</Text>}</Table.Td>
                        <Table.Td ta="right">{formatoMoneda(l.importe)}</Table.Td>
                        <Table.Td><Text size="xs">{l.reglaSugerida?.cuenta ?? ''}</Text></Table.Td>
                        <Table.Td>
                          {abierta && l.estado === 'PENDIENTE' && (
                            <Group gap={4} wrap="nowrap">
                              <Button size="compact-xs" variant="subtle" onClick={() => abrirRegistro([l])}>Registrar</Button>
                              <Button size="compact-xs" variant="subtle" color="gray" onClick={() => { setIgnorando(l); setMotivo(''); }}>Ignorar</Button>
                            </Group>
                          )}
                          {abierta && l.estado === 'IGNORADA' && <Button size="compact-xs" variant="subtle" onClick={() => void ejecutar(() => api(`${url}/lineas/${l.id}/restaurar`, { metodo: 'POST' }), 'Línea restaurada')}>Restaurar</Button>}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
              <Text size="sm" ta="right" mt={4} data-testid="suma-extracto">Seleccionado: {formatoMoneda(sumaL)}</Text>
            </Paper>
            <Paper withBorder p="sm" radius="md">
              <Title order={5} mb="xs">Sistema</Title>
              <ScrollArea>
                <Table withTableBorder striped miw={460}>
                  <Table.Thead><Table.Tr><Table.Th w={30} /><Table.Th>Fecha</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {c.movimientos.map((m) => (
                      <Table.Tr key={m.id}>
                        <Table.Td>{abierta && <Checkbox aria-label={`Movimiento ${m.descripcion} ${m.referencia ?? ''}`} checked={selM.includes(m.id)} onChange={() => alternar(selM, setSelM, m.id)} />}</Table.Td>
                        <Table.Td>{formatoFecha(m.fecha)}</Table.Td>
                        <Table.Td><Text size="sm">{m.descripcion}</Text>{m.referencia && <Text size="xs" c="dimmed">Ref. {m.referencia}</Text>}</Table.Td>
                        <Table.Td ta="right">{formatoMoneda(m.importe)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
              <Text size="sm" ta="right" mt={4} data-testid="suma-sistema">Seleccionado: {formatoMoneda(sumaM)}</Text>
            </Paper>
          </SimpleGrid>
          {abierta && (
            <Group justify="flex-end" mt="sm">
              {c.primera && (
                <Button variant="light" disabled={!puedeApertura}
                  onClick={() => void ejecutar(() => api(`${url}/apertura`, { metodo: 'POST', body: { movimientos: selM } }), 'Movimientos marcados como conciliados al inicio')}>
                  Marcar como conciliados al inicio
                </Button>
              )}
              <Button disabled={!puedeConciliar(sumaL, sumaM, selL.length, selM.length)}
                onClick={() => void ejecutar(() => api(`${url}/vinculos`, { metodo: 'POST', body: { lineas: selL, movimientos: selM } }), 'Conciliado')}>Conciliar seleccionados</Button>
            </Group>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="conciliado" pt="sm">
          <Table withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Tipo</Table.Th><Table.Th>Extracto</Table.Th><Table.Th>Sistema</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {c.vinculos.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td>{v.tipo === 'REGISTRO' ? 'Registrado' : v.tipo === 'AUTOMATICO' ? 'Automático' : 'Manual'}</Table.Td>
                  <Table.Td><Text size="xs">{v.lineas.map((l) => `${formatoFecha(l.fecha)} ${l.concepto} ${formatoMoneda(l.importe)}`).join(' + ')}</Text></Table.Td>
                  <Table.Td><Text size="xs">{v.movimientos.map((m) => `${formatoFecha(m.fecha)} ${m.descripcion} ${formatoMoneda(m.importe)}`).join(' + ')}</Text></Table.Td>
                  <Table.Td>{abierta && <Button size="compact-xs" variant="subtle" color="red" onClick={() => void ejecutar(() => api(`${url}/vinculos/${v.id}`, { metodo: 'DELETE' }), 'Conciliación deshecha')}>Deshacer</Button>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>

      <SugerenciasModal sugerencias={sugerencias ?? []} lineas={c.lineas} movimientos={c.movimientos} abierto={sugerencias !== null} enviando={op.enviando} onCerrar={() => setSugerencias(null)}
        onAplicar={async (s) => {
          const r = await ejecutar(() => api<{ creados: number }>(`${url}/vinculos/lote`, { metodo: 'POST', body: { vinculos: s.map((x) => ({ lineas: x.lineas, movimientos: x.movimientos })) } }), `${s.length} coincidencias aplicadas`);
          if (r) setSugerencias(null);
        }} />

      <Modal opened={!!registrando} onClose={() => setRegistrando(null)} title={registrando && registrando.length > 1 ? `Registrar ${registrando.length} líneas con su regla` : 'Registrar línea del extracto'} size="lg">
        {registrando && (
          <Stack>
            {registrando.length > 1 ? (
              <Table withTableBorder>
                <Table.Tbody>
                  {registrando.map((l) => <Table.Tr key={l.id}><Table.Td>{formatoFecha(l.fecha)}</Table.Td><Table.Td>{l.concepto}</Table.Td><Table.Td>{l.reglaSugerida?.cuenta}</Table.Td><Table.Td ta="right">{formatoMoneda(l.importe)}</Table.Td></Table.Tr>)}
                </Table.Tbody>
              </Table>
            ) : (
              <>
                <Text size="sm">{formatoFecha(registrando[0].fecha)} · {registrando[0].concepto} · {formatoMoneda(registrando[0].importe)}</Text>
                <Select label="Cuenta contable" searchable data={imputables} value={cuentaReg} onChange={setCuentaReg} />
                <TextInput label="Concepto" value={conceptoReg} onChange={(e) => setConceptoReg(e.currentTarget.value)} />
              </>
            )}
            <Group justify="flex-end">
              <Button loading={op.enviando} disabled={registrando.length === 1 && (!cuentaReg || !conceptoReg.trim())} onClick={async () => {
                const lineas = registrando.length > 1
                  ? registrando.map((l) => ({ lineaId: l.id, cuentaContableId: l.reglaSugerida!.cuentaContableId, concepto: l.reglaSugerida!.concepto }))
                  : [{ lineaId: registrando[0].id, cuentaContableId: cuentaReg, concepto: conceptoReg }];
                if (await ejecutar(() => api(`${url}/registrar`, { metodo: 'POST', body: { lineas } }), `${lineas.length} líneas registradas`)) setRegistrando(null);
              }}>Registrar</Button>
            </Group>
            {op.alerta}
          </Stack>
        )}
      </Modal>

      <Modal opened={!!ignorando} onClose={() => setIgnorando(null)} title="Ignorar línea del extracto">
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end" mt="md">
          <Button disabled={!motivo.trim()} onClick={async () => {
            if (await ejecutar(() => api(`${url}/lineas/${ignorando!.id}/ignorar`, { metodo: 'POST', body: { motivo } }), 'Línea ignorada')) setIgnorando(null);
          }}>Ignorar</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
