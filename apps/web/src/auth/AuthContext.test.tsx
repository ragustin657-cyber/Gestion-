import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { sesion } from './sesion';

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(['/terceros', {}], { items: [{ id: 'de-otra-empresa' }], total: 1 });
  let auth!: ReturnType<typeof useAuth>;
  const Sonda = () => {
    auth = useAuth();
    return null;
  };
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider><Sonda /></AuthProvider>
    </QueryClientProvider>,
  );
  return { qc, auth: () => auth };
}

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sesion.guardar({ token: 't', usuario: { id: 'u', nombre: 'U' }, empresa: { id: 'A', razonSocial: 'A' } });
  });

  it('al salir borra los datos en caché', () => {
    const { qc, auth } = setup();
    act(() => auth().salir());
    expect(qc.getQueryData(['/terceros', {}])).toBeUndefined();
  });

  it('al elegir otra empresa borra los datos en caché', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 't2', empresa: { id: 'B', razonSocial: 'B' }, permisos: [] }), { status: 200 }),
    ));
    const { qc, auth } = setup();
    await act(() => auth().elegirEmpresa('B'));
    expect(qc.getQueryData(['/terceros', {}])).toBeUndefined();
  });

  it('un superadmin puede todo aunque no tenga permisos en la empresa', () => {
    sesion.guardar({ token: 't', usuario: { id: 'u', nombre: 'U' }, empresa: { id: 'A', razonSocial: 'A' }, permisos: [], superadmin: true });
    const { auth } = setup();
    expect(auth().puede('venta.emitir')).toBe(true);
  });

  it('al volver a la pestaña refresca los permisos de la sesión', async () => {
    sesion.guardar({ token: 't', usuario: { id: 'u', nombre: 'U' }, empresa: { id: 'A', razonSocial: 'A' }, permisos: [] });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usuarioId: 'u', empresaId: 'A', permisos: ['venta.emitir'], superadmin: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { auth } = setup();
    expect(auth().puede('venta.emitir')).toBe(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); await Promise.resolve(); });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/yo');
    expect(auth().puede('venta.emitir')).toBe(true);
    expect(sesion.leer()!.permisos).toEqual(['venta.emitir']);
  });
});
