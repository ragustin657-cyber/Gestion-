import { Alert, Button, Divider, Group, Loader, Paper, Select, Stack, Table, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { FormAbm } from '../abm/FormAbm';
import { useCuentasImputables } from '../abm/opciones';

interface Config {
  montoAprobacionOc: string; toleranciaPrecioPct: string; toleranciaCantidadPct: string; modoTresVias: string;
  cuentas: { concepto: string; cuentaContableId: string }[];
}
const CONCEPTOS: Record<string, string> = {
  PROVEEDORES: 'Proveedores', IVA_CREDITO_FISCAL: 'IVA crédito fiscal', PERCEPCION_IVA: 'Percepciones de IVA',
  PERCEPCION_IIBB: 'Percepciones de IIBB', IMPUESTOS_INTERNOS: 'Impuestos internos', GASTO_POR_DEFECTO: 'Gasto por defecto (y no gravado / exento)',
};

export function ConfigComprasPage() {
  const qc = useQueryClient();
  const cuentasImputables = useCuentasImputables();
  const config = useQuery({ queryKey: ['/compras/config'], queryFn: () => api<Config>('/compras/config') });
  const [cuentas, setCuentas] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (config.data) setCuentas(Object.fromEntries(config.data.cuentas.map((c) => [c.concepto, c.cuentaContableId])));
  }, [config.data]);
  if (!config.data) return <Loader size="sm" />;
  const c = config.data;

  async function guardarCuentas() {
    setError('');
    try {
      await api('/compras/config/cuentas', { metodo: 'PUT', body: Object.entries(cuentas).map(([concepto, cuentaContableId]) => ({ concepto, cuentaContableId })) });
      notifications.show({ color: 'green', message: 'Cuentas guardadas' });
      void qc.invalidateQueries({ queryKey: ['/compras/config'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Configuración de compras</Title>
      <FormAbm
        campos={[
          { nombre: 'montoAprobacionOc', etiqueta: 'Monto límite de aprobación automática (en pesos)', tipo: 'numero', ayuda: 'Las órdenes de compra hasta este monto se aprueban solas. Con 0, todas requieren aprobación.' },
          { nombre: 'modoTresVias', etiqueta: 'Diferencias con la OC', tipo: 'select', requerido: true, opciones: [{ value: 'AVISAR', label: 'Avisar y pedir confirmación' }, { value: 'BLOQUEAR', label: 'Bloquear la carga' }] },
          { nombre: 'toleranciaPrecioPct', etiqueta: 'Tolerancia de precio (%)', tipo: 'numero' },
          { nombre: 'toleranciaCantidadPct', etiqueta: 'Tolerancia de cantidad (%)', tipo: 'numero' },
        ]}
        valoresIniciales={{ montoAprobacionOc: Number(c.montoAprobacionOc), modoTresVias: c.modoTresVias, toleranciaPrecioPct: Number(c.toleranciaPrecioPct), toleranciaCantidadPct: Number(c.toleranciaCantidadPct) }}
        onEnviar={(v) => api('/compras/config', { metodo: 'PATCH', body: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) })}
        onExito={() => {
          notifications.show({ color: 'green', message: 'Configuración guardada' });
          void qc.invalidateQueries({ queryKey: ['/compras/config'] });
        }}
      />
      <Divider my="lg" />
      <Title order={4} mb="sm">Cuentas contables por concepto</Title>
      <Stack>
        <Table withTableBorder>
          <Table.Tbody>
            {Object.entries(CONCEPTOS).map(([k, etiqueta]) => (
              <Table.Tr key={k}>
                <Table.Td w="40%">{etiqueta}</Table.Td>
                <Table.Td><Select aria-label={etiqueta} searchable data={cuentasImputables} value={cuentas[k] ?? null} onChange={(v) => v && setCuentas({ ...cuentas, [k]: v })} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button onClick={guardarCuentas}>Guardar cuentas</Button></Group>
      </Stack>
    </Paper>
  );
}
