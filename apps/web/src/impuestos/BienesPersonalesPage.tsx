import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { NOMBRE_TITULAR } from './SociosPage';

interface Fila { socioId: string; nombre: string; documento: string; tipoTitular: string; porcentaje: string; paga: boolean; vpp: string; impuesto: string }
export interface LiquidacionBp {
  anio: number; estado: 'BORRADOR' | 'PRESENTADA'; ejercicio: { numero: number; desde: string; hasta: string; estado: string }; ajuste: { importe: string; concepto: string | null };
  liquidacion: { patrimonio: string; ajuste: string; base: string; alicuota: string; filas: Fila[]; sumaParticipaciones: string; total: string; completo: boolean; avisos: string[] };
  presentaciones: { numero: number; presentadaEn: string; presentadaPor: string; anuladaEn: string | null; motivoAnulacion: string | null }[];
}

/** Liquidación del año (E47): patrimonio del balance, ajuste, participaciones del año, impuesto por socio y presentación. */
export function PanelBp({ datos, puedeEditar, alCambiar }: { datos: LiquidacionBp; puedeEditar: boolean; alCambiar: () => void }) {
  const op = useOperacion();
  const l = datos.liquidacion;
  const editable = puedeEditar && datos.estado === 'BORRADOR';
  const [ajuste, setAjuste] = useState<{ importe: number | string; concepto: string }>({ importe: Number(datos.ajuste.importe), concepto: datos.ajuste.concepto ?? '' });
  const [porcentajes, setPorcentajes] = useState<Record<string, number | string>>(() => Object.fromEntries(l.filas.map((f) => [f.socioId, Number(f.porcentaje)])));
  const [motivo, setMotivo] = useState<string | null>(null);
  const ejecutar = async (f: () => Promise<unknown>, msj: string) => { if (await op.ejecutar(f, () => msj)) { alCambiar(); return true; } return false; };
  const body = { anio: datos.anio };
  return (
    <Stack>
      {l.avisos.map((a) => <Alert key={a} color="orange">{a}</Alert>)}
      {op.alerta}
      <Group>
        <Badge color={datos.estado === 'PRESENTADA' ? 'green' : 'gray'}>{datos.estado === 'PRESENTADA' ? 'Presentada' : 'Borrador'}</Badge>
        {datos.ejercicio.estado !== 'CERRADO' && <Badge color="yellow" variant="light">Vista previa: el ejercicio está abierto</Badge>}
        {puedeEditar && datos.estado === 'BORRADOR' && <Button size="xs" onClick={() => void ejecutar(() => api('/impuestos/bienes-personales/presentar', { metodo: 'POST', body }), 'Liquidación marcada como presentada')}>Marcar como presentada</Button>}
        {puedeEditar && datos.estado === 'PRESENTADA' && <Button size="xs" color="red" variant="light" onClick={() => setMotivo('')}>Anular presentación</Button>}
      </Group>
      <Text size="sm">{`Balance del ejercicio ${datos.ejercicio.numero} al ${datos.ejercicio.hasta.split('-').reverse().join('/')} · patrimonio neto ${formatoMoneda(l.patrimonio)} · ajuste ${formatoMoneda(l.ajuste)} · base ${formatoMoneda(l.base)} · alícuota ${Number(l.alicuota).toLocaleString('es-AR')} %`}</Text>
      {editable && <Group align="flex-end">
        <NumberInput label="Ajuste del patrimonio (con signo)" w={220} decimalScale={2} thousandSeparator="." decimalSeparator="," value={ajuste.importe} onChange={(v) => setAjuste({ ...ajuste, importe: v })} />
        <TextInput label="Concepto del ajuste" w={280} value={ajuste.concepto} onChange={(e) => setAjuste({ ...ajuste, concepto: e.currentTarget.value })} />
        <Button size="xs" variant="light" onClick={() => void ejecutar(() => api('/impuestos/bienes-personales/ajuste', { metodo: 'PUT', body: { ...body, importe: Number(ajuste.importe) || 0, concepto: ajuste.concepto || null } }), 'Ajuste guardado')}>Guardar ajuste</Button>
      </Group>}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Socio</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Participación %</Table.Th><Table.Th ta="right">Valor patrimonial proporcional</Table.Th><Table.Th ta="right">Impuesto</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {l.filas.map((f) => (
            <Table.Tr key={f.socioId}>
              <Table.Td>{f.nombre} <Text span size="xs" c="dimmed">{f.documento}</Text></Table.Td><Table.Td>{NOMBRE_TITULAR[f.tipoTitular] ?? f.tipoTitular}</Table.Td>
              <Table.Td ta="right">{editable
                ? <NumberInput size="xs" w={110} ml="auto" aria-label={`Participación de ${f.nombre}`} min={0} max={100} decimalScale={4} decimalSeparator="," value={porcentajes[f.socioId]} onChange={(v) => setPorcentajes({ ...porcentajes, [f.socioId]: v })} />
                : Number(f.porcentaje).toLocaleString('es-AR')}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.vpp)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.impuesto)}</Table.Td>
            </Table.Tr>
          ))}
          {!l.filas.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center">Sin socios: cárguelos en Impuestos › Socios y vuelva a copiar del registro.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
        <Table.Tfoot><Table.Tr><Table.Th colSpan={2}>Total</Table.Th><Table.Th ta="right">{`${Number(l.sumaParticipaciones).toLocaleString('es-AR')} %`}</Table.Th><Table.Th /><Table.Th ta="right">{formatoMoneda(l.total)}</Table.Th></Table.Tr></Table.Tfoot>
      </Table>
      {editable && <Group>
        <Button size="xs" variant="light" onClick={() => void ejecutar(() => api('/impuestos/bienes-personales/participaciones', { metodo: 'PUT', body: { ...body, participaciones: l.filas.map((f) => ({ socioId: f.socioId, tipoTitular: f.tipoTitular, porcentaje: Number(porcentajes[f.socioId]) || 0 })) } }), 'Participaciones guardadas')}>Guardar participaciones</Button>
        <Button size="xs" variant="subtle" onClick={() => void ejecutar(() => api('/impuestos/bienes-personales/copiar-socios', { metodo: 'POST', body }), 'Participaciones copiadas del registro')}>Volver a copiar del registro</Button>
      </Group>}
      <Text size="sm" fw={600}>{`Total a ingresar: ${formatoMoneda(l.total)} (vence en junio de ${datos.anio + 1}, a verificar)`}</Text>
      {!!datos.presentaciones.length && <Table withTableBorder>
        <Table.Tbody>{datos.presentaciones.map((p) => (
          <Table.Tr key={p.numero}><Table.Td>{p.numero === 0 ? 'Original' : `Rectificativa ${p.numero}`}</Table.Td><Table.Td>{new Date(p.presentadaEn).toLocaleString('es-AR')}</Table.Td>
            <Table.Td>{p.anuladaEn ? `Anulada: ${p.motivoAnulacion ?? ''}` : 'Vigente'}</Table.Td></Table.Tr>
        ))}</Table.Tbody>
      </Table>}
      <Modal opened={motivo !== null} onClose={() => setMotivo(null)} title="Anular presentación">
        <Stack>
          <TextInput label="Motivo" value={motivo ?? ''} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <Group><Button color="red" onClick={() => void ejecutar(() => api('/impuestos/bienes-personales/anular', { metodo: 'POST', body: { ...body, motivo } }), 'Presentación anulada').then((ok) => ok && setMotivo(null))}>Anular</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function BienesPersonalesPage() {
  const qc = useQueryClient();
  const { puede } = useAuth();
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const q = useQuery({ queryKey: ['/impuestos/bienes-personales', anio], queryFn: () => api<LiquidacionBp>('/impuestos/bienes-personales', { query: { anio: String(anio) } }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Bienes Personales: acciones y participaciones</Title>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} disabled={!q.data} onClick={() => void descargar('/impuestos/bienes-personales', { anio: String(anio), formato: 'xlsx' }, `bienes-personales-${anio}.xlsx`)}>Excel</Button>
      </Group>
      <NumberInput label="Año" w={120} mb="md" min={2000} max={2100} value={anio} onChange={(v) => setAnio(Number(v) || anio)} />
      <Text size="xs" c="dimmed" mb="sm">La sociedad ingresa el impuesto de sus socios como responsable sustituto, sobre el valor patrimonial proporcional del balance que cierra en el año. La presentación se hace en el sitio de ARCA.</Text>
      {errorConsulta(q.error)}
      {q.data && <PanelBp key={`${anio}-${q.data.estado}-${JSON.stringify(q.data.liquidacion.filas.map((f) => f.porcentaje))}-${q.data.ajuste.importe}`} datos={q.data} puedeEditar={puede('impuestos.presentar')} alCambiar={() => void qc.invalidateQueries({ queryKey: ['/impuestos/bienes-personales'] })} />}
    </Paper>
  );
}
