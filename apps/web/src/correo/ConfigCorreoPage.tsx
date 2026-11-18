import { Alert, Button, Checkbox, Group, NumberInput, Paper, PasswordInput, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useOperacionVentas } from '../ventas/comun';

export interface ConfigCorreoWeb { servidor: string | null; puerto: number; seguro: boolean; usuario: string | null; remitenteNombre: string | null; remitenteEmail: string | null; asunto: string; cuerpo: string; claveCargada: boolean }
type DatosGuardar = Omit<ConfigCorreoWeb, 'claveCargada' | 'servidor' | 'usuario' | 'remitenteNombre' | 'remitenteEmail'> & { servidor: string; usuario: string; remitenteNombre: string; remitenteEmail: string; clave?: string };

/** Formulario del correo saliente: la clave nunca se muestra; vacía, se conserva la actual. */
export function FormConfigCorreo({ inicial, onGuardar, enviando }: { inicial: ConfigCorreoWeb; onGuardar: (d: DatosGuardar) => void; enviando?: boolean }) {
  const [v, setV] = useState({ servidor: inicial.servidor ?? '', puerto: inicial.puerto, seguro: inicial.seguro, usuario: inicial.usuario ?? '', remitenteNombre: inicial.remitenteNombre ?? '', remitenteEmail: inicial.remitenteEmail ?? '', asunto: inicial.asunto, cuerpo: inicial.cuerpo });
  const [clave, setClave] = useState('');
  const campo = (k: 'servidor' | 'usuario' | 'remitenteNombre' | 'remitenteEmail' | 'asunto', etiqueta: string) => <TextInput label={etiqueta} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.currentTarget.value })} />;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {campo('servidor', 'Servidor SMTP')}
        <Group grow>
          <NumberInput label="Puerto" min={1} max={65535} value={v.puerto} onChange={(x) => setV({ ...v, puerto: Number(x) || 587 })} />
          <Checkbox mt="lg" label="TLS directo (puerto 465)" checked={v.seguro} onChange={(e) => setV({ ...v, seguro: e.currentTarget.checked })} />
        </Group>
        {campo('usuario', 'Usuario')}
        <PasswordInput label="Clave" value={clave} onChange={(e) => setClave(e.currentTarget.value)} description={inicial.claveCargada ? 'Dejar vacío para conservar la actual' : undefined} />
        {campo('remitenteNombre', 'Nombre del remitente')}
        {campo('remitenteEmail', 'Email del remitente')}
      </SimpleGrid>
      {campo('asunto', 'Asunto')}
      <Textarea label="Texto del mail" autosize minRows={6} value={v.cuerpo} onChange={(e) => setV({ ...v, cuerpo: e.currentTarget.value })} />
      <Text size="xs" c="dimmed">Variables: {'{cliente}'}, {'{vencido}'}, {'{porVencer}'}, {'{diasAtraso}'}, {'{empresa}'}</Text>
      <Group justify="flex-end">
        <Button loading={enviando} disabled={!v.servidor.trim() || !v.usuario.trim() || !v.remitenteNombre.trim() || !v.remitenteEmail.trim() || !v.asunto.trim() || !v.cuerpo.trim() || (!inicial.claveCargada && !clave)} onClick={() => onGuardar({ ...v, ...(clave ? { clave } : {}) })}>Guardar</Button>
      </Group>
    </Stack>
  );
}

export function ConfigCorreoPage() {
  const op = useOperacionVentas();
  const q = useQuery({ queryKey: ['/correo/configuracion'], queryFn: () => api<ConfigCorreoWeb>('/correo/configuracion') });
  const [destino, setDestino] = useState('');
  const [version, setVersion] = useState(0);
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Configuración de correo</Title>
        {op.error && <Alert color="red" mb="sm">{op.error}</Alert>}
        {q.data && <FormConfigCorreo key={version} inicial={q.data} enviando={op.enviando} onGuardar={async (d) => { if (await op.ejecutar(() => api('/correo/configuracion', { metodo: 'PUT', body: d }), () => 'Configuración guardada')) setVersion((n) => n + 1); }} />}
      </Paper>
      {q.data?.claveCargada && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="sm">Enviar un mail de prueba</Title>
          <Group align="flex-end">
            <TextInput label="Destinatario" value={destino} onChange={(e) => setDestino(e.currentTarget.value)} w={280} />
            <Button variant="light" loading={op.enviando} disabled={!destino} onClick={() => void op.ejecutar(() => api('/correo/prueba', { metodo: 'POST', body: { destinatario: destino } }), () => `Mail de prueba enviado a ${destino}`)}>Enviar prueba</Button>
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
