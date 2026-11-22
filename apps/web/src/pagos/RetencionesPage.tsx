import { Alert, Button, Checkbox, Paper, ScrollArea, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar, ErrorApi } from '../api/cliente';
import { FiltroFechas, finDelMes, primeroDelMes } from '../compras/consultas/comun';
import { formatoFecha, formatoMoneda } from '../compras/formato';

interface Fila {
  id: string; ordenPagoId: string; fechaPago: string; certificado: string; impuesto: string; jurisdiccion: string | null; regimen: string | null;
  razonSocial: string; cuit: string; base: string; alicuota: string; importe: string; ordenPagoNumero: string; anulada: boolean; certificadoSire: string | null;
}

/** Impuestos que se informan al SIRE: su certificado SIRE (lo devuelve ARCA) se carga para informar anulaciones (E43). */
const CON_SIRE = new Set(['IVA', 'SUSS', 'GANANCIAS_EXTERIOR']);

function CertificadoSire({ fila }: { fila: Fila }) {
  const qc = useQueryClient();
  const [v, setV] = useState(fila.certificadoSire ?? '');
  useEffect(() => setV(fila.certificadoSire ?? ''), [fila.certificadoSire]);
  const guardar = async () => {
    if (v.trim() === (fila.certificadoSire ?? '')) return;
    try {
      await api(`/pagos/retenciones/${fila.id}/certificado-sire`, { metodo: 'PATCH', body: { certificadoSire: v.trim() || null } });
      notifications.show({ color: 'green', message: 'Certificado SIRE guardado' });
      void qc.invalidateQueries({ queryKey: ['/pagos/retenciones'] });
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof ErrorApi ? e.mensaje : 'Error inesperado' });
      setV(fila.certificadoSire ?? '');
    }
  };
  return <TextInput size="xs" w={170} maxLength={25} aria-label={`Certificado SIRE de ${fila.certificado}`} value={v} onChange={(e) => setV(e.currentTarget.value)} onBlur={() => void guardar()} />;
}

const detalle = (f: Fila) =>
  f.impuesto === 'GANANCIAS' ? `Régimen ${f.regimen}` : f.impuesto === 'GANANCIAS_EXTERIOR' ? `Ganancias exterior (${f.regimen})` : f.impuesto === 'IVA' || f.impuesto === 'SUSS' ? f.impuesto : `Jurisdicción ${f.jurisdiccion}`;

export function RetencionesPage() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(finDelMes());
  const [impuesto, setImpuesto] = useState<string | null>(null);
  const [anuladas, setAnuladas] = useState(false);
  const [error, setError] = useState('');
  const filtros = { desde, hasta, impuesto: impuesto ?? undefined, incluirAnuladas: anuladas ? 'true' : undefined };
  const q = useQuery({ queryKey: ['/pagos/retenciones', filtros], queryFn: () => api<Fila[]>('/pagos/retenciones', { query: filtros }), enabled: !!desde && !!hasta });
  const total = (q.data ?? []).filter((f) => !f.anulada).reduce((s, f) => s + Number(f.importe), 0);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Retenciones practicadas</Title>
      <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}>
        <Select label="Impuesto" clearable w={160} value={impuesto} onChange={setImpuesto} data={[{ value: 'GANANCIAS', label: 'Ganancias' }, { value: 'IIBB', label: 'IIBB' }, { value: 'IVA', label: 'IVA' }, { value: 'SUSS', label: 'SUSS' }, { value: 'GANANCIAS_EXTERIOR', label: 'Ganancias exterior' }]} />
        <Checkbox label="Incluir anuladas" checked={anuladas} onChange={(e) => setAnuladas(e.currentTarget.checked)} mb={8} />
        <Button variant="light" leftSection={<IconDownload size={16} />} onClick={() => descargar('/pagos/retenciones', { ...filtros, formato: 'xlsx' }, `retenciones-${desde}-${hasta}.xlsx`).catch((e) => setError(e.mensaje))}>
          Exportar a Excel
        </Button>
      </FiltroFechas>
      {(error || q.isError) && <Alert color="red" mt="md">{error || (q.error instanceof ErrorApi ? q.error.mensaje : 'Error')}</Alert>}
      <ScrollArea mt="md">
        <Table withTableBorder striped miw={900}>
          <Table.Thead>
            <Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Certificado</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>CUIT</Table.Th><Table.Th>Detalle</Table.Th><Table.Th ta="right">Base</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Certificado SIRE</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(q.data ?? []).map((f) => (
              <Table.Tr key={f.id} style={f.anulada ? { textDecoration: 'line-through' } : undefined}>
                <Table.Td>{formatoFecha(f.fechaPago)}</Table.Td><Table.Td>{f.certificado}</Table.Td><Table.Td>{f.razonSocial}</Table.Td><Table.Td>{f.cuit}</Table.Td>
                <Table.Td>{detalle(f)} · {f.alicuota === 'escala' ? 'Escala' : `${Number(f.alicuota)} %`}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(f.base)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.importe)}</Table.Td>
                <Table.Td>{CON_SIRE.has(f.impuesto) && <CertificadoSire fila={f} />}</Table.Td>
                <Table.Td>
                  <Button size="compact-xs" variant="subtle" onClick={() => void descargar(`/pagos/ordenes/${f.ordenPagoId}/certificados/${f.id}/pdf`, {}, `certificado-${f.certificado.replace(' ', '-')}.pdf`)}>PDF</Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {!q.data?.length && <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" size="sm" ta="center">Sin retenciones en el período</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
          {!!q.data?.length && <Table.Tfoot><Table.Tr><Table.Th colSpan={6}>Total</Table.Th><Table.Th ta="right">{formatoMoneda(total)}</Table.Th><Table.Th /><Table.Th /></Table.Tr></Table.Tfoot>}
        </Table>
      </ScrollArea>
    </Paper>
  );
}
