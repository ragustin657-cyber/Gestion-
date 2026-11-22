import { Alert, Button, Group, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { JurisdiccionesCm } from './JurisdiccionesCm';

interface Config {
  arbaActividad: string; arbaSucursal: number; arbaPeriodicidad: string; agipCodigoNorma: string;
  ivaInicioAnio: number | null; ivaInicioMes: number | null; ivaSaldoTecnicoInicial: string | number; ivaSaldoLibreInicial: string | number;
  iibbInicioAnio: number | null; iibbInicioMes: number | null;
  prorrateoIva: boolean; prorrateoDesdeAnio: number | null; prorrateoDesdeMes: number | null; prorrateoInicioMes: number;
  prorrateoGravadasIniciales: string | number; prorrateoExentasIniciales: string | number;
  sireMotivoAnulacion: number;
  topeAutomovilesCosto: string | number;
  alicuotaBienesPersonalesAcciones: string | number;
}

type TramoForm = { desde: number | string; fijo: number | string; alicuota: number | string };
/** Escala de la ley 27.630 (2021): punto de partida; ARCA la actualiza cada año. */
const ESCALA_LEY: TramoForm[] = [{ desde: 0, fijo: 0, alicuota: 25 }, { desde: 5000000, fijo: 1250000, alicuota: 30 }, { desde: 50000000, fijo: 14750000, alicuota: 35 }];

/** Escala de Ganancias de sociedades por año (E46). */
export function EscalaSociedades() {
  const qc = useQueryClient();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ['/impuestos/escala-sociedades', anio], queryFn: () => api<{ desde: string; fijo: string; alicuota: string }[]>(`/impuestos/escala-sociedades/${anio}`) });
  const [tramos, setTramos] = useState<TramoForm[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { if (q.data) setTramos(q.data.map((t) => ({ desde: Number(t.desde), fijo: Number(t.fijo), alicuota: Number(t.alicuota) }))); }, [q.data]);
  const cambiar = (i: number, k: keyof TramoForm, v: number | string) => setTramos(tramos.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const guardar = async () => {
    setError('');
    // Revisión E46: un campo vacío no se guarda como 0
    if (tramos.some((t) => [t.desde, t.fijo, t.alicuota].some((v) => v === '' || v === null || Number.isNaN(Number(v))))) {
      setError('Complete todos los campos de la escala');
      return;
    }
    try {
      await api(`/impuestos/escala-sociedades/${anio}`, { metodo: 'PUT', body: { tramos: tramos.map((t) => ({ desde: Number(t.desde) || 0, fijo: Number(t.fijo) || 0, alicuota: Number(t.alicuota) || 0 })) } });
      notifications.show({ color: 'green', message: 'Escala guardada' });
      void qc.invalidateQueries({ queryKey: ['/impuestos/escala-sociedades'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  const num = { decimalScale: 2, thousandSeparator: '.', decimalSeparator: ',' } as const;
  return (
    <Stack maw={720}>
      <Title order={5}>Escala de Ganancias de sociedades (art. 73)</Title>
      <Group align="flex-end">
        <NumberInput label="Año de la escala" w={150} min={2018} max={2100} value={anio} onChange={(v) => setAnio(Number(v) || anio)} />
        <Button variant="light" size="xs" onClick={() => setTramos(ESCALA_LEY)}>Copiar escala de la ley 27.630</Button>
        <Button variant="subtle" size="xs" onClick={() => setTramos([...tramos, { desde: '', fijo: '', alicuota: '' }])}>Agregar tramo</Button>
      </Group>
      {tramos.map((t, i) => (
        <Group key={i} grow>
          <NumberInput label={`Desde (tramo ${i + 1})`} min={0} {...num} value={t.desde} onChange={(v) => cambiar(i, 'desde', v)} />
          <NumberInput label={`Monto fijo (tramo ${i + 1})`} min={0} {...num} value={t.fijo} onChange={(v) => cambiar(i, 'fijo', v)} />
          <NumberInput label={`Alícuota % (tramo ${i + 1})`} min={0} max={100} {...num} value={t.alicuota} onChange={(v) => cambiar(i, 'alicuota', v)} />
        </Group>
      ))}
      <Text size="xs" c="dimmed">Los montos se actualizan cada año por IPC: cargue los que publica ARCA para el año del inicio del ejercicio.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <Group><Button size="xs" onClick={() => void guardar()} disabled={!tramos.length}>Guardar escala</Button></Group>
    </Stack>
  );
}

export function ConfigImpuestosPage() {
  const q = useQuery({ queryKey: ['/impuestos/config'], queryFn: () => api<Config>('/impuestos/config') });
  const [c, setC] = useState<Config | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (q.data) setC(q.data); }, [q.data]);
  if (!c) return null;
  const guardar = async () => {
    setError('');
    try {
      await api('/impuestos/config', { metodo: 'PUT', body: { ...c, ivaSaldoTecnicoInicial: Number(c.ivaSaldoTecnicoInicial) || 0, ivaSaldoLibreInicial: Number(c.ivaSaldoLibreInicial) || 0, prorrateoGravadasIniciales: Number(c.prorrateoGravadasIniciales) || 0, prorrateoExentasIniciales: Number(c.prorrateoExentasIniciales) || 0, topeAutomovilesCosto: Number(c.topeAutomovilesCosto) || 0, alicuotaBienesPersonalesAcciones: Number(c.alicuotaBienesPersonalesAcciones) || 0 } });
      notifications.show({ color: 'green', message: 'Configuración guardada' });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Configuración de impuestos</Title>
      <Stack maw={520}>
        <Title order={5}>ARBA (A-122R)</Title>
        <Group>
          <TextInput label="Código de actividad" w={160} value={c.arbaActividad} onChange={(e) => setC({ ...c, arbaActividad: e.currentTarget.value })} />
          <NumberInput label="Sucursal" w={120} min={1} value={c.arbaSucursal} onChange={(v) => setC({ ...c, arbaSucursal: Number(v) || 1 })} />
          <Select label="Presentación" w={160} allowDeselect={false} data={[{ value: 'MENSUAL', label: 'Mensual' }, { value: 'QUINCENAL', label: 'Quincenal' }]} value={c.arbaPeriodicidad} onChange={(v) => setC({ ...c, arbaPeriodicidad: v ?? 'MENSUAL' })} />
        </Group>
        <Title order={5}>AGIP (e-ARCIBA)</Title>
        <TextInput label="Código de norma de retención" w={200} value={c.agipCodigoNorma} onChange={(e) => setC({ ...c, agipCodigoNorma: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">Valores por defecto a confirmar con el contador: actividad 6 de ARBA y norma 029 de AGIP.</Text>
        <Title order={5}>Posición de IVA</Title>
        <Group>
          <NumberInput label="Primer mes liquidado" w={160} min={1} max={12} value={c.ivaInicioMes ?? ''} onChange={(v) => setC({ ...c, ivaInicioMes: v === '' ? null : Number(v) })} />
          <NumberInput label="Año" w={110} min={2000} max={2100} value={c.ivaInicioAnio ?? ''} onChange={(v) => setC({ ...c, ivaInicioAnio: v === '' ? null : Number(v) })} />
        </Group>
        <Group>
          <NumberInput label="Saldo técnico a favor inicial" w={220} min={0} decimalScale={2} value={Number(c.ivaSaldoTecnicoInicial)} onChange={(v) => setC({ ...c, ivaSaldoTecnicoInicial: Number(v) || 0 })} />
          <NumberInput label="Saldo de libre disponibilidad inicial" w={240} min={0} decimalScale={2} value={Number(c.ivaSaldoLibreInicial)} onChange={(v) => setC({ ...c, ivaSaldoLibreInicial: Number(v) || 0 })} />
        </Group>
        <Text size="xs" c="dimmed">Los saldos a favor al comienzo del primer mes que se liquida en el sistema (los de la última DJ presentada fuera del sistema).</Text>
        <Title order={5}>Prorrateo del crédito fiscal de IVA</Title>
        <Switch label="Prorrateo del crédito fiscal (ventas gravadas y exentas)" checked={!!c.prorrateoIva} onChange={(e) => setC({ ...c, prorrateoIva: e.currentTarget.checked })} />
        {c.prorrateoIva && <>
          <Group>
            <NumberInput label="Primer mes con prorrateo" w={190} min={1} max={12} value={c.prorrateoDesdeMes ?? ''} onChange={(v) => setC({ ...c, prorrateoDesdeMes: v === '' ? null : Number(v) })} />
            <NumberInput label="Año del primer mes con prorrateo" w={230} min={2000} max={2100} value={c.prorrateoDesdeAnio ?? ''} onChange={(v) => setC({ ...c, prorrateoDesdeAnio: v === '' ? null : Number(v) })} />
            <NumberInput label="Primer mes del ejercicio fiscal" w={220} min={1} max={12} value={c.prorrateoInicioMes} onChange={(v) => setC({ ...c, prorrateoInicioMes: Number(v) || 1 })} />
          </Group>
          <Group>
            <NumberInput label="Ventas gravadas del ejercicio anteriores" w={260} decimalScale={2} value={Number(c.prorrateoGravadasIniciales)} onChange={(v) => setC({ ...c, prorrateoGravadasIniciales: Number(v) || 0 })} />
            <NumberInput label="Ventas exentas y no gravadas anteriores" w={260} decimalScale={2} value={Number(c.prorrateoExentasIniciales)} onChange={(v) => setC({ ...c, prorrateoExentasIniciales: Number(v) || 0 })} />
          </Group>
          <Text size="xs" c="dimmed">Las ventas del ejercicio fiscal anteriores al primer mes con prorrateo (si empieza a mitad del ejercicio). El coeficiente es el acumulado del ejercicio; en su último mes se ajusta con el coeficiente anual.</Text>
        </>}
        <Title order={5}>Liquidación de IIBB (Convenio Multilateral)</Title>
        <Group>
          <NumberInput label="Primer mes de IIBB" w={160} min={1} max={12} value={c.iibbInicioMes ?? ''} onChange={(v) => setC({ ...c, iibbInicioMes: v === '' ? null : Number(v) })} />
          <NumberInput label="Año de inicio de IIBB" w={170} min={2000} max={2100} value={c.iibbInicioAnio ?? ''} onChange={(v) => setC({ ...c, iibbInicioAnio: v === '' ? null : Number(v) })} />
        </Group>
        <Title order={5}>Amortización impositiva</Title>
        <NumberInput label="Tope de costo de automóviles" w={260} min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," value={Number(c.topeAutomovilesCosto)} onChange={(v) => setC({ ...c, topeAutomovilesCosto: Number(v) || 0 })} />
        <Text size="xs" c="dimmed">Art. 88 inc. l de Ganancias: la amortización de automóviles es deducible hasta la que correspondería a este costo. Verifique el tope vigente.</Text>
        <Title order={5}>Bienes Personales (acciones y participaciones)</Title>
        <NumberInput label="Tasa de Bienes Personales sobre acciones (%)" w={340} min={0} max={100} decimalScale={4} decimalSeparator="," value={Number(c.alicuotaBienesPersonalesAcciones)} onChange={(v) => setC({ ...c, alicuotaBienesPersonalesAcciones: Number(v) || 0 })} />
        <Title order={5}>SIRE</Title>
        <NumberInput label="Motivo de anulación (F.2005)" w={220} min={1} max={9} value={c.sireMotivoAnulacion} onChange={(v) => setC({ ...c, sireMotivoAnulacion: Number(v) || 1 })} />
        <Text size="xs" c="dimmed">Código de la tabla de motivos de anulación del SIRE con que se informan las retenciones de IVA anuladas. Verifíquelo con el contador.</Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group><Button onClick={() => void guardar()}>Guardar</Button></Group>
      </Stack>
      <Stack mt="xl"><EscalaSociedades /></Stack>
      <Stack mt="xl" maw={820}>
        <JurisdiccionesCm inicioAnio={q.data?.iibbInicioAnio ?? null} />
      </Stack>
    </Paper>
  );
}
