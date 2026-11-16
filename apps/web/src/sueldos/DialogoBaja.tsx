import { Badge, Button, Card, Checkbox, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { CAUSAS_EGRESO, CausaEgreso, Egreso } from './comun';

/** Fecha más n días ('AAAA-MM-DD'). */
const sumarDias = (f: string, n: number) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export interface DatosBaja { empleadoId: string; causa: CausaEgreso; fechaEgreso: string; preavisoOtorgado: boolean; fechaPago: string; gratificacion?: number; mejorRemuneracion?: number }

/** Datos del egreso: causa, fechas, preaviso (despido sin causa) y gratificación (mutuo acuerdo). */
export function DialogoBaja({ empleado, onConfirmar, causaInicial = 'DESPIDO_SIN_CAUSA', inicial, textoBoton = 'Dar de baja', enviando }: {
  empleado: { id: string; legajo: number; apellido: string; nombre: string }; onConfirmar: (d: DatosBaja) => void; causaInicial?: CausaEgreso;
  inicial?: Partial<DatosBaja>; textoBoton?: string; enviando?: boolean;
}) {
  const [d, setD] = useState<DatosBaja>({ empleadoId: empleado.id, causa: causaInicial, fechaEgreso: '', preavisoOtorgado: false, fechaPago: '', ...inicial });
  const enviar = () => {
    const { gratificacion, mejorRemuneracion, ...resto } = d;
    onConfirmar({ ...resto, preavisoOtorgado: d.causa === 'DESPIDO_SIN_CAUSA' && d.preavisoOtorgado, ...(d.causa === 'MUTUO_ACUERDO' && gratificacion ? { gratificacion } : {}), ...(mejorRemuneracion ? { mejorRemuneracion } : {}) });
  };
  return (
    <Stack>
      <Text size="sm">Legajo {empleado.legajo} · {empleado.apellido}, {empleado.nombre}</Text>
      <Select label="Causa" data={Object.entries(CAUSAS_EGRESO).map(([value, label]) => ({ value, label }))} value={d.causa} onChange={(v) => setD({ ...d, causa: (v ?? 'RENUNCIA') as CausaEgreso })} />
      <SimpleGrid cols={2}>
        <TextInput type="date" label="Fecha de egreso" value={d.fechaEgreso} onChange={(e) => { const f = e.currentTarget.value; setD({ ...d, fechaEgreso: f, fechaPago: f ? sumarDias(f, 4) : d.fechaPago }); }} />
        <TextInput type="date" label="Fecha de pago" value={d.fechaPago} onChange={(e) => setD({ ...d, fechaPago: e.currentTarget.value })} />
      </SimpleGrid>
      {d.causa === 'DESPIDO_SIN_CAUSA' && <Checkbox label="Preaviso otorgado" checked={d.preavisoOtorgado} onChange={(e) => setD({ ...d, preavisoOtorgado: e.currentTarget.checked })} />}
      {d.causa === 'MUTUO_ACUERDO' && <NumberInput label="Gratificación" min={0} decimalSeparator="," thousandSeparator="." decimalScale={2} value={d.gratificacion ?? ''} onChange={(v) => setD({ ...d, gratificacion: Number(v) || 0 })} />}
      <NumberInput label="Mejor remuneración (opcional, reemplaza la calculada)" min={0} decimalSeparator="," thousandSeparator="." decimalScale={2} value={d.mejorRemuneracion ?? ''} onChange={(v) => setD({ ...d, mejorRemuneracion: Number(v) || undefined })} />
      <Group justify="flex-end"><Button color="red" onClick={enviar} disabled={!d.fechaEgreso || !d.fechaPago} loading={enviando}>{textoBoton}</Button></Group>
    </Stack>
  );
}

/** Resumen del egreso en la liquidación final. */
export function TarjetaEgreso({ egreso, onEditar }: { egreso: Egreso; onEditar?: () => void }) {
  return (
    <Card withBorder padding="sm" mb="md">
      <Group justify="space-between">
        <Group gap="lg">
          <div><Text size="xs" c="dimmed">Causa</Text><Text fw={600}>{CAUSAS_EGRESO[egreso.causa]}</Text></div>
          <div><Text size="xs" c="dimmed">Egreso</Text><Text fw={600}>{formatoFecha(egreso.fechaEgreso)}</Text></div>
          {egreso.causa === 'DESPIDO_SIN_CAUSA' && <Badge variant="light" color={egreso.preavisoOtorgado ? 'green' : 'orange'}>{egreso.preavisoOtorgado ? 'Con preaviso' : 'Sin preaviso'}</Badge>}
          {Number(egreso.gratificacion) > 0 && <div><Text size="xs" c="dimmed">Gratificación</Text><Text fw={600}>{formatoMoneda(egreso.gratificacion)}</Text></div>}
          {egreso.mejorRemuneracion && <div><Text size="xs" c="dimmed">Mejor remuneración (manual)</Text><Text fw={600}>{formatoMoneda(egreso.mejorRemuneracion)}</Text></div>}
        </Group>
        {onEditar && <Button size="xs" variant="light" onClick={onEditar}>Editar egreso</Button>}
      </Group>
    </Card>
  );
}
