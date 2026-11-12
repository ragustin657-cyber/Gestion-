import { ActionIcon, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/cliente';
import { formatoMoneda } from '../../compras/formato';
import { MESES } from '../../impuestos/comun';
import { errorConsulta, useOperacion } from '../../tesoreria/comun';
import { useEjercicios } from '../comun';

export interface TramoAnticuacion { anio: number; mes: number; importe: string }
export interface CuentaAnticuacion { cuentaContableId: string; codigo: string; nombre: string; saldoApertura: string; tramos: TramoAnticuacion[] }
interface Config { primerEjercicioId: string | null; asientoAperturaId: string | null; anticuacion: CuentaAnticuacion[] }
const CLAVE = ['/contabilidad/ajuste-inflacion/config'];

/** Tramo nuevo: el mes anterior al inicio del ejercicio, con lo que falta anticuar. */
export function tramoPorDefecto(desdeEjercicio: string, resto: number): TramoAnticuacion {
  const [anio, mes] = desdeEjercicio.slice(0, 7).split('-').map(Number);
  return mes === 1 ? { anio: anio - 1, mes: 12, importe: resto.toFixed(2) } : { anio, mes: mes - 1, importe: resto.toFixed(2) };
}

/** Tramos a enviar: sin importes vacíos ni en cero. */
export function tramosParaEnviar(cuentas: CuentaAnticuacion[]) {
  return cuentas.map((c) => ({ cuentaContableId: c.cuentaContableId, tramos: c.tramos.filter((t) => t.importe !== '' && Number(t.importe) !== 0).map((t) => ({ anio: t.anio, mes: t.mes, importe: Number(t.importe) })) }));
}

/** Tramos de anticuación por cuenta, con lo que falta anticuar a la vista. */
export function GrillaAnticuacion({ cuentas, onChange, desdeEjercicio }: { cuentas: CuentaAnticuacion[]; onChange: (c: CuentaAnticuacion[]) => void; desdeEjercicio?: string }) {
  const cambiar = (i: number, tramos: TramoAnticuacion[]) => onChange(cuentas.map((c, j) => (j === i ? { ...c, tramos } : c)));
  return (
    <Stack gap="sm">
      {cuentas.map((c, i) => {
        const resto = Number(c.saldoApertura) - c.tramos.reduce((s, t) => s + Number(t.importe || 0), 0);
        return (
          <Paper key={c.cuentaContableId} withBorder p="sm">
            <Group justify="space-between">
              <Text fw={600}>{c.codigo} {c.nombre}</Text>
              <Text size="sm">Saldo de apertura: {formatoMoneda(c.saldoApertura)}</Text>
            </Group>
            {c.tramos.map((t, k) => (
              <Group key={k} gap="xs" mt="xs" align="flex-end">
                <Select label="Mes de origen" w={140} allowDeselect={false} data={MESES} value={String(t.mes).padStart(2, '0')}
                  onChange={(v) => cambiar(i, c.tramos.map((x, j) => (j === k ? { ...x, mes: Number(v) } : x)))} />
                <TextInput label="Año" w={80} value={String(t.anio)} onChange={(e) => cambiar(i, c.tramos.map((x, j) => (j === k ? { ...x, anio: Number(e.currentTarget.value) } : x)))} />
                <NumberInput label="Importe" w={160} decimalScale={2} decimalSeparator="," thousandSeparator="." value={t.importe}
                  onChange={(v) => cambiar(i, c.tramos.map((x, j) => (j === k ? { ...x, importe: String(v) } : x)))} />
                <ActionIcon variant="subtle" color="red" aria-label="Quitar tramo" onClick={() => cambiar(i, c.tramos.filter((_, j) => j !== k))}><IconTrash size={14} /></ActionIcon>
              </Group>
            ))}
            <Group justify="space-between" mt="xs">
              <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />}
                onClick={() => cambiar(i, [...c.tramos, desdeEjercicio ? tramoPorDefecto(desdeEjercicio, resto) : { anio: new Date().getFullYear() - 1, mes: 12, importe: resto.toFixed(2) }])}>Agregar tramo</Button>
              <Text size="sm" c={Math.abs(resto) > 0.004 ? 'orange' : 'dimmed'}>Sin anticuar: {formatoMoneda(resto)}</Text>
            </Group>
          </Paper>
        );
      })}
      {!cuentas.length && <Text size="sm" c="dimmed">No hay cuentas no monetarias con saldo de apertura en el primer ejercicio.</Text>}
    </Stack>
  );
}

export function ConfigAjustePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CLAVE, queryFn: () => api<Config>('/contabilidad/ajuste-inflacion/config') });
  const ejercicios = useEjercicios().data ?? [];
  const op = useOperacion();
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  const [asientoId, setAsientoId] = useState<string | null>(null);
  const [cuentas, setCuentas] = useState<CuentaAnticuacion[]>([]);
  useEffect(() => {
    if (!q.data) return;
    setEjercicioId(q.data.primerEjercicioId);
    setAsientoId(q.data.asientoAperturaId);
    setCuentas(q.data.anticuacion);
  }, [q.data]);
  const ej = ejercicios.find((e) => e.id === ejercicioId);
  const desde = ej?.desde.slice(0, 10);
  const asientos = useQuery({
    queryKey: ['/contabilidad/diario', 'apertura', desde],
    queryFn: () => api<{ items: { id: string; numero: number; descripcion: string }[] }>('/contabilidad/diario', { query: { desde, hasta: desde, porPagina: 50 } }),
    enabled: !!desde,
  }).data?.items ?? [];
  const guardar = async () => {
    const r = await op.ejecutar(() => api('/contabilidad/ajuste-inflacion/config', {
      metodo: 'PUT',
      body: {
        primerEjercicioId: ejercicioId, asientoAperturaId: asientoId,
        anticuacion: tramosParaEnviar(cuentas),
      },
    }), () => 'Configuración guardada');
    if (r) void qc.invalidateQueries({ queryKey: CLAVE });
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Configuración del ajuste por inflación</Title>
      {errorConsulta(q.error)}
      <Group align="flex-end" mb="md">
        <Select label="Primer ejercicio ajustado" w={260} data={ejercicios.map((e) => ({ value: e.id, label: `Ejercicio ${e.numero} (${e.desde.slice(0, 4)})` }))} value={ejercicioId}
          onChange={(v) => { setEjercicioId(v); if (v !== q.data?.primerEjercicioId) { setCuentas([]); setAsientoId(null); } else if (q.data) { setCuentas(q.data.anticuacion); setAsientoId(q.data.asientoAperturaId); } }} />
        <Select label="Asiento de apertura (opcional)" w={340} clearable placeholder="Asientos de apertura del sistema"
          data={asientos.map((a) => ({ value: a.id, label: `N° ${a.numero} — ${a.descripcion}` }))} value={asientoId} onChange={setAsientoId} />
      </Group>
      <Text size="sm" c="dimmed" mb="sm">Anticuación de la apertura: el mes en que se originó cada parte del saldo inicial (por ejemplo, la fecha de cada aporte de capital). Lo no anticuado se toma al inicio del ejercicio.</Text>
      {q.data?.primerEjercicioId && q.data.primerEjercicioId === ejercicioId
        ? <GrillaAnticuacion cuentas={cuentas} onChange={setCuentas} desdeEjercicio={desde} />
        : <Text size="sm" c="dimmed">Guarde el primer ejercicio para ver las cuentas a anticuar.</Text>}
      {op.alerta}
      <Group mt="md"><Button loading={op.enviando} disabled={!ejercicioId} onClick={() => void guardar()}>Guardar</Button></Group>
    </Paper>
  );
}
