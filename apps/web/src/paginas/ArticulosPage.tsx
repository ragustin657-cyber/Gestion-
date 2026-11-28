import { ALICUOTAS_IVA, UNIDADES_ARBA } from '@gestion/shared';
import { Button, Modal, Select } from '@mantine/core';
import { useState } from 'react';
import { EditorEscalas } from '../articulos/EditorEscalas';
import { useRubrosArticulos } from '../articulos/RubrosArticulosPage';
import { useAuth } from '../auth/AuthContext';
import { estado, Maestro, siNo } from '../abm/Maestro';
import { useCuentasImputables } from '../abm/opciones';
import { formatoMoneda } from '../compras/formato';

interface Articulo { id: string; codigo: string; descripcion: string; unidad: string; alicuotaIva: string; esServicio: boolean; activo: boolean; controlaStock: boolean; stockCantidad: string; costoPromedio: string; rubroId: string | null; rubro: string | null; rubroActivo?: boolean | null }

export function ArticulosPage() {
  const cuentas = useCuentasImputables();
  const { puede } = useAuth();
  const rubros = useRubrosArticulos();
  const [rubroId, setRubroId] = useState<string | null>(null);
  const [escalas, setEscalas] = useState<Articulo | null>(null);
  const alicuotas = ALICUOTAS_IVA.map((a) => ({ value: String(a), label: `${String(a).replace('.', ',')} %` }));
  const campos = [
    { nombre: 'codigo', etiqueta: 'Código', tipo: 'texto' as const, requerido: true },
    { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'texto' as const, requerido: true },
    { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'texto' as const, requerido: true },
    { nombre: 'alicuotaIva', etiqueta: 'Alícuota IVA', tipo: 'select' as const, requerido: true, numerico: true, opciones: alicuotas },
    { nombre: 'rubroId', etiqueta: 'Rubro', tipo: 'select' as const, opciones: rubros.map((r) => ({ value: r.id, label: r.nombre })) },
    { nombre: 'cuentaCompraId', etiqueta: 'Cuenta contable de compra', tipo: 'select' as const, opciones: cuentas },
    { nombre: 'cuentaVentaId', etiqueta: 'Cuenta contable de venta', tipo: 'select' as const, opciones: cuentas },
    { nombre: 'esServicio', etiqueta: 'Es un servicio', tipo: 'booleano' as const },
    { nombre: 'controlaStock', etiqueta: 'Controla stock', tipo: 'booleano' as const, ayuda: 'Las compras van a Mercaderías y las ventas descuentan stock y registran su costo' },
    // E57: COT de ARBA
    { nombre: 'codigoNomencladorArba', etiqueta: 'Código del nomenclador (COT de ARBA)', tipo: 'texto' as const, ayuda: '6 dígitos' },
    { nombre: 'unidadMedidaArba', etiqueta: 'Unidad de medida (COT de ARBA)', tipo: 'select' as const, opciones: Object.entries(UNIDADES_ARBA).map(([value, label]) => ({ value, label: `${value} - ${label}` })) },
    { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' as const },
  ];
  return (
    <>
    <Maestro<Articulo>
      config={{
        titulo: 'Artículos',
        ruta: '/articulos',
        paginado: true,
        permisoEditar: 'articulo.editar',
        valoresNuevos: { unidad: 'UN', alicuotaIva: '21', activo: true },
        campos,
        filtros: { rubroId: rubroId ?? undefined },
        encabezado: <Select label="Rubro" w={240} mb="sm" clearable placeholder="Todos" data={rubros.map((r) => ({ value: r.id, label: r.nombre }))} value={rubroId} onChange={setRubroId} />,
        columnas: [
          { campo: 'codigo', titulo: 'Código' },
          { campo: 'descripcion', titulo: 'Descripción' },
          { campo: 'rubro', titulo: 'Rubro', render: (a) => a.rubro ?? '—' },
          { campo: 'unidad', titulo: 'Unidad' },
          { campo: 'alicuotaIva', titulo: 'IVA', render: (a) => `${Number(a.alicuotaIva).toLocaleString('es-AR')} %` },
          { campo: 'esServicio', titulo: 'Servicio', render: (a) => siNo(a.esServicio) },
          { campo: 'stockCantidad', titulo: 'Stock', render: (a) => (a.controlaStock ? Number(a.stockCantidad).toLocaleString('es-AR') : '—') },
          { campo: 'costoPromedio', titulo: 'Costo promedio', render: (a) => (a.controlaStock ? formatoMoneda(a.costoPromedio) : '—') },
          { campo: 'activo', titulo: 'Estado', render: (a) => estado(a.activo) },
          ...(puede('articulo.editar') ? [{ campo: 'id' as const, titulo: 'Descuentos', render: (a: Articulo) => <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); setEscalas(a); }}>{`Escalas de ${a.codigo}`}</Button> }] : []),
        ],
      }}
    />
    <Modal opened={!!escalas} onClose={() => setEscalas(null)} title={`Descuentos por cantidad de ${escalas?.codigo ?? ''}`}>
      {escalas && <EditorEscalas url={`/articulos/${escalas.id}/escalas`} aviso={escalas.rubro ? (escalas.rubroActivo === false ? `El rubro ${escalas.rubro} está inactivo: no aporta escalas` : `Sin escalas propias: usa las del rubro ${escalas.rubro}`) : null} />}
    </Modal>
    </>
  );
}
