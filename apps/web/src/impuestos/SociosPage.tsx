import { Badge } from '@mantine/core';
import { Maestro } from '../abm/Maestro';

interface SocioFila { id: string; nombre: string; tipoDocumento: string; documento: string; tipoTitular: string; porcentaje: string; activo: boolean }
export const TIPOS_TITULAR = [
  { value: 'PERSONA_HUMANA_PAIS', label: 'Persona humana del país' }, { value: 'PERSONA_HUMANA_EXTERIOR', label: 'Persona humana del exterior' },
  { value: 'SUCESION_INDIVISA', label: 'Sucesión indivisa' }, { value: 'SOCIEDAD_EXTERIOR', label: 'Sociedad del exterior' },
  { value: 'SOCIEDAD_PAIS', label: 'Sociedad del país (no paga)' },
];
export const NOMBRE_TITULAR: Record<string, string> = Object.fromEntries(TIPOS_TITULAR.map((t) => [t.value, t.label]));

/** Registro de socios (E47): titulares de las acciones y participaciones para Bienes Personales. */
export function SociosPage() {
  return (
    <Maestro<SocioFila> config={{
      titulo: 'Socios', ruta: '/impuestos/socios', permisoEditar: 'impuestos.presentar', valoresNuevos: { activo: true, tipoDocumento: 'CUIT', tipoTitular: 'PERSONA_HUMANA_PAIS' },
      campos: [
        { nombre: 'nombre', etiqueta: 'Nombre o razón social', tipo: 'texto', requerido: true },
        { nombre: 'tipoDocumento', etiqueta: 'Tipo de documento', tipo: 'select', requerido: true, opciones: ['CUIT', 'CUIL', 'DNI', 'Exterior'].map((x) => ({ value: x, label: x })) },
        { nombre: 'documento', etiqueta: 'Número de documento', tipo: 'texto', requerido: true },
        { nombre: 'tipoTitular', etiqueta: 'Tipo de titular', tipo: 'select', requerido: true, opciones: TIPOS_TITULAR },
        { nombre: 'porcentaje', etiqueta: 'Participación (%)', tipo: 'numero', requerido: true },
        { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
      ],
      columnas: [
        { campo: 'nombre', titulo: 'Socio' },
        { campo: 'documento', titulo: 'Documento', render: (r) => `${r.tipoDocumento} ${r.documento}` },
        { campo: 'tipoTitular', titulo: 'Tipo', render: (r) => NOMBRE_TITULAR[r.tipoTitular] },
        { campo: 'porcentaje', titulo: 'Participación', render: (r) => `${Number(r.porcentaje).toLocaleString('es-AR')} %` },
        { campo: 'activo', titulo: 'Estado', render: (r) => <Badge size="xs" variant="light" color={r.activo ? 'green' : 'gray'}>{r.activo ? 'Activo' : 'Inactivo'}</Badge> },
      ],
    }} />
  );
}
