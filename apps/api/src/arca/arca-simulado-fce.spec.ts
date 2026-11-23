import { ArcaSimuladoFce } from './arca-simulado-fce';
import { ErrorConexionArca } from './cliente-arca';

const db = { arcaSimuladoComprobante: { findMany: async () => [] } } as never;

describe('ArcaSimuladoFce (E50)', () => {
  const E = 'empresa-sim';
  afterEach(() => ArcaSimuladoFce.limpiar(E));

  it('obligados, recibidas, aceptar y rechazar', async () => {
    const c = new ArcaSimuladoFce(db, E, '30712345671');
    expect(await c.consultarObligacion('20-17254359-7', '20261102')).toEqual({ obligado: false, montoMinimo: null });
    ArcaSimuladoFce.obligar(E, '20172543597', '1000000.00');
    expect(await c.consultarObligacion('20-17254359-7', '20261102')).toEqual({ obligado: true, montoMinimo: '1000000.00' });
    expect(ArcaSimuladoFce.consultasObligacion(E)).toBe(2);
    const f = { cuitEmisor: '30500010912', cuitReceptor: '30712345671', cbteTipo: 201, ptoVta: 3, numero: 9, fecha: '2026-11-01', importe: '5000.00', moneda: 'PES', fechaVencimientoPago: '2026-12-01', estado: 'PENDIENTE' as const, fechaRecepcion: '2026-11-01', fechaLimite: '2026-12-01', motivosRechazo: [] };
    ArcaSimuladoFce.recibir(E, f);
    expect(await c.consultarComprobantes('RECEPTOR', '20260801', '20261130')).toEqual([f]);
    await c.aceptar({ ...f });
    expect((await c.consultarComprobantes('RECEPTOR', '20260801', '20261130'))[0].estado).toBe('ACEPTADA');
    ArcaSimuladoFce.recibir(E, { ...f, numero: 10 });
    await c.rechazar({ ...f, numero: 10 }, ['1'], 'x');
    const r = (await c.consultarComprobantes('RECEPTOR', '20260801', '20261130')).find((x) => x.numero === 10)!;
    expect([r.estado, r.motivosRechazo]).toEqual(['RECHAZADA', ['Mercadería no entregada']]);
    expect((await c.motivosRechazo()).map((m) => m.codigo)).toEqual(['1', '2', '3']);
  });

  it('sin conexión forzada', async () => {
    const c = new ArcaSimuladoFce(db, E, '30712345671');
    ArcaSimuladoFce.forzarSinConexion(E, true);
    await expect(c.consultarObligacion('20172543597', '20261102')).rejects.toThrow(ErrorConexionArca);
  });
});
