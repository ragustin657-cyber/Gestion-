import { Divider, Loader, Paper, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CondicionIva, ETIQUETAS_CONDICION_IVA, formatearCuit, validarCuit } from '@gestion/shared';
import { api } from '../api/cliente';
import { FormAbm } from '../abm/FormAbm';
import { Maestro } from '../abm/Maestro';
import { CampoAbm } from '../abm/tipos';

interface Empresa { [k: string]: unknown; cuit: string }
interface PuntoVenta { id: string; numero: number; descripcion: string | null }

const JURISDICCIONES = [
  ['901', 'CABA'], ['902', 'Buenos Aires'], ['903', 'Catamarca'], ['904', 'Córdoba'], ['905', 'Corrientes'], ['906', 'Chaco'],
  ['907', 'Chubut'], ['908', 'Entre Ríos'], ['909', 'Formosa'], ['910', 'Jujuy'], ['911', 'La Pampa'], ['912', 'La Rioja'],
  ['913', 'Mendoza'], ['914', 'Misiones'], ['915', 'Neuquén'], ['916', 'Río Negro'], ['917', 'Salta'], ['918', 'San Juan'],
  ['919', 'San Luis'], ['920', 'Santa Cruz'], ['921', 'Santa Fe'], ['922', 'Santiago del Estero'], ['923', 'Tierra del Fuego'], ['924', 'Tucumán'],
].map(([value, nombre]) => ({ value, label: `${value} - ${nombre}` }));

const CAMPOS: CampoAbm[] = [
  { nombre: 'razonSocial', etiqueta: 'Razón social', tipo: 'texto', requerido: true },
  { nombre: 'cuit', etiqueta: 'CUIT', tipo: 'texto', requerido: true, validar: (v) => (validarCuit(String(v)) ? null : 'CUIT inválido') },
  { nombre: 'condicionIva', etiqueta: 'Condición frente al IVA', tipo: 'select', requerido: true, opciones: Object.values(CondicionIva).map((c) => ({ value: c, label: ETIQUETAS_CONDICION_IVA[c] })) },
  { nombre: 'inicioEjercicioMes', etiqueta: 'Mes de inicio del ejercicio', tipo: 'numero' },
  { nombre: 'domicilio', etiqueta: 'Domicilio', tipo: 'texto', ancho: true },
  { nombre: 'agenteRetencionGanancias', etiqueta: 'Agente de retención de Ganancias', tipo: 'booleano' },
  { nombre: 'agenteRetencionIva', etiqueta: 'Agente de retención de IVA', tipo: 'booleano' },
  { nombre: 'agenteRetencionSuss', etiqueta: 'Agente de retención de SUSS', tipo: 'booleano' },
  { nombre: 'jurisdiccionesIibb', etiqueta: 'Agente de IIBB en jurisdicciones', tipo: 'multiselect', opciones: JURISDICCIONES, ancho: true },
];

export function EmpresaPage() {
  const qc = useQueryClient();
  const empresa = useQuery({ queryKey: ['/empresas/actual'], queryFn: () => api<Empresa>('/empresas/actual') });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Datos de la empresa</Title>
      {empresa.isLoading || !empresa.data ? <Loader size="sm" /> : (
        <FormAbm
          campos={CAMPOS}
          valoresIniciales={{ ...Object.fromEntries(CAMPOS.map((c) => [c.nombre, empresa.data[c.nombre] ?? ''])), cuit: formatearCuit(empresa.data.cuit) }}
          onEnviar={(v) => api('/empresas/actual', { metodo: 'PATCH', body: v })}
          onExito={() => {
            notifications.show({ color: 'green', message: 'Datos de la empresa guardados' });
            void qc.invalidateQueries({ queryKey: ['/empresas/actual'] });
          }}
        />
      )}
      <Divider my="lg" />
      <Title order={4} mb="sm">Puntos de venta</Title>
      <Maestro<PuntoVenta> sinMarco config={{
        titulo: 'Punto de venta', ruta: '/empresas/actual/puntos-venta', soloAlta: true, permisoEditar: 'empresa.administrar',
        campos: [
          { nombre: 'numero', etiqueta: 'Número', tipo: 'numero', requerido: true },
          { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'texto' },
        ],
        columnas: [
          { campo: 'numero', titulo: 'Número', render: (p) => String(p.numero).padStart(4, '0') },
          { campo: 'descripcion', titulo: 'Descripción' },
        ],
      }} />
    </Paper>
  );
}
