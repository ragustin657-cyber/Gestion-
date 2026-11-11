import { Button, Group, Paper, Radio, Stack, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import { useOperacion } from '../tesoreria/comun';

export function ConfigStockPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const q = useQuery({ queryKey: ['/stock/config'], queryFn: () => api<{ stockNegativo: string }>('/stock/config') });
  const [modo, setModo] = useState('BLOQUEAR');
  useEffect(() => { if (q.data) setModo(q.data.stockNegativo); }, [q.data]);
  const guardar = async () => {
    if (await op.ejecutar(() => api('/stock/config', { metodo: 'PUT', body: { stockNegativo: modo } }), () => 'Configuración guardada')) void qc.invalidateQueries({ queryKey: ['/stock/config'] });
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Configuración de stock</Title>
      <Radio.Group label="Si se factura o se saca más de lo que hay en stock" value={modo} onChange={setModo}>
        <Stack mt="xs">
          <Radio value="BLOQUEAR" label="Bloquear la operación" />
          <Radio value="AVISAR" label="Permitir con aviso (el stock queda negativo)" />
        </Stack>
      </Radio.Group>
      {op.alerta}
      <Group mt="md"><Button loading={op.enviando} onClick={() => void guardar()}>Guardar</Button></Group>
    </Paper>
  );
}
