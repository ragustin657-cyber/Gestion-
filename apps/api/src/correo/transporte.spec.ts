import { crearTransporte, TransporteMemoria, TransporteSmtp } from './transporte';

describe('elección del transporte de correo', () => {
  const previa = process.env.TRANSPORTE_CORREO;
  afterEach(() => { process.env.TRANSPORTE_CORREO = previa; });
  it('se decide al crear el proveedor, no al importar el módulo (el .env se carga después)', () => {
    process.env.TRANSPORTE_CORREO = 'prueba';
    expect(crearTransporte()).toBeInstanceOf(TransporteMemoria);
    delete process.env.TRANSPORTE_CORREO;
    expect(crearTransporte()).toBeInstanceOf(TransporteSmtp);
  });
});
