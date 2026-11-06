import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorConexionArca } from './cliente-arca';
import { leerConsultar, leerSolicitarCae, leerUltimoAutorizado, xmlSolicitarCae } from './wsfe';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const auth = { token: 'T', sign: 'S', cuit: '30712345671' };

describe('WSFE', () => {
  it('arma FECAESolicitar de una NC B con asociado y sin IVA', () => {
    const xml = xmlSolicitarCae(auth, {
      ptoVta: 2, cbteTipo: 8, numero: 5, concepto: 1, docTipo: 99, docNro: '0', condicionIvaReceptor: 5, fecha: '20261108',
      impTotal: '100.00', impTotConc: '100.00', impNeto: '0.00', impOpEx: '0.00', impIva: '0.00', monId: 'PES', monCotiz: '1',
      iva: [], asociados: [{ tipo: 6, ptoVta: 2, nro: 3, cuit: '30712345671', fecha: '20261101' }],
    });
    expect(xml).toContain('<ar:CbteTipo>8</ar:CbteTipo>');
    expect(xml).toContain('<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>');
    expect(xml).toContain('<ar:CbtesAsoc>');
    expect(xml).toContain('<ar:CbteDesde>5</ar:CbteDesde>');
    expect(xml).toContain('<ar:CanMisMonExt>N</ar:CanMisMonExt>');
    expect(xml).not.toContain('<ar:Iva>');
    expect(xml).not.toContain('<ar:FchServDesde>');
  });
  it('arma IVA y fechas de servicio cuando corresponde', () => {
    const xml = xmlSolicitarCae(auth, {
      ptoVta: 2, cbteTipo: 1, numero: 1, concepto: 2, docTipo: 80, docNro: '30712345671', condicionIvaReceptor: 1, fecha: '20261108',
      impTotal: '121.00', impTotConc: '0.00', impNeto: '100.00', impOpEx: '0.00', impIva: '21.00', monId: 'DOL', monCotiz: '1000',
      fchServDesde: '20261001', fchServHasta: '20261031', fchVtoPago: '20261120',
      iva: [{ id: 5, baseImp: '100.00', importe: '21.00' }], asociados: [],
    });
    expect(xml).toContain('<ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>100.00</ar:BaseImp><ar:Importe>21.00</ar:Importe></ar:AlicIva>');
    expect(xml).toContain('<ar:FchServDesde>20261001</ar:FchServDesde>');
    expect(xml).toContain('<ar:MonId>DOL</ar:MonId>');
    expect(xml).not.toContain('<ar:CbtesAsoc>');
  });
  it('lee una respuesta aprobada', () => {
    expect(leerSolicitarCae(fx('cae-aprobado.xml'))).toEqual({ resultado: 'A', cae: '76451234567890', caeVencimiento: '2026-11-18', observaciones: [] });
  });
  it('lee una respuesta aprobada con observaciones', () => {
    const r = leerSolicitarCae(fx('cae-observado.xml'));
    expect(r).toMatchObject({ resultado: 'A', observaciones: ['(10217) El credito fiscal discriminado no es computable'] });
  });
  it('lee un rechazo con sus errores y observaciones', () => {
    expect(leerSolicitarCae(fx('cae-rechazado.xml'))).toEqual({ resultado: 'R', errores: ['(10016) El numero de comprobante no es el proximo a autorizar', '(10048) El campo ImpTotal no coincide'] });
  });
  it('un error de token es un error de conexión marcado', () => {
    try {
      leerSolicitarCae(fx('error-600.xml'));
      throw new Error('no lanzó');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorConexionArca);
      expect((e as ErrorConexionArca).tokenInvalido).toBe(true);
    }
  });
  it('una respuesta ilegible es un error de conexión', () => {
    expect(() => leerSolicitarCae('<html>502 Bad Gateway</html>')).toThrow(ErrorConexionArca);
  });
  it('último autorizado y consulta', () => {
    expect(leerUltimoAutorizado(fx('ultimo-autorizado.xml'))).toBe(14);
    expect(leerConsultar(fx('consultar.xml'))).toEqual({ numero: 14, docNro: '30712345671', fecha: '2026-11-08', impTotal: '121.00', monId: 'PES', cae: '76451234567890', caeVencimiento: '2026-11-18' });
    expect(leerConsultar(fx('consultar-inexistente.xml'))).toBeNull();
  });
});
