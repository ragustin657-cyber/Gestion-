import { AppShell, Burger, Button, Group, Modal, ScrollArea, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { api } from '../api/cliente';
import { FormAbm } from '../abm/FormAbm';
import { useDisclosure } from '@mantine/hooks';
import { IconBuilding, IconKey, IconLogout } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MenuArbol } from './MenuArbol';
import { filtrarMenu, MENU } from './menu';

export function AppLayout() {
  const { sesion, salir } = useAuth();
  const navegar = useNavigate();
  const [abierto, { toggle, close }] = useDisclosure();
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const menu = useMemo(() => filtrarMenu(MENU, sesion?.permisos ?? [], !!sesion?.superadmin), [sesion?.permisos, sesion?.superadmin]);

  return (
    <AppShell header={{ height: 52 }} navbar={{ width: 290, breakpoint: 'sm', collapsed: { mobile: !abierto } }} padding="md">
      <AppShell.Header bg="indigo.8" c="white">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={abierto} onClick={toggle} hiddenFrom="sm" size="sm" color="white" />
            <Text fw={700} style={{ cursor: 'pointer' }} onClick={() => navegar('/')}>Sistema de Gestión</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button variant="subtle" color="white" size="compact-sm" leftSection={<IconBuilding size={16} />} onClick={() => navegar('/empresa')}>
              <Text size="sm" truncate maw={180}>{sesion?.empresa?.razonSocial}</Text>
            </Button>
            <Button variant="subtle" color="white" size="compact-sm" leftSection={<IconKey size={16} />} onClick={() => setCambiandoClave(true)} visibleFrom="sm">
              Contraseña
            </Button>
            <Button variant="subtle" color="white" size="compact-sm" leftSection={<IconLogout size={16} />} onClick={salir} visibleFrom="xs">
              Salir
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar>
        <ScrollArea p="xs">
          <MenuArbol menu={menu} alNavegar={close} />
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main bg="gray.0">
        <Outlet />
      </AppShell.Main>
      <Modal opened={cambiandoClave} onClose={() => setCambiandoClave(false)} title="Cambiar contraseña">
        <FormAbm
          campos={[
            { nombre: 'actual', etiqueta: 'Contraseña actual', tipo: 'password', requerido: true, ancho: true },
            { nombre: 'nueva', etiqueta: 'Contraseña nueva (mínimo 8 caracteres)', tipo: 'password', requerido: true, ancho: true },
          ]}
          valoresIniciales={{}}
          onEnviar={(v) => api('/auth/password', { metodo: 'PATCH', body: v })}
          onExito={() => {
            setCambiandoClave(false);
            notifications.show({ color: 'green', message: 'Contraseña actualizada' });
          }}
        />
      </Modal>
    </AppShell>
  );
}
