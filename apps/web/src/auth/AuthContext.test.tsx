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
});
