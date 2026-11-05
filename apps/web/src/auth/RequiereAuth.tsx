import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequiereAuth({ children }: { children: ReactNode }) {
  const { sesion } = useAuth();
  if (!sesion) return <Navigate to="/login" replace />;
  if (!sesion.empresa) return <Navigate to="/empresa" replace />;
  return <>{children}</>;
}
