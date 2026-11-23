import { readFileSync } from 'fs';
import { join } from 'path';
import { ErrorServicioArca } from './cliente-arca';
import { leerComprobantesFce, leerObligacion, xmlAceptar, xmlConsultarComprobantes, xmlObligacion, xmlRechazar } from './wsfecred';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const auth = { token: 'T', sign: 'S', cuit: '30712345671' };

describe('wsfecred (E50)', () => {
  it('consulta del monto obligado', () => {
    const x = xmlObligacion(auth, '20-17254359-7', '20261102');
    expect(x).toContain('<cuitRepresentada>30712345671</cuitRepresentada>');
    expect(x).toContain('<cuitConsultada>20172543597</cuitConsultada>');
    expect(x).toContain('<fechaEmision>2026-11-02</fechaEmision>');
    expect(leerObligacion(fx('wsfecred-obligado.xml'))).toEqual({ obligado: true, montoMinimo: '3958316.00' });
  });

  it('error del servicio', () => {
    expect(() => leerObligacion(fx('wsfecred-error.xml'))).toThrow(ErrorServicioArca);
    expect(() => leerObligacion(fx('wsfecred-error.xml'))).toThrow('(1501) La CUIT consultada no es válida');
  });

  it('consulta de comprobantes y estados', () => {
    const x = xmlConsultarComprobantes(auth, 'RECEPTOR', '20260801', '20261106');
    expect(x).toContain('<rolCUITRepresentada>Receptor</rolCUITRepresentada>');
    expect(x).toContain('<desde>2026-08-01</desde>');
    const cs = leerComprobantesFce(fx('wsfecred-comprobantes.xml'));
    expect(cs).toEqual([
      { cuitEmisor: '30712345671', cuitReceptor: '20172543597', cbteTipo: 201, ptoVta: 2, numero: 15, fecha: '2026-11-02', importe: '5000000.00', moneda: 'PES', fechaVencimientoPago: '2026-12-02', estado: 'PENDIENTE', fechaRecepcion: '2026-11-02', fechaLimite: '2026-12-02', motivosRechazo: [] },
      { cuitEmisor: '30712345671', cuitReceptor: '20172543597', cbteTipo: 206, ptoVta: 2, numero: 3, fecha: '2026-10-01', importe: '100.00', moneda: 'PES', fechaVencimientoPago: null, estado: 'RECHAZADA', fechaRecepcion: null, fechaLimite: null, motivosRechazo: ['Diferencias de precio'] },
    ]);
  });

  it('aceptar y rechazar', () => {
    const f = { cuitEmisor: '30712345671', cbteTipo: 201, ptoVta: 2, numero: 15, importe: '5000000.00' };
    expect(xmlAceptar(auth, f)).toContain('<idCtaCte><cuitEmisor>30712345671</cuitEmisor><codTipoCmp>201</codTipoCmp><ptoVta>2</ptoVta><nroCmp>15</nroCmp></idCtaCte>');
    const r = xmlRechazar(auth, f, ['2'], 'Precio & cantidad <mal>');
    expect(r).toContain('<codMotivo>2</codMotivo>');
    expect(r).toContain('<justificacion>Precio &amp; cantidad &lt;mal&gt;</justificacion>');
  });
});
