import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { TablaPresentaciones } from './PresentacionesPages';

describe('historial de presentaciones', () => {
  it('avisa cuando los datos del período cambiaron', () => {
    render(<MantineProvider><TablaPresentaciones filas={[{
      id: 'p1', tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611', quincena: 0, nombreArchivo: 'LIBRO.zip', registros: 5, total: '100', advertencias: [],
      generadoEn: '2026-11-05T13:00:00.000Z', cambiaron: true,
    }]} /></MantineProvider>);
    expect(screen.getByText('Los datos del período cambiaron desde la generación del 05/11/2026: corresponde rectificar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });
});
