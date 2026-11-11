import { linea } from './escritor';
import { AGIP_RETENCION, ARBA_ALTA, LIVA_COMPRAS_ALICUOTAS, LIVA_COMPRAS_CBTE, LIVA_VENTAS_ALICUOTAS, LIVA_VENTAS_CBTE, SICORE } from './formatos';

const largo = (cs: { largo: number }[]) => cs.reduce((s, c) => s + c.largo, 0);

describe('diseños oficiales', () => {
  it('largos de registro', () => {
    expect([LIVA_VENTAS_CBTE, LIVA_VENTAS_ALICUOTAS, LIVA_COMPRAS_CBTE, LIVA_COMPRAS_ALICUOTAS, SICORE, ARBA_ALTA, AGIP_RETENCION].map(largo)).toEqual([266, 62, 325, 84, 145, 67, 215]);
  });
  it('nombres únicos por diseño', () => {
    for (const d of [LIVA_VENTAS_CBTE, LIVA_VENTAS_ALICUOTAS, LIVA_COMPRAS_CBTE, LIVA_COMPRAS_ALICUOTAS, SICORE, ARBA_ALTA, AGIP_RETENCION])
      expect(new Set(d.map((c) => c.nombre)).size).toBe(d.length);
  });
  it('registro de AGIP en sus posiciones', () => {
    const f = new Date('2026-11-05T00:00:00Z');
    const { texto } = linea(AGIP_RETENCION, {
      tipoOperacion: 1, codigoNorma: '029', fechaRetencion: f, tipoComprobante: '03', letra: '', numeroComprobante: 15, fechaComprobante: f,
      montoComprobante: '1000', certificadoPropio: '12', tipoDocumento: 3, numeroDocumento: '30711223343', situacionIibb: 2, numeroIibb: '9011234567',
      situacionIva: 1, razonSocial: 'Papelera', importeOtrosConceptos: '0', importeIva: '0', montoSujeto: '1000', alicuota: '3', retencion: '30', montoTotal: '30',
    });
    expect(texto).toHaveLength(215);
    expect([texto[0], texto.slice(1, 4), texto.slice(4, 14), texto.slice(14, 16), texto[16], texto.slice(178, 183), texto.slice(183, 199)])
      .toEqual(['1', '029', '05/11/2026', '03', ' ', '03,00', '0000000000030,00']);
  });
  it('SICORE: los primeros campos como el ejemplo del instructivo', () => {
    const { texto } = linea(SICORE, {
      codigoComprobante: '01', fechaComprobante: new Date('2002-12-10T00:00:00Z'), numeroComprobante: '012300000456', importeComprobante: '30',
      codigoImpuesto: 217, codigoRegimen: 56, codigoOperacion: 1, baseCalculo: '50', fechaRetencion: new Date('2002-12-11T00:00:00Z'), codigoCondicion: 0,
      suspendidos: 0, importeRetencion: '50', porcentajeExclusion: '0', fechaBoletin: null, tipoDocumento: 80, numeroDocumento: '23111111111', certificadoOriginal: 0,
    });
    expect(texto).toHaveLength(145);
    expect(texto.slice(0, 12)).toBe('0110/12/2002');
    expect(texto.slice(44, 52)).toBe('02170561');
    expect(texto.slice(66, 76)).toBe('11/12/2002');
  });
});
