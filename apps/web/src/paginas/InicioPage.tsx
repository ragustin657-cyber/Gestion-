import { Paper, Text, Title } from '@mantine/core';
import { useAuth } from '../auth/AuthContext';
import { TableroPage } from '../informes/TableroPage';

export function InicioPage() {
  const { sesion, puede } = useAuth();
  if (puede('informes.ver')) return <TableroPage />;
  return (
    <Paper withBorder p="lg" radius="md">
      <Title order={3}>Hola, {sesion?.usuario.nombre}</Title>
      <Text c="dimmed" mt="xs">
        Estás trabajando en <b>{sesion?.empresa?.razonSocial}</b>. Usá el menú de la izquierda para cargar y consultar información.
      </Text>
    </Paper>
  );
}
