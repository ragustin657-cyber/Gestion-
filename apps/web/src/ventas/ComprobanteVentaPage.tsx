import { Button, Checkbox, Group, Paper, Select, Stack, TextInput, Title, Alert } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { letraVenta, type LetraVenta } from '@gestion/shared';
import { api, ErrorApi } from '../api/cliente';
import { formatoMoneda, hoy } from '../compras/formato';
import { accionesComprobante, NOMBRE_TIPO, numero, numeroVenta, TIPOS_VENTA, useClientes, useEmpresa, useOperacionVentas, usePuntosVenta, type ComprobanteVenta, type TipoVenta } from './comun';
import { EstadoEmision } from './EstadoEmision';
import { alicuotaDe, GrillaVenta, renglonVacio, TituloComprobante, type ArticuloVenta, type RenglonVentaEditable } from './GrillaVenta';

const sumarDias = (f: string, d: number) => {
  const x = new Date(`${f}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

export function ComprobanteVentaPage() {
  const empresa = useEmpresa();
  const clientes = useClientes();
  const puntos = usePuntosVenta().filter((p) => p.electronico);
  const articulos: ArticuloVenta[] = (useQuery({ queryKey: ['/articulos', 'venta'], queryFn: () => api<{ items: { id: string; codigo: string; descripcion: string; alicuotaIva: string; activo: boolean }[] }>('/articulos', { query: { porPagina: 200 } }) }).data?.items ?? [])
    .filter((a) => a.activo).map((a) => ({ value: a.id, label: `${a.codigo} ${a.descripcion}`, descripcion: a.descripcion, alicuotaIva: a.alicuotaIva }));
  const op = useOperacionVentas();

  const [tipo, setTipo] = useState<TipoVenta>('FACTURA');
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [puntoVentaId, setPuntoVentaId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [fechaVencimiento, setFechaVencimiento] = useState(sumarDias(hoy(), 30));
  const [concepto, setConcepto] = useState('PRODUCTOS');
  const [servDesde, setServDesde] = useState('');
  const [servHasta, setServHasta] = useState('');
  const [vencePago, setVencePago] = useState('');
  const [moneda, setMoneda] = useState('ARS');
  const [cotizacion, setCotizacion] = useState('');
  const [asociadoId, setAsociadoId] = useState<string | null>(null);
  const [aplicarAAsociado, setAplicarAAsociado] = useState(true);
  const [renglones, setRenglones] = useState<RenglonVentaEditable[]>([renglonVacio()]);
  const [actual, setActual] = useState<ComprobanteVenta | null>(null);
  const [params] = useSearchParams();
  const idEditar = params.get('id');

  /** Editar un comprobante pendiente o rechazado (desde la consulta de comprobantes). */
  useEffect(() => {
    if (!idEditar) return;
    void api<ComprobanteVenta>(`/ventas/comprobantes/${idEditar}`).then((c) => {
      const f = (x: string | null) => (x ? x.slice(0, 10) : '');
      setActual(c); setTipo(c.tipo); setTerceroId(c.terceroId); setPuntoVentaId(c.puntoVentaId); setFecha(f(c.fecha)); setFechaVencimiento(f(c.fechaVencimiento));
      setConcepto(c.concepto); setServDesde(f(c.fechaServicioDesde)); setServHasta(f(c.fechaServicioHasta)); setVencePago(f(c.fechaVencimientoPago));
      setMoneda(c.monedaCodigo); setCotizacion(c.monedaCodigo === 'USD' ? String(Number(c.cotizacion)) : ''); setAsociadoId(c.comprobanteAsociadoId); setAplicarAAsociado(c.aplicarAAsociado);
      setRenglones((c.renglones ?? []).map((r) => ({ articuloId: r.articuloId, descripcion: r.descripcion, cantidad: String(Number(r.cantidad)), precioUnitario: String(Number(r.precioUnitario)), alicuota: r.alicuota })));
    }).catch(() => op.setError('No se pudo cargar el comprobante'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEditar]);

  const cliente = clientes.find((c) => c.id === terceroId);
  const asociables = useQuery({
    queryKey: ['/ventas/comprobantes', 'asociables', terceroId],
    queryFn: () => api<{ items: ComprobanteVenta[] }>('/ventas/comprobantes', { query: { terceroId, estado: 'AUTORIZADO', porPagina: 200 } }),
    enabled: !!terceroId && tipo !== 'FACTURA',
  }).data?.items.filter((c) => c.tipo !== 'NOTA_CREDITO') ?? [];
  const asociado = asociables.find((a) => a.id === asociadoId);
  let letra: LetraVenta = 'B';
  try {
    if (asociado) letra = asociado.letra as LetraVenta;
    else if (empresa && cliente) letra = letraVenta(empresa.condicionIva, cliente.condicionIva);
  } catch { /* la empresa no emite: lo informa el servidor */ }

  const cuerpo = () => ({
    terceroId, puntoVentaId, tipo, concepto, fecha, fechaVencimiento,
    fechaServicioDesde: concepto === 'PRODUCTOS' ? null : servDesde || null, fechaServicioHasta: concepto === 'PRODUCTOS' ? null : servHasta || null,
    fechaVencimientoPago: concepto === 'PRODUCTOS' ? null : vencePago || null,
    monedaCodigo: moneda, cotizacion: moneda === 'USD' && cotizacion ? numero(cotizacion) : null,
    comprobanteAsociadoId: tipo === 'FACTURA' ? null : asociadoId, aplicarAAsociado,
    renglones: renglones.map((r) => ({ articuloId: r.articuloId, descripcion: r.descripcion, cantidad: numero(r.cantidad), precioUnitario: numero(r.precioUnitario), alicuota: alicuotaDe(r.alicuota) })),
  });

  async function recargar(id: string) {
    setActual(await api<ComprobanteVenta>(`/ventas/comprobantes/${id}`));
  }

  async function guardar(emitir: boolean) {
    let c = actual;
    const g = await op.ejecutar(
      () => (c ? api<ComprobanteVenta>(`/ventas/comprobantes/${c.id}`, { metodo: 'PUT', body: { ...cuerpo(), version: c.version } }) : api<ComprobanteVenta>('/ventas/comprobantes', { metodo: 'POST', body: cuerpo() })),
      () => 'Comprobante guardado',
    );
    if (!g) return;
    c = g;
    setActual(g);
    if (emitir) await emitirActual(g.id);
  }

  async function emitirActual(id: string) {
    const r = await op.ejecutar(() => api<ComprobanteVenta & { advertencias: string[] }>(`/ventas/comprobantes/${id}/emitir`, { metodo: 'POST' }),
      (x) => `${NOMBRE_TIPO[x.tipo]} ${x.letra} ${numeroVenta(x.puntoVenta, x.numero)} autorizada${x.advertencias?.length ? ` (${x.advertencias.join('; ')})` : ''}`);
    if (!r) {
      try {
        await recargar(id);
      } catch (e) {
        op.setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      }
      return;
    }
    setActual(r);
  }

  function nuevo() {
    setActual(null);
    setRenglones([renglonVacio()]);
    setAsociadoId(null);
    op.setError('');
  }

  const editable = !actual || accionesComprobante(actual).editar;
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={3}>Comprobante de venta</Title>
          <TituloComprobante tipo={tipo} letra={letra} />
        </Group>
        <Group align="flex-end" wrap="wrap">
          <Select label="Tipo" w={170} allowDeselect={false} data={TIPOS_VENTA} value={tipo} onChange={(v) => { setTipo((v ?? 'FACTURA') as TipoVenta); setAsociadoId(null); }} disabled={!editable} />
          <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId}
            onChange={(v) => { setTerceroId(v); setAsociadoId(null); const c = clientes.find((x) => x.id === v); if (c?.diasPago) setFechaVencimiento(sumarDias(fecha, c.diasPago)); }} disabled={!editable} />
          <Select label="Punto de venta" w={170} data={puntos.map((p) => ({ value: p.id, label: `${String(p.numero).padStart(4, '0')}${p.descripcion ? ` ${p.descripcion}` : ''}` }))} value={puntoVentaId} onChange={setPuntoVentaId} disabled={!editable} />
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} disabled={!editable} />
          <TextInput label="Vencimiento" type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.currentTarget.value)} disabled={!editable} />
          <Select label="Concepto" w={200} allowDeselect={false} value={concepto} onChange={(v) => setConcepto(v ?? 'PRODUCTOS')} disabled={!editable}
            data={[{ value: 'PRODUCTOS', label: 'Productos' }, { value: 'SERVICIOS', label: 'Servicios' }, { value: 'PRODUCTOS_Y_SERVICIOS', label: 'Productos y servicios' }]} />
          <Select label="Moneda" w={110} allowDeselect={false} value={moneda} onChange={(v) => setMoneda(v ?? 'ARS')} data={['ARS', 'USD']} disabled={!editable} />
          {moneda === 'USD' && <TextInput label="Cotización" w={120} inputMode="decimal" placeholder="Del día" value={cotizacion} onChange={(e) => setCotizacion(e.currentTarget.value)} disabled={!editable} />}
        </Group>
        {concepto !== 'PRODUCTOS' && (
          <Group mt="sm" align="flex-end">
            <TextInput label="Servicio desde" type="date" value={servDesde} onChange={(e) => setServDesde(e.currentTarget.value)} disabled={!editable} />
            <TextInput label="Servicio hasta" type="date" value={servHasta} onChange={(e) => setServHasta(e.currentTarget.value)} disabled={!editable} />
            <TextInput label="Vencimiento del pago" type="date" value={vencePago} onChange={(e) => setVencePago(e.currentTarget.value)} disabled={!editable} />
          </Group>
        )}
        {tipo !== 'FACTURA' && (
          <Group mt="sm" align="flex-end">
            <Select label="Comprobante asociado" w={360} searchable value={asociadoId} onChange={setAsociadoId} disabled={!editable}
              data={asociables.map((a) => ({ value: a.id, label: `${NOMBRE_TIPO[a.tipo]} ${a.letra} ${numeroVenta(a.puntoVenta, a.numero)} · saldo ${formatoMoneda(a.saldo, a.monedaCodigo)}` }))} />
            {tipo === 'NOTA_CREDITO' && <Checkbox label="Aplicar a la factura asociada" checked={aplicarAAsociado} onChange={(e) => setAplicarAAsociado(e.currentTarget.checked)} disabled={!editable} />}
          </Group>
        )}

        <Title order={5} mt="lg" mb="xs">Renglones</Title>
        <GrillaVenta renglones={renglones} onChange={setRenglones} letra={letra} moneda={moneda} articulos={articulos} />

        {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
        {actual && <Stack mt="sm"><EstadoEmision comprobante={actual} enviando={op.enviando} onReintentar={() => void emitirActual(actual.id)} /></Stack>}
        <Group justify="flex-end" mt="md">
          {actual && <Button variant="default" onClick={nuevo}>Nuevo comprobante</Button>}
          {editable && <Button variant="default" loading={op.enviando} disabled={!terceroId || !puntoVentaId} onClick={() => void guardar(false)}>Guardar</Button>}
          {editable && <Button loading={op.enviando} disabled={!terceroId || !puntoVentaId} onClick={() => void guardar(true)}>Emitir</Button>}
        </Group>
      </Paper>
    </Stack>
  );
}
