import { Alert, Button, Group, Paper, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';

type Totales = { cuota: string; noDeducible: string; deducible: string; contable: string; diferencia: string; valorResidual: string };
export interface FilaImpositiva {
  numero: number; descripcion: string; fechaAlta: string; fechaBaja: string | null; tipo: string; vidaUtilAnios: number; valorOrigen: string; actualiza: boolean; coeficiente: string;
  valorActualizado: string; aniosAnteriores: number; acumuladaAnterior: string; cuota: string; noDeducible: string; acumuladaCierre: string; valorResidual: string;
  costoComputableBaja: string | null; contable: string; diferencia: string;
}
export interface PlanillaImpositiva {
  ejercicio: { numero: number; desde: string; hasta: string }; avisos: string[]; totales: Totales;
  filas: { rubroId: string; rubro: string; subtotal: Totales; bienes: FilaImpositiva[] }[];
}

/** Planilla de amortización impositiva (E44): por bien agrupado por rubro, con la diferencia con la contable del ejercicio. */
export function TablaImpositiva({ datos }: { datos: PlanillaImpositiva }) {
  const m = formatoMoneda;
  const totales = (t: Totales) => <><Table.Th ta="right">{m(t.cuota)}</Table.Th><Table.Th ta="right">{m(t.noDeducible)}</Table.Th><Table.Th /><Table.Th ta="right">{m(t.valorResidual)}</Table.Th><Table.Th ta="right">{m(t.contable)}</Table.Th><Table.Th ta="right">{m(t.diferencia)}</Table.Th></>;
  return (
    <Stack gap="sm">
      {datos.avisos.map((a) => <Alert key={a} color="orange">{a}</Alert>)}
      <Table.ScrollContainer minWidth={1300}>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr>
            <Table.Th>Bien</Table.Th><Table.Th>Alta</Table.Th><Table.Th>Baja</Table.Th><Table.Th ta="right">Vida (años)</Table.Th><Table.Th ta="right">Valor de origen</Table.Th><Table.Th ta="right">Coef.</Table.Th>
            <Table.Th ta="right">Valor actualizado</Table.Th><Table.Th ta="right">Acumulada anterior</Table.Th><Table.Th ta="right">Cuota del ejercicio</Table.Th><Table.Th ta="right">No deducible</Table.Th>
            <Table.Th ta="right">Acumulada al cierre</Table.Th><Table.Th ta="right">Valor residual</Table.Th><Table.Th ta="right">Contable del ejercicio</Table.Th><Table.Th ta="right">Diferencia</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {datos.filas.map((g) => (
              <Fragment key={g.rubroId}>
                <Table.Tr><Table.Td colSpan={14}><Text fw={600} size="sm">{g.rubro}</Text></Table.Td></Table.Tr>
                {g.bienes.map((b) => (
                  <Table.Tr key={b.numero}>
                    <Table.Td>{`${b.numero} ${b.descripcion}`}</Table.Td><Table.Td>{formatoFecha(b.fechaAlta)}</Table.Td>
                    <Table.Td>{b.fechaBaja ? `${formatoFecha(b.fechaBaja)}${b.costoComputableBaja ? ` · costo computable ${m(b.costoComputableBaja)}` : ''}` : ''}</Table.Td>
                    <Table.Td ta="right">{b.vidaUtilAnios}</Table.Td><Table.Td ta="right">{m(b.valorOrigen)}</Table.Td><Table.Td ta="right">{Number(b.coeficiente).toLocaleString('es-AR', { minimumFractionDigits: 4 })}</Table.Td>
                    <Table.Td ta="right">{m(b.valorActualizado)}</Table.Td><Table.Td ta="right">{m(b.acumuladaAnterior)}</Table.Td><Table.Td ta="right">{m(b.cuota)}</Table.Td><Table.Td ta="right">{m(b.noDeducible)}</Table.Td>
                    <Table.Td ta="right">{m(b.acumuladaCierre)}</Table.Td><Table.Td ta="right">{m(b.valorResidual)}</Table.Td><Table.Td ta="right">{m(b.contable)}</Table.Td><Table.Td ta="right">{m(b.diferencia)}</Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr><Table.Th colSpan={8}>{`Subtotal ${g.rubro}`}</Table.Th>{totales(g.subtotal)}</Table.Tr>
              </Fragment>
            ))}
            {!datos.filas.length && <Table.Tr><Table.Td colSpan={14}><Text c="dimmed" size="sm" ta="center">Sin bienes en el ejercicio</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
          <Table.Tfoot><Table.Tr data-testid="total-impositiva"><Table.Th colSpan={8}>Total</Table.Th>{totales(datos.totales)}</Table.Tr></Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
      <Text size="sm">{`Deducible del ejercicio: ${m(datos.totales.deducible)} · contable: ${m(datos.totales.contable)} · diferencia: ${m(datos.totales.diferencia)}`}</Text>
    </Stack>
  );
}

export function PlanillaImpositivaPage() {
  const ejercicios = useQuery({ queryKey: ['/contabilidad/ejercicios'], queryFn: () => api<{ id: string; numero: number; desde: string; hasta: string; estado: string }[]>('/contabilidad/ejercicios') });
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  useEffect(() => {
    if (!ejercicioId && ejercicios.data?.length) setEjercicioId((ejercicios.data.find((x) => x.estado === 'ABIERTO') ?? ejercicios.data[0]).id);
  }, [ejercicios.data, ejercicioId]);
  const q = useQuery({ queryKey: ['/bienes-uso/planilla-impositiva', ejercicioId], queryFn: () => api<PlanillaImpositiva>('/bienes-uso/planilla-impositiva', { query: { ejercicioId: ejercicioId ?? '' } }), enabled: !!ejercicioId });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Amortización impositiva</Title>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} disabled={!ejercicioId}
          onClick={() => void descargar('/bienes-uso/planilla-impositiva', { ejercicioId: ejercicioId ?? '', formato: 'xlsx' }, `amortizacion-impositiva-${q.data?.ejercicio.hasta ?? ''}.xlsx`)}>Excel</Button>
      </Group>
      <Select label="Ejercicio" w={220} mb="md" allowDeselect={false} value={ejercicioId} onChange={setEjercicioId}
        data={(ejercicios.data ?? []).map((e) => ({ value: e.id, label: `Ejercicio ${e.numero} (${e.hasta.slice(0, 4)})` }))} />
      <Text size="xs" c="dimmed" mb="sm">Ganancias: el ejercicio del alta se amortiza completo (inmuebles por trimestres) y el de la baja no; los bienes adquiridos desde 2018 se actualizan por IPC. Verifique los criterios con el contador.</Text>
      {errorConsulta(q.error)}
      {q.data && <TablaImpositiva datos={q.data} />}
    </Paper>
  );
}
