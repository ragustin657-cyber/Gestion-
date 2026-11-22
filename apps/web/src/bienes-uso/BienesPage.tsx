import { Badge, Button, Group, Modal, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { useTodasLasCuentas } from '../contabilidad/comun';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { numeroCelda } from '../presupuestos/PresupuestosPage';
import { Bien, MOTIVOS, ORIGENES, TipoImpositivo, useRubros } from './comun';

interface DatosImpositivos { id: string; valorOrigen: string; vidaUtilImpositivaAnios: number | null; valorTerreno: string; rubro: { id: string; nombre: string; tipoImpositivo?: TipoImpositivo; vidaUtilImpositivaAnios?: number | null } }

/** Datos impositivos del bien (E44): vida útil impositiva (pisa al rubro) y terreno de los inmuebles; no afectan la contabilidad. */
export function DatosImpositivosBien({ bien, puedeEditar, alGuardar }: { bien: DatosImpositivos; puedeEditar: boolean; alGuardar: () => void }) {
  const op = useOperacion();
  const [vida, setVida] = useState(bien.vidaUtilImpositivaAnios ? String(bien.vidaUtilImpositivaAnios) : '');
  const [terreno, setTerreno] = useState(String(Number(bien.valorTerreno) || ''));
  const inmueble = bien.rubro.tipoImpositivo === 'INMUEBLE';
  const guardar = async () => {
    const body = { vidaUtilImpositivaAnios: vida.trim() ? Number(vida) : null, valorTerreno: inmueble ? Number(terreno.replace(',', '.')) || 0 : 0 };
    if (await op.ejecutar(() => api(`/bienes-uso/${bien.id}/impositivo`, { metodo: 'PUT', body }), () => 'Datos impositivos guardados')) alGuardar();
  };
  return (
    <Stack gap="xs" mb="md">
      <Title order={5}>Amortización impositiva</Title>
      <Group align="flex-end">
        <TextInput label="Vida útil impositiva (años)" w={200} inputMode="numeric" disabled={!puedeEditar} value={vida} onChange={(e) => setVida(e.currentTarget.value)}
          placeholder={bien.rubro.vidaUtilImpositivaAnios ? `${bien.rubro.vidaUtilImpositivaAnios} (del rubro)` : inmueble ? '50' : 'La del rubro'} />
        {inmueble && <TextInput label="Valor del terreno" w={200} inputMode="decimal" disabled={!puedeEditar} value={terreno} onChange={(e) => setTerreno(e.currentTarget.value)} />}
        {puedeEditar && <Button size="xs" variant="light" loading={op.enviando} onClick={() => void guardar()}>Guardar datos impositivos</Button>}
      </Group>
      {op.alerta}
    </Stack>
  );
}

const estado = (b: { estado: string; motivoBaja: string | null }) =>
  b.estado === 'ACTIVO' ? <Badge variant="light" color="green">Activo</Badge> : <Badge variant="light" color="gray">{`Baja (${MOTIVOS[b.motivoBaja ?? ''] ?? ''})`}</Badge>;

function AltaBien({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const rubros = useRubros();
  const cuentas = useTodasLasCuentas();
  const op = useOperacion();
  const [f, setF] = useState({ origen: 'MANUAL', descripcion: '', rubroId: null as string | null, fechaAlta: hoy(), valorOrigen: '', vidaUtilMeses: '', valorResidual: '', cuentaContrapartidaId: null as string | null, amortizacionInicial: '', fechaAmortizacionInicial: '' });
  const rubro = rubros.data?.find((r) => r.id === f.rubroId);
  const guardar = async () => {
    const n = (s: string) => (s ? Number(s.replace(',', '.')) : undefined);
    const body = {
      origen: f.origen, descripcion: f.descripcion, rubroId: f.rubroId, fechaAlta: f.fechaAlta, valorOrigen: n(f.valorOrigen), vidaUtilMeses: n(f.vidaUtilMeses), valorResidual: n(f.valorResidual),
      ...(f.origen === 'MANUAL' ? { cuentaContrapartidaId: f.cuentaContrapartidaId } : { amortizacionInicial: n(f.amortizacionInicial) ?? 0, fechaAmortizacionInicial: f.fechaAmortizacionInicial }),
    };
    const r = await op.ejecutar(() => api<{ numero: number }>('/bienes-uso', { metodo: 'POST', body }), (x) => `Bien N° ${x.numero} dado de alta`);
    if (r) { void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/bienes-uso') }); onClose(); }
  };
  return (
    <Stack>
      <SegmentedControl data={[{ value: 'MANUAL', label: 'Alta con asiento' }, { value: 'INICIAL', label: 'Carga inicial' }]} value={f.origen} onChange={(v) => setF({ ...f, origen: v })} />
      <Text size="sm" c="dimmed">{f.origen === 'MANUAL' ? 'Genera el asiento del alta contra la cuenta que elijas. Los bienes comprados se dan de alta desde la factura de proveedor.' : 'Para bienes que ya estaban en la apertura: no genera asiento; indicá la amortización acumulada a un fin de mes.'}</Text>
      <TextInput label="Descripción" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.currentTarget.value })} />
      <SimpleGrid cols={2}>
        <Select label="Rubro" data={(rubros.data ?? []).map((r) => ({ value: r.id, label: r.nombre }))} value={f.rubroId} onChange={(v) => setF({ ...f, rubroId: v })} />
        <TextInput label="Fecha de alta" type="date" value={f.fechaAlta} onChange={(e) => setF({ ...f, fechaAlta: e.currentTarget.value })} />
        <TextInput label="Valor de origen" inputMode="decimal" value={f.valorOrigen} onChange={(e) => setF({ ...f, valorOrigen: e.currentTarget.value })} />
        <TextInput label="Vida útil (meses)" inputMode="numeric" placeholder={rubro ? String(rubro.vidaUtilMeses) : ''} value={f.vidaUtilMeses} onChange={(e) => setF({ ...f, vidaUtilMeses: e.currentTarget.value })} />
        <TextInput label="Valor residual" inputMode="decimal" placeholder="0" value={f.valorResidual} onChange={(e) => setF({ ...f, valorResidual: e.currentTarget.value })} />
        {f.origen === 'MANUAL'
          ? <Select label="Cuenta de contrapartida" searchable data={cuentas} value={f.cuentaContrapartidaId} onChange={(v) => setF({ ...f, cuentaContrapartidaId: v })} />
          : <>
            <TextInput label="Amortización acumulada" inputMode="decimal" value={f.amortizacionInicial} onChange={(e) => setF({ ...f, amortizacionInicial: e.currentTarget.value })} />
            <TextInput label="Acumulada al (fin de mes)" type="date" value={f.fechaAmortizacionInicial} onChange={(e) => setF({ ...f, fechaAmortizacionInicial: e.currentTarget.value })} />
          </>}
      </SimpleGrid>
      {op.alerta}
      <Group><Button loading={op.enviando} onClick={() => void guardar()}>Dar de alta</Button></Group>
    </Stack>
  );
}

