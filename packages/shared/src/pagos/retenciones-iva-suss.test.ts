import { describe, expect, it } from 'vitest';
import { netearNotasCredito, retencionIva, retencionSuss } from './retenciones-iva-suss';

const base = { ivaFactura: '21000', totalFactura: '121000', imputado: '60500', porcentaje: '50', minimoComprobante: '0', minimoRetencion: '0', exclusion: 0 as const };

describe('retenciones de IVA y SUSS (E35)', () => {
  it('IVA proporcional a lo pagado', () => {
    expect(retencionIva(base)).toEqual({ base: '10500.00', importe: '5250.00' });
  });
  it('exclusión del 50 y del 100 %', () => {
    expect(retencionIva({ ...base, exclusion: 50 }).importe).toBe('2625.00');
    expect(retencionIva({ ...base, exclusion: 100 }).importe).toBe('0.00');
  });
  it('mínimos de comprobante y de retención', () => {
    expect(retencionIva({ ...base, minimoComprobante: '200000' }).importe).toBe('0.00');
    expect(retencionIva({ ...base, minimoRetencion: '6000' }).importe).toBe('0.00');
  });
  it('sin IVA o sin pago no retiene', () => {
    expect(retencionIva({ ...base, ivaFactura: '0' }).importe).toBe('0.00');
    expect(retencionIva({ ...base, imputado: '0' }).importe).toBe('0.00');
  });
  it('SUSS sobre la base y sus mínimos', () => {
    expect(retencionSuss({ base: '100000', porcentaje: '6', minimoNoSujeto: '0', minimoRetencion: '0' }).importe).toBe('6000.00');
    expect(retencionSuss({ base: '100000', porcentaje: '6', minimoNoSujeto: '150000', minimoRetencion: '0' }).importe).toBe('0.00');
    expect(retencionSuss({ base: '100000', porcentaje: '6', minimoNoSujeto: '0', minimoRetencion: '7000' }).importe).toBe('0.00');
  });
  it('notas de crédito: primero la factura asociada, el resto en proporción', () => {
    const r = netearNotasCredito([{ id: 'a', imputado: '100' }, { id: 'b', imputado: '300' }], [{ asociadaId: 'a', imputado: '60' }, { asociadaId: null, imputado: '40' }]);
    // a queda en 40 tras su nota; los 40 sin asociada se reparten sobre lo que queda (40 y 300)
    expect(r).toEqual([{ id: 'a', imputado: '35.29' }, { id: 'b', imputado: '264.71' }]);
  });
  it('nota de crédito mayor que su factura: el sobrante se reparte y nunca queda negativo', () => {
    const r = netearNotasCredito([{ id: 'a', imputado: '100' }, { id: 'b', imputado: '100' }], [{ asociadaId: 'a', imputado: '150' }]);
    expect(r).toEqual([{ id: 'a', imputado: '0.00' }, { id: 'b', imputado: '50.00' }]);
  });
});
