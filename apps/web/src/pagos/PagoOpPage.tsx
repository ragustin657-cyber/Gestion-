import { Alert, Button, Group, Loader, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar, ErrorApi } from '../api/cliente';
import { formatoMoneda, hoy } from '../compras/formato';
import { MedioEditable, MediosPago, pesosMedio } from './MediosPago';
import { OrdenesPagoPage } from './OrdenesPagoPage';
import { TablaRetenciones } from './TablaRetenciones';
import { numeroCertificado, numeroOP, OrdenPago, RetencionOP } from './tipos';

interface CuentaB { id: string; numero: string; monedaCodigo: string; banco: { nombre: string } }
interface Chequera { id: string; tipo: string; activa: boolean; cuentaBancaria: CuentaB }
interface Caja { id: string; nombre: string; monedaCodigo: string; activa: boolean }

function FormularioPago({ id, alTerminar }: { id: string; alTerminar: () => void }) {
  const qc = useQueryClient();
  const [fechaPago, setFechaPago] = useState(hoy());
  const [medios, setMedios] = useState<MedioEditable[]>([]);
  const [error, setError] = useState('');
  const [pagada, setPagada] = useState<OrdenPago | null>(null);
  const op = useQuery({ queryKey: ['/pagos/ordenes', id], queryFn: () => api<OrdenPago>(`/pagos/ordenes/${id}`) });
  const prev = useQuery({
    queryKey: ['/pagos/ordenes', id, 'retenciones', fechaPago],
    queryFn: () => api<{ retenciones: (RetencionOP & { id?: string })[]; totalRetenciones: string; netoPagar: string }>(`/pagos/ordenes/${id}/retenciones`, { query: { fechaPago } }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(fechaPago),
  });
  const cuentas = useQuery({ queryKey: ['/tesoreria/cuentas-bancarias', 'pago'], queryFn: () => api<CuentaB[]>('/tesoreria/cuentas-bancarias') });
  const chequeras = useQuery({ queryKey: ['/tesoreria/chequeras', 'pago'], queryFn: () => api<Chequera[]>('/tesoreria/chequeras') });
  const cajas = useQuery({ queryKey: ['/tesoreria/cajas', 'pago'], queryFn: () => api<Caja[]>('/tesoreria/cajas') });
  if (!op.data) return <Loader size="sm" />;
  const o = op.data;

  if (pagada)
    return (
      <Stack>
        <Alert color="green">Orden {numeroOP(pagada.numero)} pagada.</Alert>
        {pagada.retenciones.filter((r) => r.certificadoNumero).map((r) => (
          <Button key={r.id} variant="light" onClick={() => void descargar(`/pagos/ordenes/${pagada.id}/certificados/${r.id}/pdf`, {}, `certificado-${numeroCertificado(r).replace(' ', '-')}.pdf`)}>
            Descargar certificado {numeroCertificado(r)}
          </Button>
        ))}
        <Group justify="flex-end"><Button onClick={alTerminar}>Cerrar</Button></Group>
      </Stack>
    );

  const neto = prev.data?.netoPagar ?? o.netoPagar;
  const cubierto = medios.reduce((s, m) => s + pesosMedio(m, o.cotizacion), 0);
  async function pagar() {
    setError('');
    try {
      const r = await api<OrdenPago>(`/pagos/ordenes/${id}/pagar`, {
        metodo: 'POST',
        body: {
          version: o.version, fechaPago,
          medios: medios.map((m) => ({
            tipo: m.tipo, monedaCodigo: m.monedaCodigo, importe: Number(m.importe), cuentaBancariaId: m.cuentaBancariaId || null, cajaId: m.cajaId || null,
            chequeraId: m.chequeraId || null, chequeNumero: m.chequeNumero || null, chequeFechaPago: m.chequeFechaPago || null, referencia: m.referencia || null,
          })),
        },
      });
      setPagada(r);
      notifications.show({ color: 'green', message: 'Pago registrado' });
      void qc.invalidateQueries({ queryKey: ['/pagos/ordenes'] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      if (e instanceof ErrorApi && e.status === 409) void op.refetch();
    }
  }

  return (
    <Stack>
      <Text fw={700}>{o.tercero.razonSocial} · OP {numeroOP(o.numero)}</Text>
      <Text size="sm">{o.imputaciones.map((i) => i.comprobante).join(', ')}{o.anticipo ? ' · Anticipo' : ''}</Text>
      <TextInput label="Fecha de pago" type="date" w={200} value={fechaPago} onChange={(e) => setFechaPago(e.currentTarget.value)} />
      <Text size="sm" fw={600}>Retenciones a la fecha de pago</Text>
      {prev.isError ? <Alert color="red">{prev.error instanceof ErrorApi ? prev.error.mensaje : 'Error'}</Alert>
        : <TablaRetenciones retenciones={(prev.data?.retenciones ?? []).map((r, i) => ({ ...r, id: r.id ?? String(i), certificadoNumero: null, anulada: false }))} />}
      <Group justify="flex-end" gap="lg">
        <Text size="sm">Total {formatoMoneda(o.totalCancelarPesos)}</Text>
        <Text size="sm">Retenciones {formatoMoneda(prev.data?.totalRetenciones ?? o.totalRetenciones)}</Text>
        <Text fw={700}>Neto a pagar {formatoMoneda(neto)}</Text>
      </Group>
      <MediosPago medios={medios} onChange={setMedios} cotizacion={o.cotizacion} totalACubrir={neto}
        cuentas={(cuentas.data ?? []).map((c) => ({ id: c.id, etiqueta: `${c.banco.nombre} - ${c.numero}`, monedaCodigo: c.monedaCodigo }))}
        cajas={(cajas.data ?? []).filter((c) => c.activa).map((c) => ({ id: c.id, etiqueta: c.nombre, monedaCodigo: c.monedaCodigo }))}
        chequeras={(chequeras.data ?? []).filter((c) => c.activa).map((c) => ({ id: c.id, etiqueta: `${c.tipo === 'ECHEQ' ? 'E-cheq' : 'Física'} ${c.cuentaBancaria.banco.nombre} - ${c.cuentaBancaria.numero}`, monedaCodigo: c.cuentaBancaria.monedaCodigo }))} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button disabled={!medios.length || Math.round((Number(neto) - cubierto) * 100) !== 0} onClick={pagar}>Pagar</Button>
      </Group>
    </Stack>
  );
}

export const PagoOpPage = () => (
  <OrdenesPagoPage estadoFijo="APROBADA" titulo="Pago de órdenes de pago" detalle={(id, cerrar) => <FormularioPago id={id} alTerminar={cerrar} />} />
);
