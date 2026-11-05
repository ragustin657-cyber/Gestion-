import { Maestro } from '../abm/Maestro';

interface Cotizacion { id: string; monedaCodigo: string; fecha: string; valor: string }
const fecha = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const hoy = () => new Date().toISOString().slice(0, 10);

export function MonedasPage() {
  return (
    <Maestro<Cotizacion>
      config={{
        titulo: 'Cotizaciones del dólar',
        ruta: '/cotizaciones',
        soloAlta: true,
        permisoEditar: 'moneda.editar',
        valoresNuevos: { monedaCodigo: 'USD', fecha: hoy() },
        campos: [
          { nombre: 'monedaCodigo', etiqueta: 'Moneda', tipo: 'select', requerido: true, opciones: [{ value: 'USD', label: 'USD - Dólar' }] },
          { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', requerido: true },
          { nombre: 'valor', etiqueta: 'Cotización (pesos por dólar)', tipo: 'numero', requerido: true },
        ],
        columnas: [
          { campo: 'fecha', titulo: 'Fecha', render: (c) => fecha(c.fecha) },
          { campo: 'monedaCodigo', titulo: 'Moneda' },
          { campo: 'valor', titulo: 'Cotización', render: (c) => `$ ${Number(c.valor).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
        ],
      }}
    />
  );
}
