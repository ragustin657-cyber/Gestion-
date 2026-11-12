import { tramoPorDefecto, tramosParaEnviar } from './contabilidad/ajuste-inflacion/ConfigAjustePage';
import { depositoParaEditar } from './ventas/ComprobanteVentaPage';

describe('entrega 12: pulido web', () => {
  it('el tramo nuevo propone el mes anterior al inicio del ejercicio', () => {
    expect(tramoPorDefecto('2026-01-01', 200)).toEqual({ anio: 2025, mes: 12, importe: '200.00' });
    expect(tramoPorDefecto('2026-07-01', 0)).toEqual({ anio: 2026, mes: 6, importe: '0.00' });
  });
  it('no se envían tramos sin importe', () => {
    expect(tramosParaEnviar([{ cuentaContableId: 'a', codigo: 'X', nombre: 'X', saldoApertura: '10', tramos: [{ anio: 2025, mes: 6, importe: '' }, { anio: 2025, mes: 7, importe: '5' }] }]))
      .toEqual([{ cuentaContableId: 'a', tramos: [{ anio: 2025, mes: 7, importe: 5 }] }]);
  });
  it('al recargar un borrador, el depósito igual al del punto de venta queda vacío', () => {
    expect(depositoParaEditar('d1', 'd1')).toBeNull();
    expect(depositoParaEditar('d2', 'd1')).toBe('d2');
    expect(depositoParaEditar(null, 'd1')).toBeNull();
  });
});
