import { accionesComprobante } from './comun';

describe('acciones de un comprobante de venta', () => {
  it('pendiente o rechazado sin emisión sin confirmar: editar, eliminar y emitir', () => {
    expect(accionesComprobante({ estado: 'RECHAZADO', numeroReservado: null })).toEqual({ editar: true, eliminar: true, emitir: true });
    expect(accionesComprobante({ estado: 'PENDIENTE_CAE', numeroReservado: null })).toEqual({ editar: true, eliminar: true, emitir: true });
  });
  it('con una emisión sin confirmar solo se reintenta', () => {
    expect(accionesComprobante({ estado: 'PENDIENTE_CAE', numeroReservado: 3 })).toEqual({ editar: false, eliminar: false, emitir: true });
  });
  it('autorizado: nada', () => {
    expect(accionesComprobante({ estado: 'AUTORIZADO', numeroReservado: null })).toEqual({ editar: false, eliminar: false, emitir: false });
  });
});
