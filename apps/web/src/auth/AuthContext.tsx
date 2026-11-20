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

  // E36: los permisos se refrescan al volver a la pestaña y cada 5 minutos (un cambio de rol se ve sin volver a elegir la empresa)
  const empresaId = sesion?.empresa?.id;
  useEffect(() => {
    if (!empresaId) return;
    const refrescar = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const yo = await api<{ permisos?: Permiso[]; superadmin?: boolean }>('/auth/yo');
        const actual = almacen.leer();
        if (!actual?.empresa) return;
        const nueva: Sesion = { ...actual, permisos: yo.permisos ?? [], superadmin: !!yo.superadmin };
        almacen.guardar(nueva);
        setSesion(nueva);
      } catch {
        /* sin conexión: se reintenta en el próximo ciclo; un 401 ya cierra la sesión */
      }
    };
    const intervalo = window.setInterval(() => void refrescar(), 5 * 60 * 1000);
    const alVolver = () => void refrescar();
    document.addEventListener('visibilitychange', alVolver);
    return () => { window.clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver); };
  }, [empresaId]);

  const salir = useCallback(() => almacen.cerrar(), []);
  // E36: un superadmin puede todo (el servidor ya lo permite)
  const puede = useCallback((p: Permiso) => !!sesion?.superadmin || !!sesion?.permisos?.includes(p), [sesion]);

  return <Ctx.Provider value={{ sesion, ingresar, elegirEmpresa, salir, puede }}>{children}</Ctx.Provider>;
}

export function useAuth(): ValorAuth {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
