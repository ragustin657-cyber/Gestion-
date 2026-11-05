import { ALICUOTAS_IVA } from '@gestion/shared';
import { estado, Maestro, siNo } from '../abm/Maestro';
import { useCuentasImputables } from '../abm/opciones';

interface Articulo { id: string; codigo: string; descripcion: string; unidad: string; alicuotaIva: string; esServicio: boolean; activo: boolean }

export function ArticulosPage() {
  const cuentas = useCuentasImputables();
  const alicuotas = ALICUOTAS_IVA.map((a) => ({ value: String(a), label: `${String(a).replace('.', ',')} %` }));
  const campos = [
    { nombre: 'codigo', etiqueta: 'Código', tipo: 'texto' as const, requerido: true },
    { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'texto' as const, requerido: true },
    { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'texto' as const, requerido: true },
    { nombre: 'alicuotaIva', etiqueta: 'Alícuota IVA', tipo: 'select' as const, requerido: true, numerico: true, opciones: alicuotas },
    { nombre: 'cuentaCompraId', etiqueta: 'Cuenta contable de compra', tipo: 'select' as const, opciones: cuentas },
    { nombre: 'cuentaVentaId', etiqueta: 'Cuenta contable de venta', tipo: 'select' as const, opciones: cuentas },
    { nombre: 'esServicio', etiqueta: 'Es un servicio', tipo: 'booleano' as const },
    { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' as const },
  ];
  return (
    <Maestro<Articulo>
      config={{
        titulo: 'Artículos',
        ruta: '/articulos',
        paginado: true,
        permisoEditar: 'articulo.editar',
        valoresNuevos: { unidad: 'UN', alicuotaIva: '21', activo: true },
        campos,
        columnas: [
          { campo: 'codigo', titulo: 'Código' },
          { campo: 'descripcion', titulo: 'Descripción' },
          { campo: 'unidad', titulo: 'Unidad' },
          { campo: 'alicuotaIva', titulo: 'IVA', render: (a) => `${Number(a.alicuotaIva).toLocaleString('es-AR')} %` },
          { campo: 'esServicio', titulo: 'Servicio', render: (a) => siNo(a.esServicio) },
          { campo: 'activo', titulo: 'Estado', render: (a) => estado(a.activo) },
        ],
      }}
    />
  );
}
