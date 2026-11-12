import { ActionIcon, Alert, Button, Group, NumberInput, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useCuentasImputables } from '../abm/opciones';
import { hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { cantidadTexto, NOMBRE_DOCUMENTO, useDepositos, useExistencias } from './comun';

type TipoDoc = 'TRANSFERENCIA' | 'INVENTARIO' | 'INICIAL' | 'SALIDA';
export interface RenglonDoc { articuloId: string; cantidad: string; costoUnitario?: string }
interface ArticuloStock { id: string; codigo: string; descripcion: string }

/** Un renglón sin cantidad (o sin costo en el inventario inicial) no se envía como cero: hay que completarlo. */
export function renglonesIncompletos(tipo: TipoDoc, renglones: RenglonDoc[]): boolean {
  return renglones.some((r) => r.cantidad === '' || (tipo === 'INICIAL' && (r.costoUnitario ?? '') === ''));
}

/** Grilla del inventario físico: lo contado contra el saldo del sistema, con la diferencia. */
export function GrillaInventario({ articulos, saldos, renglones, onChange }: {
  articulos: ArticuloStock[]; saldos: Record<string, string>; renglones: RenglonDoc[]; onChange: (r: RenglonDoc[]) => void;
}) {
  const cambiar = (i: number, cantidad: string) => onChange(renglones.map((r, j) => (j === i ? { ...r, cantidad } : r)));
  return (
    <Table withTableBorder>
      <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th ta="right">Sistema</Table.Th><Table.Th w={160}>Contado</Table.Th><Table.Th ta="right">Diferencia</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {renglones.map((r, i) => {
          const a = articulos.find((x) => x.id === r.articuloId);
          const sistema = Number(saldos[r.articuloId] ?? 0);
          const dif = r.cantidad === '' ? null : Number(r.cantidad) - sistema;
          return (
            <Table.Tr key={r.articuloId}>
              <Table.Td>{a ? `${a.codigo} ${a.descripcion}` : r.articuloId}</Table.Td>
              <Table.Td ta="right">{cantidadTexto(String(sistema))}</Table.Td>
              <Table.Td><NumberInput size="xs" min={0} decimalSeparator="," aria-label={`Contado ${a?.codigo ?? ''}`} value={r.cantidad} onChange={(v) => cambiar(i, String(v))} /></Table.Td>
              <Table.Td ta="right" c={dif ? (dif > 0 ? 'green' : 'red') : undefined}>{dif === null ? '' : dif > 0 ? `+${cantidadTexto(String(dif))}` : cantidadTexto(String(dif))}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

export function DocumentoStockPage({ tipo }: { tipo: TipoDoc }) {
  const qc = useQueryClient();
  const op = useOperacion();
  const depositos = (useDepositos().data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
  const cuentas = useCuentasImputables();
  const [fecha, setFecha] = useState(hoy());
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [conAsiento, setConAsiento] = useState(true);
  const [renglones, setRenglones] = useState<RenglonDoc[]>([]);
  const [agregar, setAgregar] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ numero: number; advertencias: string[] } | null>(null);
  const existencias = useExistencias().data?.filas ?? [];
  const articulos = existencias.map((f) => ({ id: f.articuloId, codigo: f.codigo, descripcion: f.descripcion }));
  const saldos = Object.fromEntries(existencias.map((f) => [f.articuloId, f.depositos.find((d) => d.depositoId === depositoId)?.cantidad ?? '0']));
  const pideCuenta = tipo === 'SALIDA' || (tipo === 'INICIAL' && conAsiento);

  const confirmar = async () => {
    const r = await op.ejecutar(() => api<{ numero: number; advertencias: string[] }>('/stock/documentos', {
      metodo: 'POST',
      body: {
        tipo, fecha, depositoId, depositoDestinoId: tipo === 'TRANSFERENCIA' ? destinoId : undefined,
        conAsiento: tipo === 'INICIAL' ? conAsiento : undefined, cuentaContableId: pideCuenta ? cuentaId : undefined,
        renglones: renglones.map((x) => tipo === 'INVENTARIO'
          ? { articuloId: x.articuloId, cantidadContada: Number(x.cantidad) }
          : { articuloId: x.articuloId, cantidad: Number(x.cantidad), ...(tipo === 'INICIAL' ? { costoUnitario: Number(x.costoUnitario ?? 0) } : {}) }),
      },
    }), (x) => `${NOMBRE_DOCUMENTO[tipo]} N° ${x.numero} registrado`);
    if (r) {
      setResultado(r);
      setRenglones([]);
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/stock') });
    }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">{NOMBRE_DOCUMENTO[tipo]}</Title>
      <Group align="flex-end" mb="md">
        <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
        <Select label={tipo === 'TRANSFERENCIA' ? 'Depósito de origen' : 'Depósito'} w={220} data={depositos} value={depositoId} onChange={setDepositoId} />
        {tipo === 'TRANSFERENCIA' && <Select label="Depósito de destino" w={220} data={depositos} value={destinoId} onChange={setDestinoId} />}
        {tipo === 'INICIAL' && <Switch label="Generar asiento" checked={conAsiento} onChange={(e) => setConAsiento(e.currentTarget.checked)} mb={8} />}
        {pideCuenta && <Select label={tipo === 'INICIAL' ? 'Contrapartida' : 'Cuenta de la salida'} w={320} searchable data={cuentas} value={cuentaId} onChange={setCuentaId} />}
      </Group>
      {tipo === 'INICIAL' && !conAsiento && <Text size="sm" c="dimmed" mb="sm">Sin asiento: use esta opción cuando el asiento de apertura ya incluye las mercaderías.</Text>}
      <Group align="flex-end" mb="sm">
        <Select label="Artículo" w={360} searchable data={articulos.filter((a) => !renglones.some((r) => r.articuloId === a.id)).map((a) => ({ value: a.id, label: `${a.codigo} ${a.descripcion}` }))} value={agregar} onChange={setAgregar} />
        <Button variant="light" leftSection={<IconPlus size={14} />} disabled={!agregar} onClick={() => { setRenglones([...renglones, { articuloId: agregar!, cantidad: '', costoUnitario: '' }]); setAgregar(null); }}>Agregar</Button>
      </Group>
      {tipo === 'INVENTARIO'
        ? <GrillaInventario articulos={articulos} saldos={saldos} renglones={renglones} onChange={setRenglones} />
        : (
          <Table withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th>{tipo !== 'INICIAL' && <Table.Th ta="right">Disponible</Table.Th>}<Table.Th w={150}>Cantidad</Table.Th>{tipo === 'INICIAL' && <Table.Th w={160}>Costo unitario</Table.Th>}<Table.Th w={40} /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {renglones.map((r, i) => {
                const a = articulos.find((x) => x.id === r.articuloId);
                const set = (c: Partial<RenglonDoc>) => setRenglones(renglones.map((x, j) => (j === i ? { ...x, ...c } : x)));
                return (
                  <Table.Tr key={r.articuloId}>
                    <Table.Td>{a ? `${a.codigo} ${a.descripcion}` : ''}</Table.Td>
                    {tipo !== 'INICIAL' && <Table.Td ta="right">{cantidadTexto(saldos[r.articuloId])}</Table.Td>}
                    <Table.Td><NumberInput size="xs" min={0} decimalSeparator="," aria-label={`Cantidad ${a?.codigo ?? ''}`} value={r.cantidad} onChange={(v) => set({ cantidad: String(v) })} /></Table.Td>
                    {tipo === 'INICIAL' && <Table.Td><NumberInput size="xs" min={0} decimalScale={6} decimalSeparator="," aria-label={`Costo ${a?.codigo ?? ''}`} value={r.costoUnitario} onChange={(v) => set({ costoUnitario: String(v) })} /></Table.Td>}
                    <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => setRenglones(renglones.filter((_, j) => j !== i))}><IconTrash size={14} /></ActionIcon></Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      {op.alerta}
      {resultado && (
        <Stack gap="xs" mt="sm">
          <Text>{`Documento N° ${resultado.numero}`}</Text>
          {resultado.advertencias.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
        </Stack>
      )}
      {renglonesIncompletos(tipo, renglones) && <Text size="sm" c="orange" mt="sm">{tipo === 'INVENTARIO' ? 'Complete lo contado en todos los renglones (o quite los que no contó)' : 'Complete la cantidad y el costo de todos los renglones'}</Text>}
      <Group mt="md"><Button loading={op.enviando} disabled={!depositoId || !renglones.length || renglonesIncompletos(tipo, renglones)} onClick={() => void confirmar()}>Confirmar</Button></Group>
    </Paper>
  );
}
