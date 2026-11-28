import { ArbaCotReal } from './cliente-cot';

describe('cliente del COT (E59)', () => {
  const conRespuesta = (status: number, cuerpo: string) => {
    const orig = global.fetch;
    global.fetch = (async () => new Response(cuerpo, { status })) as typeof fetch;
    return () => { global.fetch = orig; };
  };

  it('401/403: error de usuario o clave', async () => {
    const restaurar = conRespuesta(403, 'Forbidden');
    const r = await new ArbaCotReal('PRUEBA').presentar('e', 'u', 'c', 'TB.txt', '01|x');
    restaurar();
    expect(r.errores).toEqual(['ARBA rechazó el usuario o la clave CIT']);
  });

  it('respuesta que no es XML: el detalle', async () => {
    const restaurar = conRespuesta(200, '<html><body>Servicio en mantenimiento</body></html>');
    const r = await new ArbaCotReal('PRUEBA').presentar('e', 'u', 'c', 'TB.txt', '01|x');
    restaurar();
    expect(r.errores).toEqual(['ARBA respondió 200: Servicio en mantenimiento']);
  });
});
