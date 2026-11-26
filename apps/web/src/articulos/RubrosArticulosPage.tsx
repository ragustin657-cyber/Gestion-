import { Button, Modal } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { estado, Maestro } from '../abm/Maestro';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { EditorEscalas } from './EditorEscalas';

export interface RubroArticulo { id: string; nombre: string; activo: boolean }

/** Rubros activos para elegir en los artículos (E56). */
export const useRubrosArticulos = () =>
  useQuery({ queryKey: ['/rubros-articulos', { activos: '1' }], queryFn: () => api<RubroArticulo[]>('/rubros-articulos', { query: { activos: '1' } }) }).data ?? [];

/** E56: rubros de artículos, con sus escalas de descuento por cantidad. */
export function RubrosArticulosPage() {
  const { puede } = useAuth();
  const [escalas, setEscalas] = useState<RubroArticulo | null>(null);
  return (
    <>
      <Maestro<RubroArticulo>
        config={{
          titulo: 'Rubros de artículos',
          ruta: '/rubros-articulos',
          permisoEditar: 'articulo.editar',
          valoresNuevos: { activo: true },
          campos: [
            { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
            { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
          ],
          columnas: [
            { campo: 'nombre', titulo: 'Nombre' },
            { campo: 'activo', titulo: 'Estado', render: (r) => estado(r.activo) },
            { campo: 'id', titulo: 'Descuentos por cantidad', render: (r) => <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); setEscalas(r); }}>{`Escalas de ${r.nombre}`}</Button> },
          ],
        }}
      />
      <Modal opened={!!escalas} onClose={() => setEscalas(null)} title={`Descuentos por cantidad de ${escalas?.nombre ?? ''}`}>
        {escalas && (puede('articulo.editar') ? <EditorEscalas url={`/rubros-articulos/${escalas.id}/escalas`} /> : null)}
      </Modal>
    </>
  );
}
