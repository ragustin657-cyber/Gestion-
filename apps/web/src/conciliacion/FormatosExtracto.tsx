import { Alert, Group, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { FormAbm } from '../abm/FormAbm';
import { CampoAbm } from '../abm/tipos';
import { opcionesCuentas, useCuentasBancarias } from '../tesoreria/comun';

type Formato = Record<string, unknown> & { cuentaBancariaId?: string; nombre?: string };
const CAMPOS: CampoAbm[] = [
  { nombre: 'tipoArchivo', etiqueta: 'Tipo de archivo', tipo: 'select', requerido: true, opciones: [{ value: 'CSV', label: 'CSV / texto' }, { value: 'XLSX', label: 'Excel (.xlsx)' }] },
  { nombre: 'separador', etiqueta: 'Separador (CSV)', tipo: 'select', opciones: [{ value: ';', label: 'Punto y coma (;)' }, { value: ',', label: 'Coma (,)' }] },
  { nombre: 'hoja', etiqueta: 'Hoja (Excel: número o nombre)', tipo: 'texto' },
  { nombre: 'filaInicio', etiqueta: 'Primera fila de datos', tipo: 'numero', requerido: true },
  { nombre: 'formatoFecha', etiqueta: 'Formato de fecha', tipo: 'select', requerido: true, opciones: ['DD/MM/AAAA', 'DD-MM-AAAA', 'AAAA-MM-DD'].map((v) => ({ value: v, label: v })) },
  { nombre: 'separadorDecimal', etiqueta: 'Separador decimal', tipo: 'select', requerido: true, opciones: [{ value: ',', label: 'Coma (1.234,56)' }, { value: '.', label: 'Punto (1,234.56)' }] },
  { nombre: 'columnaFecha', etiqueta: 'Columna de fecha', tipo: 'texto', requerido: true, ayuda: 'Número (1, 2…) o letra (A, B…)' },
  { nombre: 'columnaConcepto', etiqueta: 'Columna de concepto', tipo: 'texto', requerido: true },
  { nombre: 'columnaReferencia', etiqueta: 'Columna de referencia', tipo: 'texto' },
  { nombre: 'columnaSaldo', etiqueta: 'Columna de saldo', tipo: 'texto' },
  { nombre: 'modoImporte', etiqueta: 'Importe', tipo: 'select', requerido: true, opciones: [{ value: 'IMPORTE_CON_SIGNO', label: 'Una columna con signo' }, { value: 'DEBITO_CREDITO', label: 'Columnas de débito y crédito' }] },
  { nombre: 'columnaImporte', etiqueta: 'Columna de importe', tipo: 'texto' },
  { nombre: 'columnaDebito', etiqueta: 'Columna de débitos', tipo: 'texto' },
  { nombre: 'columnaCredito', etiqueta: 'Columna de créditos', tipo: 'texto' },
];

/** Pestaña de Maestros › Bancos y cajas: formato del extracto de cada cuenta bancaria. */
export function FormatosExtracto() {
  const qc = useQueryClient();
  const cuentas = useCuentasBancarias();
  const formatos = useQuery({ queryKey: ['/conciliacion/formatos'], queryFn: () => api<Formato[]>('/conciliacion/formatos') });
  const modelos = useQuery({ queryKey: ['/conciliacion/formatos/modelos'], queryFn: () => api<Record<string, Formato>>('/conciliacion/formatos/modelos') });
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [modelo, setModelo] = useState<string | null>(null);
  const actual = formatos.data?.find((f) => f.cuentaBancariaId === cuentaId);
  const base = modelo ? modelos.data?.[modelo] : actual;
  const valores = Object.fromEntries(CAMPOS.map((c) => [c.nombre, base?.[c.nombre] ?? (c.nombre === 'filaInicio' ? 2 : '')]));
  return (
    <Stack>
      <Alert color="yellow">Los modelos precargados son una estimación del archivo de cada banco: verifíquelos importando un extracto real y revisando la vista previa.</Alert>
      <Group align="flex-end">
        <Select label="Cuenta bancaria" w={340} data={opcionesCuentas(cuentas)} value={cuentaId} onChange={(v) => { setCuentaId(v); setModelo(null); }} />
        <Select label="Partir de un modelo" w={300} clearable value={modelo} onChange={setModelo}
          data={Object.entries(modelos.data ?? {}).map(([k, m]) => ({ value: k, label: String(m.nombre) }))} />
      </Group>
      {cuentaId && <Text size="sm" c="dimmed">{actual ? 'La cuenta ya tiene formato: al guardar se reemplaza.' : 'La cuenta todavía no tiene formato.'}</Text>}
      {cuentaId && (
        <FormAbm key={`${cuentaId}-${modelo ?? 'actual'}`} campos={CAMPOS} valoresIniciales={valores}
          onEnviar={(v) => api(`/conciliacion/formatos/${cuentaId}`, { metodo: 'PUT', body: v })}
          onExito={() => { notifications.show({ color: 'green', message: 'Formato guardado' }); void qc.invalidateQueries({ queryKey: ['/conciliacion/formatos'] }); setModelo(null); }} />
      )}
    </Stack>
  );
}
