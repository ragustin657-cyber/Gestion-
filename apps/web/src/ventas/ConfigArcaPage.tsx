import { Alert, Button, FileInput, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi, subirArchivos } from '../api/cliente';
import { formatoFecha } from '../compras/formato';

interface ConfigArca { ambiente: string; certificadoSujeto: string | null; certificadoVence: string | null; tieneCertificado: boolean; venceProximo: boolean }
const AMBIENTES = [
  { value: 'SIMULADO', label: 'Simulado (pruebas y demo, sin conexión con ARCA)' },
  { value: 'HOMOLOGACION', label: 'Homologación (ARCA de prueba)' },
  { value: 'PRODUCCION', label: 'Producción' },
];

export function ConfigArcaPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/arca/config'], queryFn: () => api<ConfigArca>('/arca/config') });
  const [crt, setCrt] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [prueba, setPrueba] = useState<{ ok: boolean; detalle: string } | null>(null);
  const c = q.data;
  const ejecutar = async (fn: () => Promise<unknown>, mensaje: string) => {
    setError('');
    try {
      await fn();
      notifications.show({ color: 'green', message: mensaje });
      void qc.invalidateQueries({ queryKey: ['/arca/config'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Factura electrónica ARCA</Title>
      {c && (
        <Stack>
          <Select label="Ambiente" w={420} allowDeselect={false} data={AMBIENTES} value={c.ambiente} onChange={(v) => v && void ejecutar(() => api('/arca/config', { metodo: 'PUT', body: { ambiente: v } }), 'Ambiente guardado')} />
          <Text size="sm">{c.tieneCertificado ? `Certificado: ${c.certificadoSujeto} · vence ${formatoFecha(c.certificadoVence)}` : 'Sin certificado cargado'}</Text>
          {c.venceProximo && <Alert color="orange">El certificado vence el {formatoFecha(c.certificadoVence)}: genere uno nuevo en ARCA y cárguelo.</Alert>}
          <Group align="flex-end">
            <FileInput label="Certificado (.crt)" w={260} accept=".crt,.pem" value={crt} onChange={setCrt} />
            <FileInput label="Clave privada (.key)" w={260} accept=".key,.pem" value={key} onChange={setKey} />
            <Button disabled={!crt || !key} onClick={() => void ejecutar(() => subirArchivos('/arca/certificado', { certificado: crt!, clave: key! }), 'Certificado cargado')}>Cargar certificado</Button>
          </Group>
          <Group><Button variant="default" onClick={() => void ejecutar(async () => setPrueba(await api('/arca/probar', { metodo: 'POST' })), 'Prueba terminada')}>Probar conexión</Button></Group>
          {prueba && <Alert color={prueba.ok ? 'green' : 'red'}>{prueba.detalle}</Alert>}
          {error && <Alert color="red">{error}</Alert>}
          <Text size="xs" c="dimmed">En Simulado y Homologación los comprobantes llevan la leyenda "SIN VALIDEZ FISCAL".</Text>
        </Stack>
      )}
    </Paper>
  );
}