export function BienesPage() {
  const navegar = useNavigate();
  const { puede } = useAuth();
  const rubros = useRubros();
  const [rubroId, setRubroId] = useState<string | null>(null);
  const [estadoF, setEstadoF] = useState('ACTIVO');
  const [alta, setAlta] = useState(false);
  const query = { rubroId: rubroId ?? '', estado: estadoF === 'TODOS' ? '' : estadoF };
  const q = useQuery({ queryKey: ['/bienes-uso', query], queryFn: () => api<Bien[]>('/bienes-uso', { query }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Bienes de uso</Title>
        {puede('bienes.gestionar') && <Button size="xs" onClick={() => setAlta(true)}>Nuevo bien</Button>}
      </Group>
      <Group mb="md" align="flex-end">
        <Select label="Rubro" clearable w={220} data={(rubros.data ?? []).map((r) => ({ value: r.id, label: r.nombre }))} value={rubroId} onChange={setRubroId} />
        <SegmentedControl data={[{ value: 'ACTIVO', label: 'Activos' }, { value: 'BAJA', label: 'Dados de baja' }, { value: 'TODOS', label: 'Todos' }]} value={estadoF} onChange={setEstadoF} />
      </Group>
      {errorConsulta(q.error)}
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Descripción</Table.Th><Table.Th>Rubro</Table.Th><Table.Th>Alta</Table.Th><Table.Th ta="right">Valor de origen</Table.Th><Table.Th ta="right">Amort. acumulada</Table.Th><Table.Th ta="right">Residual</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((b) => (
            <Table.Tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => navegar(`/contabilidad/bienes/${b.id}`)}>
              <Table.Td>{b.numero}</Table.Td><Table.Td>{b.descripcion}</Table.Td><Table.Td>{b.rubro}</Table.Td><Table.Td>{formatoFecha(b.fechaAlta)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(b.valorOrigen)}</Table.Td><Table.Td ta="right">{formatoMoneda(b.acumulada)}</Table.Td><Table.Td ta="right">{formatoMoneda(b.residual)}</Table.Td><Table.Td>{estado(b)}</Table.Td>
            </Table.Tr>
          ))}
          {q.data && !q.data.length && <Table.Tr><Table.Td colSpan={8}><Text size="sm" c="dimmed">Sin bienes</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={alta} onClose={() => setAlta(false)} title="Nuevo bien de uso" size="lg">{alta && <AltaBien onClose={() => setAlta(false)} />}</Modal>
    </Paper>
  );
}

type BienEditable = { id: string; origen: string; descripcion: string; vidaUtilMeses: number; valorResidual: string; fechaAlta: string; valorOrigen: string };

/** Edición: descripción, vida útil y residual; en la carga inicial también fecha y valor de origen (spec E17). */
export function FormEdicionBien({ bien, conAmortizaciones = false, onGuardado }: { bien: BienEditable; conAmortizaciones?: boolean; onGuardado: () => void }) {
  const op = useOperacion();
  const inicial = bien.origen === 'INICIAL';
  // Importes en formato argentino y leídos con las mismas reglas (sin multiplicar los centavos)
  const ar = (v: string) => Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const original = { descripcion: bien.descripcion, vidaUtilMeses: String(bien.vidaUtilMeses), valorResidual: ar(bien.valorResidual), fechaAlta: bien.fechaAlta, valorOrigen: ar(bien.valorOrigen) };
  const [f, setF] = useState(original);
  const guardar = async () => {
    // Solo lo modificado: con amortizaciones la API acepta cambiar la descripción y nada más
    const body: Record<string, unknown> = {};
    if (f.descripcion !== original.descripcion) body.descripcion = f.descripcion;
    if (f.vidaUtilMeses !== original.vidaUtilMeses) body.vidaUtilMeses = Number(f.vidaUtilMeses);
    if (f.valorResidual !== original.valorResidual) body.valorResidual = numeroCelda(f.valorResidual);
    if (inicial && f.fechaAlta !== original.fechaAlta) body.fechaAlta = f.fechaAlta;
    if (inicial && f.valorOrigen !== original.valorOrigen) body.valorOrigen = numeroCelda(f.valorOrigen);
    if (!Object.keys(body).length) { onGuardado(); return; }
    if (await op.ejecutar(() => api(`/bienes-uso/${bien.id}`, { metodo: 'PUT', body }), () => 'Bien actualizado')) onGuardado();
  };
  return (
    <Stack>
      <TextInput label="Descripción" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.currentTarget.value })} />
      <SimpleGrid cols={2}>
        <TextInput label="Vida útil (meses)" inputMode="numeric" disabled={conAmortizaciones} value={f.vidaUtilMeses} onChange={(e) => setF({ ...f, vidaUtilMeses: e.currentTarget.value })} />
        <TextInput label="Valor residual" inputMode="decimal" disabled={conAmortizaciones} value={f.valorResidual} onChange={(e) => setF({ ...f, valorResidual: e.currentTarget.value })} />
        {inicial && <TextInput label="Fecha de alta" type="date" disabled={conAmortizaciones} value={f.fechaAlta} onChange={(e) => setF({ ...f, fechaAlta: e.currentTarget.value })} />}
        {inicial && <TextInput label="Valor de origen" inputMode="decimal" disabled={conAmortizaciones} value={f.valorOrigen} onChange={(e) => setF({ ...f, valorOrigen: e.currentTarget.value })} />}
      </SimpleGrid>
      <Text size="xs" c="dimmed">Con amortizaciones contabilizadas solo se cambia la descripción.</Text>
      {op.alerta}
      <Group><Button loading={op.enviando} onClick={() => void guardar()}>Guardar</Button></Group>
    </Stack>
  );
}

