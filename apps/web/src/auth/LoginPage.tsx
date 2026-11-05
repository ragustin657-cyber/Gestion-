import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { ingresar, elegirEmpresa } = useAuth();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const s = await ingresar(email, password);
      if (s.empresas?.length === 1) {
        await elegirEmpresa(s.empresas[0].id);
        navegar('/');
      } else navegar('/empresa');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.mensaje : 'Error inesperado');
    } finally {
      setCargando(false);
    }
  }

  return (
    <Center mih="100vh" bg="gray.1" px="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w="100%" maw={380}>
        <form onSubmit={enviar}>
          <Stack>
            <div>
              <Title order={3}>Sistema de Gestión</Title>
              <Text size="sm" c="dimmed">Ingresá con tu usuario</Text>
            </div>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoFocus />
            <PasswordInput label="Contraseña" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <Button type="submit" loading={cargando}>Ingresar</Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
