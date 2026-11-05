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

  useEffect(() => {
    const alCerrar = () => setSesion(null);
    window.addEventListener(EVENTO_SESION_CERRADA, alCerrar);
    return () => window.removeEventListener(EVENTO_SESION_CERRADA, alCerrar);
  }, []);

  const ingresar = useCallback(async (email: string, password: string) => {
    const r = await api<Sesion>('/auth/login', { metodo: 'POST', body: { email, password } });
    almacen.guardar(r);
    setSesion(r);
    return r;
  }, []);

  const elegirEmpresa = useCallback(async (empresaId: string) => {
    const r = await api<{ token: string; empresa: Sesion['empresa']; permisos: Permiso[] }>('/auth/empresa', {
      metodo: 'POST',
      body: { empresaId },
    });
    const actual = almacen.leer()!;
    const nueva: Sesion = { ...actual, token: r.token, empresa: r.empresa, permisos: r.permisos };
    almacen.guardar(nueva);
    setSesion(nueva);
  }, []);

  const salir = useCallback(() => almacen.cerrar(), []);
  const puede = useCallback((p: Permiso) => !!sesion?.permisos?.includes(p), [sesion]);

  return <Ctx.Provider value={{ sesion, ingresar, elegirEmpresa, salir, puede }}>{children}</Ctx.Provider>;
}

export function useAuth(): ValorAuth {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
