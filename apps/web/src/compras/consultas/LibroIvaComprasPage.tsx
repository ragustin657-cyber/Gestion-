import { Alert, Button, Paper, ScrollArea, Table, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar, ErrorApi } from '../../api/cliente';
import { formatoFecha, formatoMoneda } from '../formato';
import { FiltroFechas, finDelMes, primeroDelMes } from './comun';
import { TIPOS_FC } from './DetalleComprobante';

interface Importes { netoPorAlicuota: Record<string, string>; ivaPorAlicuota: Record<string, string>; percepcionIva: string; percepcionesIibb: string; impuestosInternos: string; noGravado: string; exento: string; noComputable: string; total: string }
interface Fila extends Importes { fechaContable: string; tipo: string; letra: string; numero: string; razonSocial: string; cuit: string }

const OTROS: [keyof Importes, string][] = [['percepcionIva', 'Perc. IVA'], ['percepcionesIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['noGravado', 'No gravado'], ['exento', 'Exento'], ['noComputable', 'No computable'], ['total', 'Total']];

export function LibroIvaComprasPage() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(finDelMes());
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: ['/compras/libro-iva', desde, hasta],
    queryFn: () => api<{ filas: Fila[]; totales: Importes }>('/compras/libro-iva', { query: { desde, hasta } }),
    enabled: !!desde && !!hasta,
  });
  const alicuotas = Object.keys(q.data?.totales.netoPorAlicuota ?? {}).sort((a, b) => Number(a) - Number(b));
  const celdas = (x: Importes) => [
    ...alicuotas.flatMap((a) => [x.netoPorAlicuota[a] ?? '0', x.ivaPorAlicuota[a] ?? '0']),
    ...OTROS.map(([k]) => x[k] as string),
  ];
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Libro IVA Compras</Title>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <Button variant="light" leftSection={<IconDownload size={16} />}
          onClick={() => descargar('/compras/libro-iva', { desde, hasta, formato: 'xlsx' }, `libro-iva-compras-${desde}-${hasta}.xlsx`).catch((e) => setError(e.mensaje))}>
          Exportar a Excel
        </Button>
      </FiltroFechas>
      {(error || q.isError) && <Alert color="red" mt="md">{error || (q.error instanceof ErrorApi ? q.error.mensaje : 'Error')}</Alert>}
      <ScrollArea mt="md">
        <Table withTableBorder striped miw={1100} fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fecha</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>CUIT</Table.Th>
              {alicuotas.flatMap((a) => [<Table.Th key={`n${a}`} ta="right">Neto {a.replace('.', ',')} %</Table.Th>, <Table.Th key={`i${a}`} ta="right">IVA {a.replace('.', ',')} %</Table.Th>])}
              {OTROS.map(([, t]) => <Table.Th key={t} ta="right">{t}</Table.Th>)}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(q.data?.filas ?? []).map((f, i) => (
              <Table.Tr key={i}>
                <Table.Td>{formatoFecha(f.fechaContable)}</Table.Td>
                <Table.Td>{TIPOS_FC[f.tipo]} {f.letra} {f.numero}</Table.Td>
                <Table.Td>{f.razonSocial}</Table.Td>
                <Table.Td>{f.cuit}</Table.Td>
                {celdas(f).map((v, j) => <Table.Td key={j} ta="right">{formatoMoneda(v)}</Table.Td>)}
              </Table.Tr>
            ))}
            {!q.data?.filas.length && <Table.Tr><Table.Td colSpan={12}><Text c="dimmed" ta="center" size="sm">Sin comprobantes en el período</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
          {q.data && q.data.filas.length > 0 && (
            <Table.Tfoot>
              <Table.Tr><Table.Th colSpan={4}>Totales</Table.Th>{celdas(q.data.totales).map((v, j) => <Table.Th key={j} ta="right">{formatoMoneda(v)}</Table.Th>)}</Table.Tr>
            </Table.Tfoot>
          )}
        </Table>
      </ScrollArea>
    </Paper>
  );
}
