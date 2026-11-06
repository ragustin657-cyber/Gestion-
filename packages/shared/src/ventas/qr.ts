export interface DatosQr {
  fecha: string; cuit: string; ptoVta: number; tipoCmp: number; nroCmp: number; importe: string;
  moneda: 'PES' | 'DOL'; ctz: string; tipoDocRec: number; nroDocRec: string; cae: string;
}

/** URL del código QR de ARCA: el JSON del comprobante en base64. */
export function urlQrArca(d: DatosQr): string {
  const json = JSON.stringify({
    ver: 1, fecha: d.fecha, cuit: Number(d.cuit), ptoVta: d.ptoVta, tipoCmp: d.tipoCmp, nroCmp: d.nroCmp,
    importe: Number(d.importe), moneda: d.moneda, ctz: Number(d.ctz), tipoDocRec: d.tipoDocRec, nroDocRec: Number(d.nroDocRec) || 0,
    tipoCodAut: 'E', codAut: Number(d.cae),
  });
  return `https://www.afip.gob.ar/fe/qr/?p=${globalThis.btoa(json)}`;
}
