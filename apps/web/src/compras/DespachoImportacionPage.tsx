import { ActionIcon, Alert, Button, Divider, Group, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { SelectorDestinoIva, useProrrateoActivo } from './destino-iva';
import { formatoMoneda, hoy } from './formato';

const ALICUOTAS = [{ value: '21', label: '21 %' }, { value: '10.5', label: '10,5 %' }, { value: '27', label: '27 %' }, { value: '5', label: '5 %' }, { value: '2.5', label: '2,5 %' }];
const n = (s: string) => (s === '' || !Number.isFinite(Number(s)) ? 0 : Number(s));
const r2 = (x: number) => Math.round(x * 100) / 100;

export const numeroDespachoValido = (s: string) => /^\d{5}[A-Z]{2}\d{2}\d{6}[A-Z]$/.test(s.trim().toUpperCase());

/**
 * IVA por alícuota (sobre la base sumada, como en la API) y total liquidado del despacho (spec E41 §4):
 * IVA + percepciones + derechos + tasa. La base imponible no integra el total.
 */
export function calcularDespacho(
  renglones: { base: string; alicuotaIva: string }[],
  o: { percepcionIva: string; percepcionGanancias: string; iibb: string[]; derechos: string; tasa: string },
) {
  const bases = new Map<string, number>();
  for (const r of renglones) bases.set(r.alicuotaIva, r2((bases.get(r.alicuotaIva) ?? 0) + n(r.base)));
  const ivas = [...bases].map(([alicuota, base]) => ({ alicuota, base, iva: r2((base * Number(alicuota)) / 100) }));
  const iva = r2(ivas.reduce((t, x) => t + x.iva, 0));
  const total = r2(iva + n(o.percepcionIva) + n(o.percepcionGanancias) + o.iibb.reduce((t, x) => t + n(x), 0) + n(o.derechos) + n(o.tasa));
  return { ivas, iva, total };
}

const inicial = () => ({ numeroDespacho: '', fechaEmision: hoy(), fechaContable: '', percepcionIva: '', percepcionGanancias: '', derechos: '', tasa: '', totalDeclarado: '', destinoCreditoIva: '' });

/** Compras → Despacho de importación (E41). */
export function DespachoImportacionPage() {
  const qc = useQueryClient();
  const prorrateo = useProrrateoActivo();
  const [cab, setCab] = useState(inicial());
  const [renglones, setRenglones] = useState([{ base: '', alicuotaIva: '21' }]);
  const [iibb, setIibb] = useState<{ jurisdiccion: string; importe: string }[]>([]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const calc = calcularDespacho(renglones, { percepcionIva: cab.percepcionIva, percepcionGanancias: cab.percepcionGanancias, iibb: iibb.map((x) => x.importe), derechos: cab.derechos, tasa: cab.tasa });
  const campo = (k: keyof ReturnType<typeof inicial>) => ({ value: cab[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCab({ ...cab, [k]: e.currentTarget.value }) });

  async function guardar() {
    setError('');
    if (!numeroDespachoValido(cab.numeroDespacho)) return setError('El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)');
    setEnviando(true);
    try {
      const r = await api<{ numeroInterno: number }>('/compras/despachos', {
        metodo: 'POST',
        body: {
          numeroDespacho: cab.numeroDespacho.trim().toUpperCase(), fechaEmision: cab.fechaEmision, fechaContable: cab.fechaContable || cab.fechaEmision,
          renglones: renglones.filter((x) => n(x.base) > 0).map((x) => ({ base: n(x.base), alicuotaIva: Number(x.alicuotaIva) })),
          percepcionIva: n(cab.percepcionIva), percepcionGanancias: n(cab.percepcionGanancias),
          percepcionesIibb: iibb.filter((x) => n(x.importe) > 0).map((x) => ({ jurisdiccion: x.jurisdiccion, importe: n(x.importe) })),
          derechosImportacion: n(cab.derechos), tasaEstadistica: n(cab.tasa), totalDeclarado: n(cab.totalDeclarado),
          ...(prorrateo && cab.destinoCreditoIva ? { destinoCreditoIva: cab.destinoCreditoIva } : {}),
        },
      });
      notifications.show({ color: 'green', message: `Despacho registrado (N° interno ${r.numeroInterno})` });
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/compras') });
      setCab(inicial());
      setRenglones([{ base: '', alicuotaIva: '21' }]);
      setIibb([]);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Despacho de importación</Title>
      <Stack>
        <Text size="sm" c="dimmed">Se registra contra la Dirección General de Aduanas. La deuda es lo liquidado (IVA, percepciones, derechos y tasa); la mercadería se carga con la factura del proveedor del exterior.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <TextInput label="Número de despacho" withAsterisk placeholder="26001IC04012345K" {...campo('numeroDespacho')} />
          <TextInput label="Fecha de oficialización" type="date" {...campo('fechaEmision')} />
          <TextInput label="Fecha contable" type="date" placeholder="Igual a la oficialización" {...campo('fechaContable')} />
          {prorrateo && <SelectorDestinoIva value={cab.destinoCreditoIva} onChange={(v) => setCab({ ...cab, destinoCreditoIva: v })} />}
        </SimpleGrid>

        <Divider label="Base imponible del IVA" labelPosition="left" />
        <Table withTableBorder maw={560}>
          <Table.Thead><Table.Tr><Table.Th>Base imponible</Table.Th><Table.Th>Alícuota</Table.Th><Table.Th ta="right">IVA</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {renglones.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td><TextInput size="xs" aria-label="Base imponible" inputMode="decimal" value={r.base} onChange={(e) => setRenglones(renglones.map((x, j) => (j === i ? { ...x, base: e.currentTarget.value } : x)))} /></Table.Td>
                <Table.Td><Select size="xs" aria-label="Alícuota" w={110} allowDeselect={false} data={ALICUOTAS} value={r.alicuotaIva} onChange={(v) => setRenglones(renglones.map((x, j) => (j === i ? { ...x, alicuotaIva: v ?? '21' } : x)))} /></Table.Td>
                <Table.Td ta="right">{formatoMoneda(r2((n(r.base) * Number(r.alicuotaIva)) / 100))}</Table.Td>
                <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar base" onClick={() => setRenglones(renglones.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group><Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setRenglones([...renglones, { base: '', alicuotaIva: '10.5' }])}>Agregar alícuota</Button></Group>

        <Divider label="Percepciones y tributos" labelPosition="left" />
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <TextInput label="Percepción IVA" inputMode="decimal" {...campo('percepcionIva')} />
          <TextInput label="Percepción Ganancias" inputMode="decimal" {...campo('percepcionGanancias')} />
          <TextInput label="Derechos de importación" inputMode="decimal" {...campo('derechos')} />
          <TextInput label="Tasa de estadística" inputMode="decimal" {...campo('tasa')} />
        </SimpleGrid>
        <Stack gap={4}>
          {iibb.map((x, i) => (
            <Group key={i} gap="xs">
              <TextInput size="xs" aria-label="Jurisdicción percepción IIBB" placeholder="902" value={x.jurisdiccion} onChange={(e) => setIibb(iibb.map((y, j) => (j === i ? { ...y, jurisdiccion: e.currentTarget.value } : y)))} />
              <TextInput size="xs" aria-label="Importe percepción IIBB" placeholder="Importe" value={x.importe} onChange={(e) => setIibb(iibb.map((y, j) => (j === i ? { ...y, importe: e.currentTarget.value } : y)))} />
              <ActionIcon variant="subtle" color="red" aria-label="Quitar percepción IIBB" onClick={() => setIibb(iibb.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
            </Group>
          ))}
          <Group><Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setIibb([...iibb, { jurisdiccion: '', importe: '' }])}>Agregar percepción IIBB</Button></Group>
        </Stack>

        <Group justify="space-between" align="flex-end">
          <TextInput label="Total liquidado (como figura en el despacho)" withAsterisk inputMode="decimal" w={300} {...campo('totalDeclarado')} />
          <Stack gap={2} align="flex-end">
            <Text size="sm">{`IVA ${formatoMoneda(calc.iva)}`}</Text>
            <Text fw={700} data-testid="total-despacho">{`Total liquidado ${formatoMoneda(calc.total)}`}</Text>
          </Stack>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button loading={enviando} onClick={() => void guardar()}>Registrar despacho</Button></Group>
      </Stack>
    </Paper>
  );
}
