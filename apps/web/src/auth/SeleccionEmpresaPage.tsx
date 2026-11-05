import { Alert, Button, Center, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { useAuth } from './AuthContext';

export function SeleccionEmpresaPage() {
  const { sesion, elegirEmpresa, salir } = useAuth();
  const navegar = useNavigate();
  const [error, setError] = useState('');
  if (!sesion) return <Navigate to="/login" replace />;
  const empresas = sesion.empresas ?? [];

  async function elegir(id: string) {
    try {
      await elegirEmpresa(id);
      navegar('/');
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }

  return (
    <Center mih="100vh" bg="gray.1" px="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w="100%" maw={420}>
        <Stack>
          <Title order={4}>Elegí la empresa</Title>
          {error && <Alert color="red">{error}</Alert>}
          {empresas.length === 0 && <Text c="dimmed">Tu usuario no tiene empresas asignadas.</Text>}
          {empresas.map((e) => (
            <Button key={e.id} variant="light" justify="flex-start" onClick={() => elegir(e.id)}>
              {e.razonSocial}
            </Button>
          ))}
          <Button variant="subtle" color="gray" onClick={salir}>Cerrar sesión</Button>
        </Stack>
      </Paper>
    </Center>
  );
}
