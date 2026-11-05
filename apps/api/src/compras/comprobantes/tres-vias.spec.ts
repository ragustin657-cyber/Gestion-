import { detectarDiferencias } from './tres-vias';

const tol = { precioPct: '2', cantidadPct: '0' };

describe('detectarDiferencias', () => {
  it('precio 1030 contra 1000 con tolerancia 2 → diferencia de 3 %', () => {
    expect(detectarDiferencias([{ indice: 0, precioFacturado: '1030', precioOc: '1000', cantidadFacturada: '1', pendienteFacturar: '1' }], tol)).toEqual([
      { renglon: 0, tipo: 'PRECIO', esperado: '1000', facturado: '1030', diferenciaPct: '3.00' },
    ]);
  });
  it('precio 1015 está dentro de la tolerancia', () => {
    expect(detectarDiferencias([{ indice: 0, precioFacturado: '1015', precioOc: '1000', cantidadFacturada: '1', pendienteFacturar: '1' }], tol)).toEqual([]);
  });
  it('cantidad 5 contra pendiente 4 → diferencia de cantidad', () => {
    expect(detectarDiferencias([{ indice: 1, precioFacturado: '1000', precioOc: '1000', cantidadFacturada: '5', pendienteFacturar: '4' }], tol)).toEqual([
      { renglon: 1, tipo: 'CANTIDAD', esperado: '4', facturado: '5', diferenciaPct: '25.00' },
    ]);
  });
  it('pendiente 0 → diferencia de cantidad del 100 %', () => {
    expect(detectarDiferencias([{ indice: 0, precioFacturado: '1', precioOc: '1', cantidadFacturada: '2', pendienteFacturar: '0' }], tol)[0]).toMatchObject({ tipo: 'CANTIDAD', diferenciaPct: '100.00' });
  });
});
