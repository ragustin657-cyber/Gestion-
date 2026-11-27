import { leerFexAuthorize, leerFexUltimo, xmlFexAuthorize, type DatosFex } from './wsfex';

const auth = { token: 'T', sign: 'S', cuit: '30712345671' };
const servicios: DatosFex = {
  id: 7, fecha: '20261106', cbteTipo: 19, ptoVta: 5, numero: 1, tipoExpo: 2, permisoExistente: '', permisos: [], dstCmp: 212, cliente: 'Acme Inc.',
  cuitPaisCliente: '55000002126', domicilioCliente: '1 Main St, New York', idImpositivo: 'US-123456789', monedaId: 'DOL', monedaCtz: '1000', impTotal: '1000.00',
  formaPago: 'Transferencia', incoterms: '', incotermsDs: '', idioma: 1, asociados: [],
  items: [{ codigo: '', descripcion: 'Servicio de software', cantidad: '1', umed: 7, precio: '1000', bonificacion: '0.00', total: '1000.00' }],
};

describe('WSFEX (E58)', () => {
  it('FEXAuthorize de servicios', () => {
    const x = xmlFexAuthorize(auth, servicios);
    for (const t of ['<ar:Cbte_Tipo>19</ar:Cbte_Tipo>', '<ar:Tipo_expo>2</ar:Tipo_expo>', '<ar:Moneda_Id>DOL</ar:Moneda_Id>', '<ar:Cuit_pais_cliente>55000002126</ar:Cuit_pais_cliente>', '<ar:Pro_total_item>1000.00</ar:Pro_total_item>', '<ar:Id>7</ar:Id>'])
      expect(x).toContain(t);
    expect(x).not.toContain('<ar:Permiso>');
  });

  it('FEXAuthorize de bienes con permiso', () => {
    const x = xmlFexAuthorize(auth, { ...servicios, tipoExpo: 1, permisoExistente: 'S', permisos: [{ id: '26001EC01000001A', dstMerc: 212 }], incoterms: 'FOB', incotermsDs: 'Puerto' });
    expect(x).toContain('<ar:Permiso_existente>S</ar:Permiso_existente>');
    expect(x).toContain('<ar:Permiso><ar:Id_permiso>26001EC01000001A</ar:Id_permiso><ar:Dst_merc>212</ar:Dst_merc></ar:Permiso>');
    expect(x).toContain('<ar:Incoterms>FOB</ar:Incoterms>');
  });

  const respuesta = (cuerpo: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEXAuthorizeResponse xmlns="http://ar.gov.afip.dif.fexv1/"><FEXAuthorizeResult>${cuerpo}</FEXAuthorizeResult></FEXAuthorizeResponse></soap:Body></soap:Envelope>`;

  it('respuesta aprobada y rechazada', () => {
    expect(leerFexAuthorize(respuesta('<FEXResultAuth><Id>7</Id><Cae>76123456789012</Cae><Fch_venc_Cae>20261116</Fch_venc_Cae><Resultado>A</Resultado><Motivos_Obs></Motivos_Obs></FEXResultAuth><FEXErr><ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg></FEXErr>')))
      .toEqual({ resultado: 'A', cae: '76123456789012', caeVencimiento: '2026-11-16', observaciones: [] });
    expect(leerFexAuthorize(respuesta('<FEXErr><ErrCode>1000</ErrCode><ErrMsg>Campo Cuit_pais_cliente inválido</ErrMsg></FEXErr>')))
      .toEqual({ resultado: 'R', errores: ['(1000) Campo Cuit_pais_cliente inválido'] });
  });

  it('último comprobante', () => {
    const x = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEXGetLast_CMPResponse xmlns="http://ar.gov.afip.dif.fexv1/"><FEXGetLast_CMPResult><FEXResult_LastCMP><Cbte_nro>4</Cbte_nro><Cbte_fecha>20261105</Cbte_fecha></FEXResult_LastCMP><FEXErr><ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg></FEXErr></FEXGetLast_CMPResult></FEXGetLast_CMPResponse></soap:Body></soap:Envelope>`;
    expect(leerFexUltimo(x)).toBe(4);
  });
});
