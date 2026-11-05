import { NavLink, Text } from '@mantine/core';
import { IconChevronRight, IconFileText, IconFolder } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NodoMenu } from './menu';

function contieneRuta(n: NodoMenu, ruta: string): boolean {
  return n.ruta === ruta || !!n.hijos?.some((h) => contieneRuta(h, ruta));
}

function Nodo({ nodo, alNavegar }: { nodo: NodoMenu; alNavegar?: () => void }) {
  const { pathname } = useLocation();
  const navegar = useNavigate();
  if (nodo.hijos)
    return (
      <NavLink
        label={nodo.titulo}
        leftSection={<IconFolder size={16} stroke={1.5} />}
        rightSection={<IconChevronRight size={14} className="mantine-rotate-chevron" />}
        defaultOpened={contieneRuta(nodo, pathname)}
        childrenOffset={18}
      >
        {nodo.hijos.map((h) => (
          <Nodo key={h.titulo + (h.ruta ?? '')} nodo={h} alNavegar={alNavegar} />
        ))}
      </NavLink>
    );
  if (nodo.proximamente)
    return <NavLink disabled label={<Text size="sm" c="dimmed" fs="italic">{nodo.titulo}</Text>} />;
  return (
    <NavLink
      label={nodo.titulo}
      leftSection={<IconFileText size={16} stroke={1.5} />}
      active={pathname === nodo.ruta}
      onClick={() => {
        navegar(nodo.ruta!);
        alNavegar?.();
      }}
    />
  );
}

export function MenuArbol({ menu, alNavegar }: { menu: NodoMenu[]; alNavegar?: () => void }) {
  return (
    <>
      {menu.map((n) => (
        <Nodo key={n.titulo} nodo={n} alNavegar={alNavegar} />
      ))}
    </>
  );
}
