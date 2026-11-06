import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArcaReal, Token } from './arca-real';
import { certificadoDePrueba } from './certificado-prueba';
import { ErrorConexionArca } from './cliente-arca';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

function armar(respuestas: string[], token: Token | null = null) {
  const llamadas: { url: string; accion: string }[] = [];
  let guardado = token;
  const fetchFalso = (async (url: string, init: { headers: Record<string, string> }) => {
    llamadas.push({ url, accion: init.headers.SOAPAction });
    const r = respuestas.shift();
    if (r === undefined) throw new Error('sin respuesta');
    return { text: async () => r } as Response;
  }) as unknown as typeof fetch;
  const { crt, key } = certificadoDePrueba('30712345671');
  const arca = new ArcaReal({
    ambiente: 'HOMOLOGACION', cuit: '30712345671', crt, key, fetch: fetchFalso,
    tokens: { leer: async () => guardado, guardar: async (t) => { guardado = t; }, borrar: async () => { guardado = null; } },
  });
  return { arca, llamadas, token: () => guardado };
}

describe('ArcaReal', () => {
  it('hace login, guarda el token y lo reutiliza', async () => {
    const vigente = { token: 'T', sign: 'S', vence: new Date(Date.now() + 3600000) };
    const { arca, llamadas } = armar([fx('ultimo-autorizado.xml'), fx('ultimo-autorizado.xml')], vigente);
    expect(await arca.ultimoAutorizado(2, 1)).toBe(14);
    expect(await arca.ultimoAutorizado(2, 1)).toBe(14);
    expect(llamadas.map((l) => l.url)).toEqual([expect.stringContaining('wswhomo'), expect.stringContaining('wswhomo')]);
  });
  it('con el token vencido hace login primero', async () => {
    const { arca, llamadas, token } = armar([fx('login-cms.xml'), fx('ultimo-autorizado.xml')], { token: 'X', sign: 'Y', vence: new Date(Date.now() + 60000) });
    expect(await arca.ultimoAutorizado(2, 1)).toBe(14);
    expect(llamadas[0].url).toContain('wsaahomo');
    expect(token()?.token).toBe('PD94bWwgdG9rZW4=');
  });
  it('ante el error 600 descarta el token, hace login y reintenta una vez', async () => {
    const vigente = { token: 'T', sign: 'S', vence: new Date(Date.now() + 3600000) };
    const { arca, llamadas } = armar([fx('error-600.xml'), fx('login-cms.xml'), fx('cae-aprobado.xml')], vigente);
    const r = await arca.solicitarCae({ ptoVta: 2, cbteTipo: 1, numero: 1, concepto: 1, docTipo: 80, docNro: '1', condicionIvaReceptor: 1, fecha: '20261108', impTotal: '1', impTotConc: '0', impNeto: '1', impOpEx: '0', impIva: '0', monId: 'PES', monCotiz: '1', iva: [], asociados: [] });
    expect(r.resultado).toBe('A');
    expect(llamadas.map((l) => l.accion)).toEqual(['http://ar.gov.afip.dif.FEV1/FECAESolicitar', '', 'http://ar.gov.afip.dif.FEV1/FECAESolicitar']);
  });
  it('un corte de red es un error de conexión', async () => {
    const { arca } = armar([], { token: 'T', sign: 'S', vence: new Date(Date.now() + 3600000) });
    await expect(arca.ultimoAutorizado(2, 1)).rejects.toBeInstanceOf(ErrorConexionArca);
  });
});
