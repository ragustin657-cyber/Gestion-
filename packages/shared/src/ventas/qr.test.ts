import { describe, expect, it } from 'vitest';
import { urlQrArca } from './qr';

describe('urlQrArca', () => {
  it('URL con el JSON en base64', () => {
    const url = urlQrArca({ fecha: '2026-11-08', cuit: '30712345671', ptoVta: 2, tipoCmp: 6, nroCmp: 15, importe: '1210.00', moneda: 'PES', ctz: '1', tipoDocRec: 99, nroDocRec: '0', cae: '70417054367476' });
    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true);
    const json = JSON.parse(Buffer.from(url.split('?p=')[1], 'base64').toString('utf8'));
    expect(json).toEqual({ ver: 1, fecha: '2026-11-08', cuit: 30712345671, ptoVta: 2, tipoCmp: 6, nroCmp: 15, importe: 1210, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: 70417054367476 });
  });
});
