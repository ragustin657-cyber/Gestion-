import { cuerpoExportacion, exentoParaExportacion, exportacionVacia, SeccionExportacion, type DatosExportacion } from './exportacion';
import { SelectorVendedor, useVendedores } from './ComisionesPages';
import { Button, Checkbox, Group, Modal, Paper, Select, Stack, Text, TextInput, Title, Alert } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { letraVenta, type LetraVenta } from '@gestion/shared';
import { api, ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda, hoy } from '../compras/formato';
import { accionesComprobante, NOMBRE_TIPO, numero, numeroVenta, TIPOS_VENTA, useClientes, useEmpresa, useOperacionVentas, usePuntosVenta, type ComprobanteVenta, type TipoVenta } from './comun';
import { EstadoEmision } from './EstadoEmision';
import { TablaPendientes, type Pendiente } from './PedidosRemitosPages';
import { convertirPrecio, precioSugerido, bonificacionSugerida } from './precios';
import { CamposFce } from './fce';
import { cuerpoRenglonVenta, GrillaVenta, renglonVacio, totalesVenta, TituloComprobante, type ArticuloVenta, type RenglonVentaEditable } from './GrillaVenta';

const sumarDias = (f: string, d: number) => {
  const x = new Date(`${f}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

/** Depósito a mostrar al editar: vacío si es el del punto de venta (así cambiar de punto de venta lo actualiza). */
export function depositoParaEditar(depositoId: string | null | undefined, depositoPuntoVenta: string | null | undefined): string | null {
  return depositoId && depositoId !== depositoPuntoVenta ? depositoId : null;
}

/** Renglón editable a partir de un comprobante guardado, conservando su origen (remito o pedido). */
/** Renglón de factura desde un remito pendiente: precio, alícuota y bonificación del pedido; sin pedido, la de la escala (E56). */
export function renglonDeRemito(rem: { remitoRenglonId: string; numero: string; articuloId: string | null; descripcion: string; precioPedido: string | null; alicuotaPedido: string | null; bonificacionPedido?: string | null }, cant: string, precio: string | null, bonificacionEscala: string | null, alicuotaArticulo?: string): RenglonVentaEditable {
  const bonif = rem.precioPedido ? rem.bonificacionPedido : bonificacionEscala;
  return {
    origen: 'REMITO', remitoRenglonId: rem.remitoRenglonId, etiqueta: rem.numero, articuloId: rem.articuloId, descripcion: rem.descripcion, cantidad: cant,
    precioUnitario: precio ? String(Number(precio)) : '', alicuota: rem.alicuotaPedido ?? alicuotaArticulo ?? '21',
    ...(bonif && Number(bonif) ? { bonificacionPct: String(Number(bonif)) } : {}),
  };
}

export function renglonDesdeComprobante(r: { articuloId: string | null; descripcion: string; cantidad: string; precioUnitario: string; alicuota: string; remitoRenglonId?: string | null; pedidoRenglonId?: string | null; bienUsoId?: string | null; bonificacionPct?: string }): RenglonVentaEditable {
  const origen = r.remitoRenglonId ? 'REMITO' : r.pedidoRenglonId ? 'PEDIDO' : 'DIRECTO';
  return {
    articuloId: r.articuloId, descripcion: r.descripcion, cantidad: String(Number(r.cantidad)), precioUnitario: String(Number(r.precioUnitario)), alicuota: r.alicuota,
    // E56: la bonificación guardada se respeta (no la reemplaza la escala)
    ...(r.bonificacionPct && Number(r.bonificacionPct) ? { bonificacionPct: String(Number(r.bonificacionPct)), bonificacionManual: true } : {}),
    origen, remitoRenglonId: r.remitoRenglonId ?? null, pedidoRenglonId: r.pedidoRenglonId ?? null, bienUsoId: r.bienUsoId ?? null,
    ...(r.bienUsoId ? { etiqueta: 'Bien de uso' } : {}),
    ...(origen === 'DIRECTO' ? {} : { etiqueta: origen === 'REMITO' ? 'Desde remito' : 'Desde pedido' }),
  };
}

/** Pulido E42: ¿los renglones en pantalla difieren de los guardados? (las percepciones guardadas quedan viejas hasta guardar) */
// Revisión E42: mismo lector de números que el guardado (separador de miles) y descripción sin espacios, como la guarda la API
// Revisión E51: también la bonificación (vacía = 0) y el descuento general
const pctClave = (s: string | undefined | null) => { const n = numero(String(s ?? '')); return Number.isFinite(n) ? n : 0; };
const claveRenglones = (rs: RenglonVentaEditable[]) => JSON.stringify(rs.map((r) => [r.descripcion.trim(), numero(String(r.cantidad)), numero(String(r.precioUnitario)), r.alicuota, pctClave(r.bonificacionPct)]));
export const renglonesCambiaron = (rs: RenglonVentaEditable[], c: ComprobanteVenta, descuentoPct = '') =>
  claveRenglones(rs) !== claveRenglones((c.renglones ?? []).map(renglonDesdeComprobante)) || pctClave(descuentoPct) !== Number(c.descuentoPct ?? 0);

/** Renglón de factura desde un renglón de pedido pendiente: precio (convertido a la moneda) y bonificación del pedido (E51). */
export interface PendientePedido { pedidoRenglonId: string; numero: string; articuloId: string | null; descripcion: string; pendiente: string; precioUnitario: string; alicuota: string; bonificacionPct?: string; monedaPedido: string; cotizacionPedido: string }
export function renglonDePedido(ped: PendientePedido, cant: string, moneda: string, cotizacion: string): RenglonVentaEditable {
  return {
    origen: 'PEDIDO', pedidoRenglonId: ped.pedidoRenglonId, etiqueta: ped.numero, articuloId: ped.articuloId, descripcion: ped.descripcion, cantidad: cant,
    precioUnitario: convertirPrecio(ped.precioUnitario, ped.monedaPedido, moneda, cotizacion ? String(numero(cotizacion)) : '', ped.cotizacionPedido), alicuota: ped.alicuota,
    ...(ped.bonificacionPct && Number(ped.bonificacionPct) ? { bonificacionPct: String(Number(ped.bonificacionPct)) } : {}),
  };
}

/** E54: devolución pendiente de acreditar, con la factura que facturó el remito de origen. */
export interface PendienteAcreditar { devolucionRenglonId: string; numero: string; articuloId: string | null; descripcion: string; pendiente: string; facturaId: string | null; factura: string | null; precioUnitario: string | null; bonificacionPct: string; alicuota: string | null; monedaCodigo: string | null }
export function renglonDeDevolucion(p: PendienteAcreditar): RenglonVentaEditable {
  return {
    origen: 'DEVOLUCION', devolucionRenglonId: p.devolucionRenglonId, etiqueta: p.numero, articuloId: p.articuloId, descripcion: p.descripcion, cantidad: p.pendiente,
    precioUnitario: p.precioUnitario ? String(Number(p.precioUnitario)) : '', alicuota: p.alicuota ?? '21',
    ...(Number(p.bonificacionPct) ? { bonificacionPct: String(Number(p.bonificacionPct)) } : {}),
  };
}

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
  // E51: descuento general (%)
  const [descuentoPct, setDescuentoPct] = useState('');
  // E58: factura de exportación (letra E)
  const [exportacion, setExportacion] = useState(false);
  const [datosExpo, setDatosExpo] = useState<DatosExportacion>(exportacionVacia());
  // E50: factura de crédito MiPyME
  const [fce, setFce] = useState(false);
  const [transferenciaFce, setTransferenciaFce] = useState<string | null>(null);
  const [anulacionFce, setAnulacionFce] = useState(false);
  // Vendedor: undefined = el que propone el sistema (pedido de origen o cliente); null = sin vendedor (E24 §4)
  const [vendedor, setVendedor] = useState<string | null | undefined>(undefined);
  const vendedores = useVendedores();
  const [aplicarAAsociado, setAplicarAAsociado] = useState(true);
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [devuelveMercaderia, setDevuelveMercaderia] = useState(false);
  const [avisosStock, setAvisosStock] = useState<string[]>([]);
  const [selectorPendientes, setSelectorPendientes] = useState(false);
  // E54: devoluciones pendientes de acreditar
  const [selectorDevoluciones, setSelectorDevoluciones] = useState(false);
  const [elegidasDev, setElegidasDev] = useState<string[]>([]);
  const [seleccionPend, setSeleccionPend] = useState<Record<string, string>>({});
  const pendientesQ = useQuery({
    queryKey: ['/ventas/pendientes-facturar', terceroId],
    queryFn: () => api<{ remitos: { remitoRenglonId: string; numero: string; articuloId: string | null; descripcion: string; pendiente: string; precioPedido: string | null; alicuotaPedido: string | null; bonificacionPedido?: string | null; monedaPedido: string | null; cotizacionPedido: string | null }[]; pedidos: PendientePedido[] }>('/ventas/pendientes-facturar', { query: { terceroId } }),
    enabled: selectorPendientes && !!terceroId,
  }).data;
  const pendientesFacturar: Pendiente[] = [
    ...(pendientesQ?.remitos ?? []).map((r) => ({ id: r.remitoRenglonId, origen: 'REMITO' as const, numero: r.numero, descripcion: r.descripcion, pendiente: String(Number(r.pendiente)) })),
    ...(pendientesQ?.pedidos ?? []).map((r) => ({ id: r.pedidoRenglonId, origen: 'PEDIDO' as const, numero: r.numero, descripcion: r.descripcion, pendiente: String(Number(r.pendiente)) })),
  ];
  async function agregarPendientes() {
    const nuevos: RenglonVentaEditable[] = [];
    for (const [id, cant] of Object.entries(seleccionPend)) {
      const rem = pendientesQ?.remitos.find((x) => x.remitoRenglonId === id);
      if (rem) {
        const art = articulos.find((a) => a.value === rem.articuloId);
        // Precio y alícuota acordados en el pedido (convertidos a la moneda de la factura); sin pedido, el de la lista
        const precio = rem.precioPedido
          ? convertirPrecio(rem.precioPedido, rem.monedaPedido!, moneda, cotizacion ? String(numero(cotizacion)) : '', rem.cotizacionPedido!)
          : rem.articuloId ? await precioSugerido({ terceroId, articuloId: rem.articuloId, monedaCodigo: moneda, cotizacion: cotizacion ? String(numero(cotizacion)) : '' }) : null;
        // E56 (revisión): sin pedido, la bonificación de la escala, igual que la facturación por lotes
        const escala = !rem.precioPedido && rem.articuloId && tipo === 'FACTURA' ? await bonificacionSugerida(rem.articuloId, String(numero(cant))) : null;
        nuevos.push(renglonDeRemito(rem, cant, precio, escala, art ? String(Number(art.alicuotaIva)) : undefined));
        continue;
      }
      const ped = pendientesQ?.pedidos.find((x) => x.pedidoRenglonId === id);
      if (ped) nuevos.push(renglonDePedido(ped, cant, moneda, cotizacion));
    }
    setRenglones([...renglones.filter((r) => r.descripcion), ...nuevos]);
    setSeleccionPend({});
    setSelectorPendientes(false);
  }
  const devoluciones = useQuery({ queryKey: ['/ventas/remitos/pendientes-acreditar', terceroId], queryFn: () => api<PendienteAcreditar[]>('/ventas/remitos/pendientes-acreditar', { query: { terceroId } }), enabled: selectorDevoluciones && !!terceroId }).data ?? [];
  function agregarDevoluciones() {
    const sel = devoluciones.filter((d) => elegidasDev.includes(d.devolucionRenglonId));
    if (!asociadoId && sel[0]?.facturaId) setAsociadoId(sel[0].facturaId);
    setRenglones([...renglones.filter((r) => r.descripcion), ...sel.map(renglonDeDevolucion)]);
    setElegidasDev([]);
    setSelectorDevoluciones(false);
  }
  const { puede } = useAuth();
  const bienesActivos = useQuery({ queryKey: ['/bienes-uso', 'activos'], queryFn: () => api<{ id: string; numero: number; descripcion: string }[]>('/bienes-uso', { query: { estado: 'ACTIVO' } }), enabled: puede('bienes.ver') || puede('venta.emitir') }).data ?? [];
  const depositos = (useQuery({ queryKey: ['/depositos', 'ventas'], queryFn: () => api<{ id: string; nombre: string }[]>('/depositos') }).data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
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
      setMoneda(c.monedaCodigo); setCotizacion(c.monedaCodigo === 'USD' ? String(Number(c.cotizacion)) : ''); setAsociadoId(c.comprobanteAsociadoId); setDescuentoPct(c.descuentoPct && Number(c.descuentoPct) ? String(Number(c.descuentoPct)) : ''); setFce(!!c.fce); setTransferenciaFce(c.transferenciaFce ?? null); setAnulacionFce(!!c.anulacionFce); setVendedor(c.vendedorId ?? null); setAplicarAAsociado(c.aplicarAAsociado); setDepositoId(depositoParaEditar(c.depositoId, puntos.find((x) => x.id === c.puntoVentaId)?.depositoId)); setDevuelveMercaderia(!!c.devuelveMercaderia);
      setRenglones((c.renglones ?? []).map(renglonDesdeComprobante));
      setExportacion(!!c.exportacion);
      setDatosExpo(c.exportacion ? { tipoExportacion: c.tipoExportacion ?? 'SERVICIOS', paisDestino: c.paisDestino ?? null, incoterm: c.incoterm ?? null, incotermDescripcion: c.incotermDescripcion ?? '', formaPago: c.formaPago ?? '', idioma: (c.idioma ?? 1) as 1 | 2 | 3, permisoExistente: c.permisoExistente ?? null, permisos: c.permisos ?? [] } : exportacionVacia());
    }).catch(() => op.setError('No se pudo cargar el comprobante'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEditar]);

  /** E50: nota de crédito de anulación de una FCE rechazada (desde la lista de facturas de crédito). */
  const anularFce = params.get('anularFce');
  useEffect(() => {
    if (!anularFce) return;
    void api<ComprobanteVenta>(`/ventas/comprobantes/${anularFce}`).then((c) => {
      setTipo('NOTA_CREDITO'); setTerceroId(c.terceroId); setPuntoVentaId(c.puntoVentaId); setConcepto(c.concepto); setMoneda(c.monedaCodigo);
      setCotizacion(c.monedaCodigo === 'USD' ? String(Number(c.cotizacion)) : ''); setAsociadoId(c.id); setFce(true); setAnulacionFce(true); setDescuentoPct(c.descuentoPct && Number(c.descuentoPct) ? String(Number(c.descuentoPct)) : '');
      setServDesde(c.fechaServicioDesde?.slice(0, 10) ?? ''); setServHasta(c.fechaServicioHasta?.slice(0, 10) ?? '');
      setRenglones((c.renglones ?? []).map((r) => ({ ...renglonDesdeComprobante(r), origen: 'DIRECTO', remitoRenglonId: null, pedidoRenglonId: null, etiqueta: undefined })));
    }).catch(() => op.setError('No se pudo cargar la factura de crédito'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anularFce]);

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
    else if (empresa && cliente) letra = letraVenta(empresa.condicionIva, cliente.condicionIva, exportacion);
  } catch { /* la empresa no emite: lo informa el servidor */ }

  const cuerpo = () => ({
    terceroId, puntoVentaId, tipo, concepto, fecha, fechaVencimiento,
    fechaServicioDesde: concepto === 'PRODUCTOS' ? null : servDesde || null, fechaServicioHasta: concepto === 'PRODUCTOS' ? null : servHasta || null,
    fechaVencimientoPago: concepto === 'PRODUCTOS' || fce ? null : vencePago || null,
    fce, transferenciaFce: tipo === 'FACTURA' && fce ? transferenciaFce : null, anulacionFce: tipo !== 'FACTURA' && fce ? anulacionFce : null,
    monedaCodigo: moneda, cotizacion: moneda === 'USD' && cotizacion ? numero(cotizacion) : null,
    comprobanteAsociadoId: tipo === 'FACTURA' ? null : asociadoId, aplicarAAsociado, vendedorId: tipo === 'FACTURA' ? vendedor : undefined,
    depositoId, devuelveMercaderia: tipo === 'NOTA_CREDITO' && devuelveMercaderia,
    descuentoPct: descuentoPct.trim() ? numero(descuentoPct) : 0,
    exportacion, ...(exportacion ? cuerpoExportacion(datosExpo) : {}),
    renglones: renglones.map(cuerpoRenglonVenta),
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
    setAvisosStock((g as ComprobanteVenta & { advertencias?: string[] }).advertencias ?? []);
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
    setFce(false); setTransferenciaFce(null); setAnulacionFce(false); setDescuentoPct('');
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
            onChange={(v) => { setTerceroId(v); setAsociadoId(null); setVendedor(undefined); const c = clientes.find((x) => x.id === v); if (c?.diasPago) setFechaVencimiento(sumarDias(fecha, c.diasPago)); const ext = !!c?.residenteExterior; setExportacion(ext); if (ext) { setMoneda('USD'); setRenglones(exentoParaExportacion(renglones)); } }} disabled={!editable} />
          <Select label="Punto de venta" w={170} data={puntos.map((p) => ({ value: p.id, label: `${String(p.numero).padStart(4, '0')}${p.descripcion ? ` ${p.descripcion}` : ''}` }))} value={puntoVentaId} onChange={setPuntoVentaId} disabled={!editable} />
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} disabled={!editable} />
          <TextInput label="Vencimiento" type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.currentTarget.value)} disabled={!editable} />
          <Select label="Concepto" w={200} allowDeselect={false} value={concepto} onChange={(v) => setConcepto(v ?? 'PRODUCTOS')} disabled={!editable}
            data={[{ value: 'PRODUCTOS', label: 'Productos' }, { value: 'SERVICIOS', label: 'Servicios' }, { value: 'PRODUCTOS_Y_SERVICIOS', label: 'Productos y servicios' }]} />
          <Select label="Depósito" w={180} clearable placeholder="El del punto de venta" data={depositos} value={depositoId} onChange={setDepositoId} disabled={!editable} />
          <Select label="Moneda" w={110} allowDeselect={false} value={moneda} onChange={(v) => setMoneda(v ?? 'ARS')} data={['ARS', 'USD']} disabled={!editable} />
          {tipo === 'FACTURA' && <SelectorVendedor vendedores={vendedores} value={vendedor === undefined ? (cliente?.vendedorId ?? null) : vendedor} onChange={setVendedor} disabled={!editable} />}
          {moneda === 'USD' && <TextInput label="Cotización" w={120} inputMode="decimal" placeholder="Del día" value={cotizacion} onChange={(e) => setCotizacion(e.currentTarget.value)} disabled={!editable} />}
        </Group>
        {concepto !== 'PRODUCTOS' && (
          <Group mt="sm" align="flex-end">
            <TextInput label="Servicio desde" type="date" value={servDesde} onChange={(e) => setServDesde(e.currentTarget.value)} disabled={!editable} />
            <TextInput label="Servicio hasta" type="date" value={servHasta} onChange={(e) => setServHasta(e.currentTarget.value)} disabled={!editable} />
            {!fce && <TextInput label="Vencimiento del pago" type="date" value={vencePago} onChange={(e) => setVencePago(e.currentTarget.value)} disabled={!editable} />}
          </Group>
        )}
        <CamposFce tipo={tipo} terceroId={terceroId} fecha={fecha} totalPesos={Number(totalesVenta(renglones, letra, descuentoPct || '0').total) * (moneda === 'USD' && cotizacion ? numero(cotizacion) : 1)}
          fce={fce} onFce={setFce} transferencia={transferenciaFce} onTransferencia={setTransferenciaFce} anulacion={anulacionFce} onAnulacion={setAnulacionFce} disabled={!editable} fijo />
        {tipo !== 'FACTURA' && (
          <Group mt="sm" align="flex-end">
            <Select label="Comprobante asociado" w={360} searchable value={asociadoId} onChange={(v) => { setAsociadoId(v); setFce(!!asociables.find((a) => a.id === v)?.fce); }} disabled={!editable}
              data={asociables.map((a) => ({ value: a.id, label: `${NOMBRE_TIPO[a.tipo]} ${a.letra} ${numeroVenta(a.puntoVenta, a.numero)} · saldo ${formatoMoneda(a.saldo, a.monedaCodigo)}` }))} />
            {tipo === 'NOTA_CREDITO' && <Checkbox label="Aplicar a la factura asociada" checked={aplicarAAsociado} onChange={(e) => setAplicarAAsociado(e.currentTarget.checked)} disabled={!editable} />}
            {tipo === 'NOTA_CREDITO' && <Checkbox label="Con devolución de mercadería" checked={devuelveMercaderia} onChange={(e) => setDevuelveMercaderia(e.currentTarget.checked)} disabled={!editable} />}
          </Group>
        )}

        <Title order={5} mt="lg" mb="xs">Renglones</Title>
        {editable && tipo === 'NOTA_CREDITO' && terceroId && <Group><Button size="xs" variant="default" onClick={() => setSelectorDevoluciones(true)}>Agregar desde devoluciones</Button></Group>}
        {editable && tipo !== 'NOTA_CREDITO' && terceroId && <Group>
          {tipo === 'FACTURA' && <Button size="xs" variant="default" onClick={() => setSelectorPendientes(true)}>Agregar desde remitos y pedidos</Button>}
          {(puede('bienes.ver') || puede('venta.emitir')) && <Select size="xs" w={300} placeholder="Agregar bien de uso…" searchable value={null} data={bienesActivos.filter((b) => !renglones.some((r) => r.bienUsoId === b.id)).map((b) => ({ value: b.id, label: `N° ${b.numero} - ${b.descripcion}` }))}
            onChange={(v) => { const b = bienesActivos.find((x) => x.id === v); if (b) setRenglones([...renglones.filter((r) => r.descripcion), { articuloId: null, bienUsoId: b.id, etiqueta: 'Bien de uso', descripcion: b.descripcion, cantidad: '1', precioUnitario: '', alicuota: '21' }]); }} />}
        </Group>}
        {cliente?.residenteExterior && <Checkbox label="Exportación (factura E)" checked={exportacion} disabled={!editable} onChange={(e) => { const si = e.currentTarget.checked; setExportacion(si); if (si) setRenglones(exentoParaExportacion(renglones)); }} />}
        {exportacion && <Paper withBorder p="sm"><SeccionExportacion valor={datosExpo} onChange={setDatosExpo} disabled={!editable} /></Paper>}
        <GrillaVenta renglones={renglones} onChange={(r) => setRenglones(exportacion ? exentoParaExportacion(r) : r)} letra={letra} moneda={moneda} articulos={articulos} descuentoPct={descuentoPct} onDescuento={setDescuentoPct} disabled={!editable} percepciones={actual?.percepcionesDetalle} percepcionesDesactualizadas={!!actual && renglonesCambiaron(renglones, actual, descuentoPct)}
          sugerirPrecio={(articuloId) => precioSugerido({ terceroId, articuloId, monedaCodigo: moneda, cotizacion: cotizacion ? String(numero(cotizacion)) : '' })}
          sugerirBonificacion={tipo === 'FACTURA' ? bonificacionSugerida : undefined} />
        <Modal opened={selectorDevoluciones} onClose={() => setSelectorDevoluciones(false)} title="Devoluciones pendientes de acreditar" size="xl">
          {devoluciones.length ? devoluciones.map((d) => (
            <Checkbox key={d.devolucionRenglonId} mb={6} label={`${d.numero} · ${d.descripcion} · ${Number(d.pendiente).toLocaleString('es-AR')} · factura ${d.factura ?? '—'}`}
              checked={elegidasDev.includes(d.devolucionRenglonId)} onChange={(e) => setElegidasDev(e.currentTarget.checked ? [...elegidasDev, d.devolucionRenglonId] : elegidasDev.filter((x) => x !== d.devolucionRenglonId))} />
          )) : <Text size="sm" c="dimmed">El cliente no tiene devoluciones pendientes de acreditar.</Text>}
          <Group mt="md"><Button disabled={!elegidasDev.length} onClick={agregarDevoluciones}>Agregar</Button></Group>
        </Modal>
        <Modal opened={selectorPendientes} onClose={() => setSelectorPendientes(false)} title="Remitos y pedidos pendientes de facturar" size="xl">
          <TablaPendientes pendientes={pendientesFacturar} seleccion={seleccionPend} onChange={setSeleccionPend} />
          <Group mt="md"><Button disabled={!Object.keys(seleccionPend).length} onClick={() => void agregarPendientes()}>Agregar</Button></Group>
        </Modal>

        {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
        {actual && <Stack mt="sm"><EstadoEmision comprobante={actual} enviando={op.enviando} onReintentar={() => void emitirActual(actual.id)} /></Stack>}
        <Group justify="flex-end" mt="md">
          {actual && <Button variant="default" onClick={nuevo}>Nuevo comprobante</Button>}
          {avisosStock.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
          {editable && <Button variant="default" loading={op.enviando} disabled={!terceroId || !puntoVentaId} onClick={() => void guardar(false)}>Guardar</Button>}
          {editable && <Button loading={op.enviando} disabled={!terceroId || !puntoVentaId} onClick={() => void guardar(true)}>Emitir</Button>}
        </Group>
      </Paper>
    </Stack>
  );
}
