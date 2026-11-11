import { Alert, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';

interface Config { arbaActividad: string; arbaSucursal: number; arbaPeriodicidad: string; agipCodigoNorma: string }

export function ConfigImpuestosPage() {
  const q = useQuery({ queryKey: ['/impuestos/config'], queryFn: () => api<Config>('/impuestos/config') });
  const [c, setC] = useState<Config | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (q.data) setC(q.data); }, [q.data]);
  if (!c) return null;
  const guardar = async () => {
    setError('');
    try {
      await api('/impuestos/config', { metodo: 'PUT', body: c });
      notifications.show({ color: 'green', message: 'Configuración guardada' });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Configuración de impuestos</Title>
      <Stack maw={520}>
        <Title order={5}>ARBA (A-122R)</Title>
        <Group>
          <TextInput label="Código de actividad" w={160} value={c.arbaActividad} onChange={(e) => setC({ ...c, arbaActividad: e.currentTarget.value })} />
          <NumberInput label="Sucursal" w={120} min={1} value={c.arbaSucursal} onChange={(v) => setC({ ...c, arbaSucursal: Number(v) || 1 })} />
          <Select label="Presentación" w={160} allowDeselect={false} data={[{ value: 'MENSUAL', label: 'Mensual' }, { value: 'QUINCENAL', label: 'Quincenal' }]} value={c.arbaPeriodicidad} onChange={(v) => setC({ ...c, arbaPeriodicidad: v ?? 'MENSUAL' })} />
        </Group>
        <Title order={5}>AGIP (e-ARCIBA)</Title>
        <TextInput label="Código de norma de retención" w={200} value={c.agipCodigoNorma} onChange={(e) => setC({ ...c, agipCodigoNorma: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">Valores por defecto a confirmar con el contador: actividad 6 de ARBA y norma 029 de AGIP.</Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group><Button onClick={() => void guardar()}>Guardar</Button></Group>
      </Stack>
    </Paper>
  );
}
