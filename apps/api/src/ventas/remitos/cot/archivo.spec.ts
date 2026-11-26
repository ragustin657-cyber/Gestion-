import { archivoCot, nombreArchivoCot, type DatosArchivoCot } from './archivo';

const base: DatosArchivoCot = {
  cuitEmpresa: '30712345671', razonSocialEmpresa: 'Empresa SA',
  remito: { tipo: 'ENTREGA', puntoVenta: 1, numero: 12, fecha: new Date('2026-11-06T00:00:00Z'), fechaSalida: new Date('2026-11-06T00:00:00Z'), horaSalida: '0930', importe: '9000.5' },
  destinatario: { tipoDocumento: 'CUIT', documento: '20172543597', razonSocial: 'Distribuidora Norte SA', consumidorFinal: false },
  deposito: { calle: 'Av. Mitre', numero: '100', codigoPostal: '1870', localidad: 'Avellaneda', provincia: 'B' },
  traslado: { calle: 'San Martín', numero: '50', codigoPostal: '1900', localidad: 'La Plata', provincia: 'B' },
  transportistaCuit: null, patente: 'AB123CD', patenteAcoplado: null,
  renglones: [
    { unidad: '7', cantidad: '10', nomenclador: '123456', descripcion: 'Producto uno' },
    { unidad: '1', cantidad: '2.5', nomenclador: '654321', descripcion: 'Producto dos' },
  ],
};

describe('archivo del COT de ARBA (E57)', () => {
  it('nombre del archivo', () => {
    expect(nombreArchivoCot('30-71234567-1', 1, 2, new Date('2026-11-06T00:00:00Z'), 7)).toBe('TB_30712345671_000001002_20261106_000007.txt');
  });

  it('registros 01, 02, 03 por renglón y 04', () => {
    const l = archivoCot(base).split('\r\n').filter(Boolean);
    expect(l.map((x) => x.slice(0, 3))).toEqual(['01|', '02|', '03|', '03|', '04|']);
    expect(l[0]).toBe('01|30712345671');
    expect(l[4]).toBe('04|1');
    expect(l[1]).toContain('|R000100000012|');
    expect(l[1]).toContain('|AB123CD|');
    // Transporte propio: el CUIT del transportista es el de la empresa
    expect(l[1].split('|')).toContain('30712345671');
    expect(l[2]).toContain('|123456');
  });

  it('devolución: el origen es el domicilio del traslado y el destino el depósito', () => {
    const l = archivoCot({ ...base, remito: { ...base.remito, tipo: 'DEVOLUCION' } }).split('\r\n');
    const c = l[1];
    expect(c.indexOf('Av. Mitre')).toBeLessThan(c.indexOf('San Martín'));
    const e = archivoCot(base).split('\r\n')[1];
    expect(e.indexOf('San Martín')).toBeLessThan(e.indexOf('Av. Mitre'));
  });
});