interface Ficha extends Omit<Bien, 'rubro' | 'acumulada' | 'residual'> {
  rubro: { id: string; nombre: string; tipoImpositivo?: TipoImpositivo; vidaUtilImpositivaAnios?: number | null }; vidaUtilImpositivaAnios: number | null; valorTerreno: string; amortizaciones: { mes: string; importe: string; asientoId: string }[]; amortizacionContabilizada: string; residualContable: string; asientoAltaId: string | null; asientoBajaId: string | null; amortizacionInicial: string; fechaAmortizacionInicial: string | null;
}

export function FichaBienPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { puede } = useAuth();
  const op = useOperacion();
  const [baja, setBaja] = useState<{ fecha: string; motivo: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const navegar = useNavigate();
  const eliminar = async () => {
    if (!window.confirm('¿Eliminar el bien? Se anula su asiento de alta.')) return;
    if (await op.ejecutar(() => api(`/bienes-uso/${id}`, { metodo: 'DELETE' }), () => 'Bien eliminado')) { refrescar(); navegar('/contabilidad/bienes'); }
  };
  const q = useQuery({ queryKey: ['/bienes-uso', id], queryFn: () => api<Ficha>(`/bienes-uso/${id}`) });
  const refrescar = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/bienes-uso') });
  const darBaja = async () => {
    if (await op.ejecutar(() => api(`/bienes-uso/${id}/baja`, { metodo: 'POST', body: baja }), () => 'Bien dado de baja')) { setBaja(null); refrescar(); }
  };
  const anularBaja = async () => {
    if (await op.ejecutar(() => api(`/bienes-uso/${id}/baja/anular`, { metodo: 'POST' }), () => 'Baja anulada')) refrescar();
  };
  const b = q.data;
  return (
    <Paper withBorder p="md" radius="md">
      {errorConsulta(q.error)}
      {b && <>
        <Group justify="space-between" mb="md">
          <Title order={3}>{`Bien N° ${b.numero} — ${b.descripcion}`}</Title>
          {puede('bienes.gestionar') && <Group gap="xs">
            {b.estado === 'ACTIVO' && <Button size="xs" variant="default" onClick={() => setEditando(true)}>Editar</Button>}
            {b.estado === 'ACTIVO' && b.origen !== 'FACTURA' && !b.amortizaciones.length && <Button size="xs" variant="subtle" color="red" onClick={() => void eliminar()}>Eliminar</Button>}
            {b.estado === 'ACTIVO'
              ? <Button size="xs" color="red" variant="light" onClick={() => setBaja({ fecha: hoy(), motivo: 'DESUSO' })}>Dar de baja</Button>
              : b.motivoBaja !== 'VENTA' && <Button size="xs" variant="default" onClick={() => void anularBaja()}>Anular baja</Button>}
          </Group>}
        </Group>
        {op.alerta}
        <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
          <Text size="sm"><b>Rubro:</b> {b.rubro.nombre}</Text>
          <Text size="sm"><b>Alta:</b> {formatoFecha(b.fechaAlta)} ({ORIGENES[b.origen]})</Text>
          <Text size="sm"><b>Valor de origen:</b> {formatoMoneda(b.valorOrigen)}</Text>
          <Text size="sm"><b>Vida útil:</b> {b.vidaUtilMeses} meses</Text>
          <Text size="sm"><b>Valor residual:</b> {formatoMoneda(b.valorResidual)}</Text>
          <Text size="sm"><b>Amortización contabilizada:</b> {formatoMoneda(b.amortizacionContabilizada)}</Text>
          <Text size="sm"><b>Residual contable:</b> {formatoMoneda(b.residualContable)}</Text>
          <Text size="sm"><b>Estado:</b> {estado(b)} {b.fechaBaja ? formatoFecha(b.fechaBaja) : ''}</Text>
        </SimpleGrid>
        <DatosImpositivosBien key={`${b.id}-${b.vidaUtilImpositivaAnios}-${b.valorTerreno}`} bien={b} puedeEditar={puede('bienes.gestionar')} alGuardar={refrescar} />
        <Title order={5} mb="xs">Amortizaciones</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Mes</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {Number(b.amortizacionInicial) > 0 && <Table.Tr><Table.Td>{`Acumulada al ${formatoFecha(b.fechaAmortizacionInicial)}`}</Table.Td><Table.Td ta="right">{formatoMoneda(b.amortizacionInicial)}</Table.Td></Table.Tr>}
            {b.amortizaciones.map((a) => <Table.Tr key={`${a.mes}-${a.asientoId}`}><Table.Td>{`${a.mes.slice(5, 7)}/${a.mes.slice(0, 4)}`}</Table.Td><Table.Td ta="right">{formatoMoneda(a.importe)}</Table.Td></Table.Tr>)}
          </Table.Tbody>
        </Table>
      </>}
      <Modal opened={editando} onClose={() => setEditando(false)} title="Editar bien" size="lg">
        {editando && b && <FormEdicionBien bien={{ id: b.id, origen: b.origen, descripcion: b.descripcion, vidaUtilMeses: b.vidaUtilMeses, valorResidual: b.valorResidual, fechaAlta: b.fechaAlta, valorOrigen: b.valorOrigen }} conAmortizaciones={b.amortizaciones.length > 0} onGuardado={() => { setEditando(false); refrescar(); }} />}
      </Modal>
      <Modal opened={!!baja} onClose={() => setBaja(null)} title="Dar de baja">
        {baja && <Stack>
          <TextInput label="Fecha" type="date" value={baja.fecha} onChange={(e) => setBaja({ ...baja, fecha: e.currentTarget.value })} />
          <Select label="Motivo" allowDeselect={false} data={[{ value: 'DESUSO', label: 'Desuso' }, { value: 'SINIESTRO', label: 'Siniestro' }, { value: 'ROBO', label: 'Robo' }]} value={baja.motivo} onChange={(v) => setBaja({ ...baja, motivo: v ?? 'DESUSO' })} />
          <Text size="sm" c="dimmed">El residual contable va a Bajas de bienes de uso. Para vender un bien, usá un comprobante de venta con el renglón "Bien de uso".</Text>
          {op.alerta}
          <Group><Button color="red" loading={op.enviando} onClick={() => void darBaja()}>Dar de baja</Button></Group>
        </Stack>}
      </Modal>
    </Paper>
  );
}
