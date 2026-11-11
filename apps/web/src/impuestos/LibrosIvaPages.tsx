import { Alert, Button, Group, Paper, ScrollArea, Table, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';

const ALICUOTAS = ['21', '10.5', '27', '5', '2.5', '0'];
interface Fila { condicionIva?: string; noDiscriminado?: string; percepcionIva?: string; percepcionesIibb?: string; impuestosInternos?: string; noComputable?: string; fecha?: string; fechaContable?: string; comprobante?: string; tipo?: string; letra?: string; numero?: string; cliente?: string; razonSocial?: string; documento?: string; cuit?: string; netoPorAlicuota: Record<string, string>; ivaPorAlicuota: Record<string, string>; noGravado: string; exento: string; total: string }
interface Libro { filas: Fila[]; totales: Fila; advertencias: string[] }

type Extra = { clave: keyof Fila; titulo: string };
const EXTRA_VENTAS: Extra[] = [{ clave: 'noDiscriminado', titulo: 'No discriminado' }];
const EXTRA_COMPRAS: Extra[] = [{ clave: 'percepcionIva', titulo: 'Perc. IVA' }, { clave: 'percepcionesIibb', titulo: 'Perc. IIBB' }, { clave: 'impuestosInternos', titulo: 'Imp. internos' }, { clave: 'noComputable', titulo: 'No computable' }];

function LibroIva({ titulo, ruta, tercero, extra }: { titulo: string; ruta: string; tercero: string; extra: Extra[] }) {
  const inicio = `${hoy().slice(0, 7)}-01`;
  const [desde, setDesde] = useState(inicio);
  const [hasta, setHasta] = useState(hoy());
  const q = useQuery({ queryKey: [ruta, desde, hasta], queryFn: () => api<Libro>(ruta, { query: { desde, hasta } }), enabled: !!desde && !!hasta });
  const usadas = ALICUOTAS.filter((a) => q.data?.totales.netoPorAlicuota[a] !== undefined);
  const celdas = (f: Fila) => usadas.flatMap((a) => [<Table.Td key={`n${a}`} ta="right">{formatoMoneda(f.netoPorAlicuota[a] ?? 0)}</Table.Td>, ...(a === '0' ? [] : [<Table.Td key={`i${a}`} ta="right">{formatoMoneda(f.ivaPorAlicuota[a] ?? 0)}</Table.Td>])]);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">{titulo}</Title>
      <Group align="flex-end" mb="md">
        <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <Button variant="default" onClick={() => void descargar(ruta, { desde, hasta, formato: 'xlsx' }, `${ruta.split('/').pop()}-${desde}-${hasta}.xlsx`)}>Excel</Button>
        <Button variant="default" onClick={() => void descargar(ruta, { desde, hasta, formato: 'pdf' }, `${ruta.split('/').pop()}-${desde}-${hasta}.pdf`)}>PDF</Button>
      </Group>
      {q.data?.advertencias.map((a) => <Alert key={a} color="yellow" mb="sm">{a}</Alert>)}
      <ScrollArea>
        <Table withTableBorder striped miw={900}>
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>{tercero}</Table.Th>
            {usadas.flatMap((a) => [<Table.Th key={`n${a}`} ta="right">{`Neto ${a.replace('.', ',')}%`}</Table.Th>, ...(a === '0' ? [] : [<Table.Th key={`i${a}`} ta="right">{`IVA ${a.replace('.', ',')}%`}</Table.Th>])])}
            {extra.map((x) => <Table.Th key={x.clave} ta="right">{x.titulo}</Table.Th>)}
            <Table.Th ta="right">No gravado</Table.Th><Table.Th ta="right">Exento</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(q.data?.filas ?? []).map((f, i) => (
              <Table.Tr key={i}>
                <Table.Td>{formatoFecha(f.fecha ?? f.fechaContable)}</Table.Td><Table.Td>{f.comprobante ?? `${f.tipo} ${f.letra} ${f.numero}`}</Table.Td><Table.Td>{f.cliente ?? f.razonSocial}</Table.Td>
                {celdas(f)}{extra.map((x) => <Table.Td key={x.clave} ta="right">{formatoMoneda(f[x.clave] as string | undefined)}</Table.Td>)}<Table.Td ta="right">{formatoMoneda(f.noGravado)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.exento)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.total)}</Table.Td>
              </Table.Tr>
            ))}
            {q.data && (
              <Table.Tr fw={700}><Table.Td colSpan={3}>Totales</Table.Td>{celdas(q.data.totales)}{extra.map((x) => <Table.Td key={x.clave} ta="right">{formatoMoneda(q.data!.totales[x.clave] as string | undefined)}</Table.Td>)}
                <Table.Td ta="right">{formatoMoneda(q.data.totales.noGravado)}</Table.Td><Table.Td ta="right">{formatoMoneda(q.data.totales.exento)}</Table.Td><Table.Td ta="right">{formatoMoneda(q.data.totales.total)}</Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

export const LibroIvaVentasPage = () => <LibroIva titulo="Libro IVA Ventas" ruta="/impuestos/libro-iva-ventas" tercero="Cliente" extra={EXTRA_VENTAS} />;
export const LibroIvaComprasPage = () => <LibroIva titulo="Libro IVA Compras" ruta="/impuestos/libro-iva-compras" tercero="Proveedor" extra={EXTRA_COMPRAS} />;
