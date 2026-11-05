import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RequiereAuth } from './auth/RequiereAuth';
import { SeleccionEmpresaPage } from './auth/SeleccionEmpresaPage';
import { AppLayout } from './layout/AppLayout';
import { InicioPage } from './paginas/InicioPage';
import { RUTAS_PAGINAS } from './paginas/rutas';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/empresa" element={<SeleccionEmpresaPage />} />
      <Route
        element={
          <RequiereAuth>
            <AppLayout />
          </RequiereAuth>
        }
      >
        <Route index element={<InicioPage />} />
        {RUTAS_PAGINAS.map((r) => (
          <Route key={r.ruta} path={r.ruta} element={r.elemento} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
