import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Permiso } from '@gestion/shared';
import { api } from '../api/cliente';
import { EVENTO_SESION_CERRADA, Sesion, sesion as almacen } from './sesion';

interface ValorAuth {
  sesion: Sesion | null;
  ingresar(email: string, password: string): Promise<Sesion>;
  elegirEmpresa(empresaId: string): Promise<void>;
  salir(): void;
  puede(p: Permiso): boolean;
}

const Ctx = createContext<ValorAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(() => almacen.leer());
  const consultas = useQueryClient();

  useEffect(() => {
    // Al cerrar sesión (también por un 401) se descartan los datos en caché del usuario anterior
    const alCerrar = () => {
      consultas.clear();
      setSesion(null);
    };
    window.addEventListener(EVENTO_SESION_CERRADA, alCerrar);
    return () => window.removeEventListener(EVENTO_SESION_CERRADA, alCerrar);
  }, [consultas]);

  const ingresar = useCallback(async (email: string, password: string) => {
    const r = await api<Sesion>('/auth/login', { metodo: 'POST', body: { email, password } });
    consultas.clear();
    almacen.guardar(r);
    setSesion(r);
    return r;
  }, [consultas]);

  const elegirEmpresa = useCallback(async (empresaId: string) => {
    const r = await api<{ token: string; empresa: Sesion['empresa']; permisos: Permiso[]; superadmin?: boolean; sucursal?: Sesion['sucursal'] }>('/auth/empresa', {
      metodo: 'POST',
      body: { empresaId },
    });
    const actual = almacen.leer()!;
    const nueva: Sesion = { ...actual, token: r.token, empresa: r.empresa, permisos: r.permisos, superadmin: !!r.superadmin, sucursal: r.sucursal ?? null };
    consultas.clear();
    almacen.guardar(nueva);
    setSesion(nueva);
  }, [consultas]);

  const salir = useCallback(() => almacen.cerrar(), []);
  const puede = useCallback((p: Permiso) => !!sesion?.permisos?.includes(p), [sesion]);

  return <Ctx.Provider value={{ sesion, ingresar, elegirEmpresa, salir, puede }}>{children}</Ctx.Provider>;
}

export function useAuth(): ValorAuth {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
