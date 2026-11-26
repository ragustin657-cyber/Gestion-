import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { cuerpoExportacion, exentoParaExportacion, SeccionExportacion, type DatosExportacion } from './exportacion';

const envolver = (n: React.ReactNode) => render(<MantineProvider>{n}</MantineProvider>);
function Prueba({ inicial }: { inicial: DatosExportacion }) {
  const [v, setV] = useState(inicial);
  return <SeccionExportacion valor={v} onChange={setV} />;
}
const base: DatosExportacion = { tipoExportacion: 'SERVICIOS', paisDestino: 212, incoterm: null, incotermDescripcion: '', formaPago: '', idioma: 1, permisoExistente: null, permisos: [] };

describe('factura de exportación (web, E58)', () => {
  it('servicios: sin incoterm ni permisos; bienes con permiso: grilla de permisos', () => {
    const { unmount } = envolver(<Prueba inicial={base} />);
    expect(screen.queryByRole('textbox', { name: 'Incoterm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar permiso' })).toBeNull();
    unmount();
    envolver(<Prueba inicial={{ ...base, tipoExportacion: 'BIENES', permisoExistente: 'S' }} />);
    expect(screen.getByRole('textbox', { name: 'Incoterm' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar permiso' }));
    expect(screen.getByLabelText('Permiso 1')).toBeInTheDocument();
  });

  it('el cuerpo manda permisos solo en bienes con permiso', () => {
    const permisos = [{ numero: '26001EC01000001A', paisDestino: 212 }];
    expect(cuerpoExportacion({ ...base, permisos }).permisos).toEqual([]);
    expect(cuerpoExportacion({ ...base, tipoExportacion: 'BIENES', permisoExistente: 'N', incoterm: 'FOB', permisos }).permisos).toEqual([]);
    expect(cuerpoExportacion({ ...base, tipoExportacion: 'BIENES', permisoExistente: 'S', incoterm: 'FOB', permisos }).permisos).toEqual(permisos);
    expect(cuerpoExportacion(base).incoterm).toBeNull();
  });

  it('con exportación los renglones quedan exentos', () => {
    expect(exentoParaExportacion([{ articuloId: null, descripcion: 'x', cantidad: '1', precioUnitario: '1', alicuota: '21' }]).map((r) => r.alicuota)).toEqual(['EXENTO']);
  });
});
