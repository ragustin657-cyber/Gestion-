import { Alert, Badge, Button, Group, Modal, Paper, Select, Table, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { HojaGananciasVista, type HojaGanancias } from './GananciasPages';

/** Fila de un empleado en la liquidación anual de Ganancias (spec E32 §5). */
export interface FilaAnualGanancias { empleadoId: string; legajo: number; apellido: string; nombre: string; distracto: boolean; hoja: HojaGanancias; impuesto: string; retenido: string; pagosACuenta: string; saldo: string }
interface AnualGanancias { anio: number; estado: 'BORRADOR' | 'CERRADA' | null; cerradoEn: string | null; empleados: FilaAnualGanancias[] }

const saldo = (s: string) => (Number(s) < 0 ? `Devolución ${formatoMoneda(Math.abs(Number(s)))}` : formatoMoneda(s));

/** Deducciones de la hoja: aportes, deducciones generales computadas y art. 30. */
const deduccionesDe = (h: HojaGanancias) => Number(h.aportes) + h.deducciones.reduce((t, d) => t + Number(d.computado), 0) + Number(h.personales.gni) + Number(h.personales.especial) + Number(h.personales.cargas);

/** Tabla de la anual: bruta, deducciones, impuesto, retenido, pagos a cuenta y saldo (positivo = a retener, negativo = a devolver), con la hoja de cada empleado. */
export function TablaAnualGanancias({ filas }: { filas: FilaAnualGanancias[] }) {
  const [vista, setVista] = useState<FilaAnualGanancias | null>(null);
  const suma = (g: (x: FilaAnualGanancias) => number) => String(filas.reduce((t, x) => t + g(x), 0));
  const num = (k: 'impuesto' | 'retenido' | 'pagosACuenta' | 'saldo') => (x: FilaAnualGanancias) => Number(x[k]);
  return (
    <>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Legajo</Table.Th><Table.Th>Empleado</Table.Th><Table.Th ta="right">Ganancia bruta</Table.Th><Table.Th ta="right">Deducciones</Table.Th><Table.Th ta="right">Impuesto determinado</Table.Th><Table.Th ta="right">Retenido</Table.Th><Table.Th ta="right">Pagos a cuenta</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {filas.map((x) => (
            <Table.Tr key={x.empleadoId}>
              <Table.Td>{x.legajo}</Table.Td>
              <Table.Td>{`${x.apellido}, ${x.nombre}`}{x.distracto && <Badge ml="xs" size="xs" variant="light">Distracto</Badge>}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(x.hoja.bruta)}</Table.Td><Table.Td ta="right">{formatoMoneda(deduccionesDe(x.hoja))}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(x.impuesto)}</Table.Td><Table.Td ta="right">{formatoMoneda(x.retenido)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(x.pagosACuenta)}</Table.Td><Table.Td ta="right" c={Number(x.saldo) < 0 ? 'green' : undefined}>{saldo(x.saldo)}</Table.Td>
              <Table.Td><Button size="compact-xs" variant="subtle" aria-label={`Ver hoja de ${x.apellido}, ${x.nombre}`} onClick={() => setVista(x)}>Ver hoja</Button></Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr fw={700}>
            <Table.Td /><Table.Td>Total</Table.Td><Table.Td ta="right">{formatoMoneda(suma((x) => Number(x.hoja.bruta)))}</Table.Td><Table.Td ta="right">{formatoMoneda(suma((x) => deduccionesDe(x.hoja)))}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(suma(num('impuesto')))}</Table.Td><Table.Td ta="right">{formatoMoneda(suma(num('retenido')))}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(suma(num('pagosACuenta')))}</Table.Td><Table.Td ta="right">{saldo(suma(num('saldo')))}</Table.Td><Table.Td />
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Modal opened={!!vista} onClose={() => setVista(null)} size="lg" title={vista ? `Liquidación anual: ${vista.apellido}, ${vista.nombre}` : ''}>
        {vista && <HojaGananciasVista hoja={vista.hoja} />}
      </Modal>
    </>
  );
}

/** Pantalla de la liquidación anual de Ganancias: calcular, cerrar, reabrir, F.1359 y certificados. */
export function GananciasAnualPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const actual = new Date().getFullYear();
  const [anio, setAnio] = useState(actual - 1);
  const ruta = `/sueldos/ganancias/anual/${anio}`;
  const q = useQuery({ queryKey: [ruta], queryFn: () => api<AnualGanancias>(ruta) });
  const editable = puede('sueldos.liquidar');
  const accion = (paso: string, mensaje: string) => async () => {
    if (await op.ejecutar(() => api(`${ruta}/${paso}`, { metodo: 'POST' }), () => mensaje)) await qc.invalidateQueries({ queryKey: [ruta] });
  };
  const d = q.data;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Ganancias: liquidación anual</Title>
        <Select aria-label="Año" w={100} data={[actual - 3, actual - 2, actual - 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} />
      </Group>
      {errorConsulta(q.error)}
      {op.alerta}
      {d && <Group mb="sm" gap="xs">
        <Text size="sm">Estado:</Text>
        {d.estado === null ? <Badge color="gray" variant="light">Sin calcular</Badge> : d.estado === 'CERRADA' ? <Badge color="green" variant="light">Cerrada</Badge> : <Badge color="yellow" variant="light">Borrador</Badge>}
      </Group>}
      {d && <Group mb="md" gap="xs">
        {editable && d.estado !== 'CERRADA' && <Button size="xs" loading={op.enviando} onClick={accion('calcular', 'Liquidación anual calculada')}>Calcular</Button>}
        {editable && d.estado === 'BORRADOR' && <Button size="xs" variant="light" loading={op.enviando} onClick={accion('cerrar', 'Liquidación anual cerrada')}>Cerrar</Button>}
        {editable && d.estado === 'CERRADA' && <Button size="xs" variant="light" color="red" loading={op.enviando} onClick={accion('reabrir', 'Liquidación anual reabierta')}>Reabrir</Button>}
        {editable && d.estado === 'CERRADA' && <Button size="xs" variant="default" onClick={() => op.ejecutar(() => descargar(`/sueldos/ganancias/f1359/anual/${anio}`, undefined, `F1359-${anio}.txt`), () => 'F.1359 descargado')}>Descargar F.1359</Button>}
        {editable && <Button size="xs" variant="default" onClick={() => op.ejecutar(() => descargar(`/sueldos/ganancias/f1359/distracto/${anio}`, undefined, `F1359-distracto-${anio}.txt`), () => 'F.1359 de distracto descargado')}>F.1359 de distracto</Button>}
        {d.estado !== null && <Button size="xs" variant="default" onClick={() => op.ejecutar(() => descargar(`${ruta}/certificados.pdf`, undefined, `certificados-ganancias-${anio}.pdf`), () => 'Certificados descargados')}>Certificados (PDF)</Button>}
      </Group>}
      {d?.estado === null && <Alert color="blue" mb="sm">{`Calcule la anual de ${anio} con todas las liquidaciones del año cerradas. Se cierra desde el 1/4/${anio + 1}; el saldo se retiene o devuelve en la liquidación siguiente.`}</Alert>}
      {d && d.empleados.length > 0 && <TablaAnualGanancias filas={d.empleados} />}
    </Paper>
  );
}
