import { api, ErrorApi } from './cliente';
import { sesion } from '../auth/sesion';

describe('api()', () => {
  beforeEach(() => {
    localStorage.clear();
    sesion.guardar({ token: 'tok', usuario: { id: 'u', nombre: 'U' } });
  });

  it('envía el token y devuelve el JSON', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await api('/terceros', { query: { q: 'a b' } })).toEqual({ ok: 1 });
    expect(f.mock.calls[0][0]).toBe('/api/terceros?q=a+b');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('ante 401 cierra la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"x"}', { status: 401 })));
    await expect(api('/x')).rejects.toBeInstanceOf(ErrorApi);
    expect(sesion.leer()).toBeNull();
  });

  it('ante 400 lanza ErrorApi con campos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'CUIT inválido', campos: { cuit: 'CUIT inválido' } }), { status: 400 }),
    ));
    await expect(api('/x', { metodo: 'POST', body: {} })).rejects.toMatchObject({
      status: 400, mensaje: 'CUIT inválido', campos: { cuit: 'CUIT inválido' },
    });
  });
});
