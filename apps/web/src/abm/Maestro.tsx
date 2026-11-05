import { Badge, Button, Modal, Paper, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { FormAbm } from './FormAbm';
import { TablaAbm } from './TablaAbm';
import { ConfigMaestro } from './tipos';

export const siNo = (v: unknown) => (v ? <Badge size="sm" color="green" variant="light">Sí</Badge> : <Badge size="sm" color="gray" variant="light">No</Badge>);
export const estado = (activo: unknown) => (activo ? <Badge size="sm" color="green" variant="light">Activo</Badge> : <Badge size="sm" color="gray" variant="light">Inactivo</Badge>);

/** Pantalla de ABM estándar: tabla + alta/modificación en un modal. */
export function Maestro<T extends { id?: string }>({ config, sinMarco }: { config: ConfigMaestro<T>; sinMarco?: boolean }) {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<T | 'nuevo' | null>(null);
  const editable = !config.permisoEditar || puede(config.permisoEditar);
  const esNuevo = editando === 'nuevo';
  const campos = esNuevo ? config.campos : (config.camposEdicion ?? config.campos);

  const valoresIniciales = esNuevo
    ? { ...(config.valoresNuevos ?? {}) }
    : Object.fromEntries(campos.map((c) => [c.nombre, (editando as Record<string, unknown> | null)?.[c.nombre] ?? '']));

  const contenido = (
    <>
      <TablaAbm<T>
        ruta={config.ruta}
        columnas={config.columnas}
        paginado={config.paginado}
        onSeleccionar={editable && !config.soloAlta ? (f) => setEditando(f) : undefined}
        acciones={editable && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditando('nuevo')}>Nuevo</Button>
        )}
      />
      <Modal opened={!!editando} onClose={() => setEditando(null)} title={esNuevo ? `Nuevo: ${config.titulo}` : `Modificar: ${config.titulo}`} size="lg">
        {editando && (
          <FormAbm
            campos={campos}
            valoresIniciales={valoresIniciales}
            onEnviar={(v) =>
              esNuevo
                ? api(config.ruta, { metodo: 'POST', body: v })
                : api(`${config.ruta}/${(editando as T).id}`, { metodo: 'PATCH', body: v })
            }
            onExito={() => {
              setEditando(null);
              notifications.show({ color: 'green', message: 'Guardado correctamente' });
              void qc.invalidateQueries({ queryKey: [config.ruta] });
            }}
          />
        )}
      </Modal>
    </>
  );
  if (sinMarco) return contenido;
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">{config.titulo}</Title>
      {contenido}
    </Paper>
  );
}
