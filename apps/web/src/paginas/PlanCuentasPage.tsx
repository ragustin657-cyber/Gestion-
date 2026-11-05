import { ActionIcon, Badge, Box, Button, Group, Loader, Modal, Paper, Text, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconChevronRight, IconPencil, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { FormAbm } from '../abm/FormAbm';

interface NodoCuenta { id: string; codigo: string; nombre: string; imputable: boolean; tipo: string; activa: boolean; hijos: NodoCuenta[] }
type Edicion = { modo: 'alta'; padre: NodoCuenta } | { modo: 'editar'; cuenta: NodoCuenta } | null;

function Fila({ n, nivel, editable, abiertos, alternar, editar }: {
  n: NodoCuenta; nivel: number; editable: boolean; abiertos: Set<string>; alternar: (id: string) => void; editar: (e: Edicion) => void;
}) {
  const abierto = abiertos.has(n.id);
  return (
    <>
      <Group gap={4} wrap="nowrap" py={3} pl={nivel * 18} style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        <Box w={22}>
          {n.hijos.length > 0 && (
            <UnstyledButton onClick={() => alternar(n.id)} aria-label={abierto ? 'Contraer' : 'Expandir'}>
              {abierto ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </UnstyledButton>
          )}
        </Box>
        <Text size="sm" ff="monospace" w={110} style={{ flexShrink: 0 }}>{n.codigo}</Text>
        <Text size="sm" fw={n.imputable ? 400 : 600} c={n.activa ? undefined : 'dimmed'} style={{ flex: 1 }} truncate>{n.nombre}</Text>
        {n.imputable && <Badge size="xs" variant="light" visibleFrom="xs">Imputable</Badge>}
        {editable && (
          <Group gap={2} wrap="nowrap">
            {!n.imputable && (
              <Tooltip label="Agregar subcuenta"><ActionIcon variant="subtle" size="sm" onClick={() => editar({ modo: 'alta', padre: n })} aria-label="Agregar subcuenta"><IconPlus size={14} /></ActionIcon></Tooltip>
            )}
            <Tooltip label="Modificar"><ActionIcon variant="subtle" size="sm" onClick={() => editar({ modo: 'editar', cuenta: n })} aria-label="Modificar"><IconPencil size={14} /></ActionIcon></Tooltip>
          </Group>
        )}
      </Group>
      {abierto && n.hijos.map((h) => <Fila key={h.id} n={h} nivel={nivel + 1} editable={editable} abiertos={abiertos} alternar={alternar} editar={editar} />)}
    </>
  );
}

const sugerirCodigo = (p: NodoCuenta) => {
  const nivel = p.codigo.split('.').length;
  const largo = nivel >= 3 ? 3 : 2;
  const usados = p.hijos.map((h) => Number(h.codigo.split('.').pop()));
  return `${p.codigo}.${String((usados.length ? Math.max(...usados) : 0) + 1).padStart(largo, '0')}`;
};

export function PlanCuentasPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const arbol = useQuery({ queryKey: ['/plan-cuentas'], queryFn: () => api<NodoCuenta[]>('/plan-cuentas') });
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [edicion, setEdicion] = useState<Edicion>(null);
  const alternar = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todos = (ns: NodoCuenta[]): string[] => ns.flatMap((n) => [n.id, ...todos(n.hijos)]);

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Plan de cuentas</Title>
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={() => setAbiertos(new Set(todos(arbol.data ?? [])))}>Expandir todo</Button>
          <Button variant="default" size="xs" onClick={() => setAbiertos(new Set())}>Contraer</Button>
        </Group>
      </Group>
      {arbol.isLoading ? <Loader size="sm" /> : (arbol.data ?? []).map((n) => (
        <Fila key={n.id} n={n} nivel={0} editable={puede('plancuentas.editar')} abiertos={abiertos} alternar={alternar} editar={setEdicion} />
      ))}
      <Modal opened={!!edicion} onClose={() => setEdicion(null)} title={edicion?.modo === 'alta' ? `Nueva subcuenta de ${edicion.padre.codigo} ${edicion.padre.nombre}` : 'Modificar cuenta'}>
        {edicion && (
          <FormAbm
            campos={edicion.modo === 'alta'
              ? [
                  { nombre: 'codigo', etiqueta: 'Código', tipo: 'texto', requerido: true },
                  { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
                  { nombre: 'imputable', etiqueta: 'Imputable (recibe movimientos)', tipo: 'booleano' },
                ]
              : [
                  { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
                  { nombre: 'imputable', etiqueta: 'Imputable', tipo: 'booleano' },
                  { nombre: 'activa', etiqueta: 'Activa', tipo: 'booleano' },
                ]}
            valoresIniciales={edicion.modo === 'alta'
              ? { codigo: sugerirCodigo(edicion.padre), nombre: '', imputable: true }
              : { nombre: edicion.cuenta.nombre, imputable: edicion.cuenta.imputable, activa: edicion.cuenta.activa }}
            onEnviar={(v) => edicion.modo === 'alta'
              ? api('/plan-cuentas', { metodo: 'POST', body: { ...v, padreId: edicion.padre.id } })
              : api(`/plan-cuentas/${edicion.cuenta.id}`, { metodo: 'PATCH', body: v })}
            onExito={() => {
              if (edicion.modo === 'alta') setAbiertos((s) => new Set(s).add(edicion.padre.id));
              setEdicion(null);
              notifications.show({ color: 'green', message: 'Guardado correctamente' });
              void qc.invalidateQueries({ queryKey: ['/plan-cuentas'] });
            }}
          />
        )}
      </Modal>
    </Paper>
  );
}
