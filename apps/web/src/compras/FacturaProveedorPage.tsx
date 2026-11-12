import { ActionIcon, Alert, Button, Divider, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CondicionIva, discriminaIva, Letra, letrasValidas } from '@gestion/shared';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { useCuentasImputables } from '../abm/opciones';
import { useMaestrosCompras } from './datos';
import { formatoMoneda, hoy, numeroInterno } from './formato';
import { bienParaApi, useRubros } from '../bienes-uso/comun';
import { GrillaRenglones, RenglonEditable, renglonVacio, totalesGrilla } from './GrillaRenglones';
import { GuardarComprobante } from './GuardarComprobante';
import { Seleccion, SelectorPendientes } from './SelectorPendientes';

interface PendienteIR {
  informeRecepcionRenglonId: string; irNumero: number; remitoNumero: string; ocNumero: number; articuloId: string | null; descripcion: string;
  precioUnitario: string; bonificacionPct: string; alicuotaIva: string; centroCostoId: string | null; pendiente: string;
}
interface PendienteOC {
  ordenCompraRenglonId: string; ocNumero: number; articuloId: string | null; descripcion: string; precioUnitario: string; bonificacionPct: string;
  alicuotaIva: string; centroCostoId: string | null; pendiente: string;
}
type Origen = { origen: 'RECEPCION'; informeRecepcionRenglonId: string } | { origen: 'ORDEN_COMPRA'; ordenCompraRenglonId: string } | { origen: 'DIRECTO' };

const TIPOS = [
  { value: 'FACTURA', label: 'Factura' }, { value: 'NOTA_DEBITO', label: 'Nota de débito' },
  { value: 'NOTA_CREDITO', label: 'Nota de crédito' }, { value: 'TICKET', label: 'Ticket' },
];

const inicial = () => ({
  terceroId: '', tipo: 'FACTURA', letra: '', puntoVenta: '', numero: '', fechaEmision: hoy(), fechaContable: '', fechaVencimiento: '',
  monedaCodigo: 'ARS', cotizacion: '', depositoId: '', percepcionIva: '', impuestosInternos: '', noGravado: '', exento: '', totalDeclarado: '',
});
const n = (s: string) => (s === '' ? 0 : Number(s));

export function FacturaProveedorPage() {
  const { sesion } = useAuth();
  const qc = useQueryClient();
  const m = useMaestrosCompras();
  const cuentas = useCuentasImputables();
  const [cab, setCab] = useState(inicial());
  const [iibb, setIibb] = useState<{ jurisdiccion: string; importe: string }[]>([]);
  const [renglones, setRenglones] = useState<RenglonEditable[]>([]);
  const rubros = useRubros().data ?? [];
  const [selector, setSelector] = useState<'RECEPCION' | 'ORDEN_COMPRA' | null>(null);
  const [pendientes, setPendientes] = useState<(PendienteIR | PendienteOC)[]>([]);
  const [seleccion, setSeleccion] = useState<Seleccion>({});
  const [errorSelector, setErrorSelector] = useState('');

  const proveedor = m.proveedores.find((p) => p.id === cab.terceroId);
  const letras: Letra[] = useMemo(
    () => (proveedor && sesion?.empresa?.condicionIva ? letrasValidas(sesion.empresa.condicionIva as CondicionIva, proveedor.condicionIva as CondicionIva) : ['A', 'B', 'C', 'M']),
    [proveedor, sesion?.empresa?.condicionIva],
  );
  const esTicket = cab.tipo === 'TICKET';
  const esNotaCD = cab.tipo === 'NOTA_CREDITO' || cab.tipo === 'NOTA_DEBITO';
  const discrimina = !esTicket && discriminaIva((cab.letra || null) as Letra | null);
  const extras = {
    percepcionIva: String(n(cab.percepcionIva)), percepcionesIibb: iibb.map((x) => String(n(x.importe))),
    impuestosInternos: String(n(cab.impuestosInternos)), noGravado: String(n(cab.noGravado)), exento: String(n(cab.exento)),
  };
  const tot = totalesGrilla(renglones, discrimina, extras);
  const diferencia = cab.totalDeclarado === '' ? null : n(cab.totalDeclarado) - Number(tot.total);

  async function abrirSelector(tipo: 'RECEPCION' | 'ORDEN_COMPRA') {
    setErrorSelector('');
    setSeleccion({});
    setSelector(tipo);
    const ruta = tipo === 'RECEPCION' ? '/compras/recepciones/pendientes-facturar' : '/compras/ordenes/pendientes-facturar';
    setPendientes(await api<(PendienteIR | PendienteOC)[]>(ruta, { query: { terceroId: cab.terceroId } }));
  }

  function agregarSeleccion() {
    const nuevos: RenglonEditable[] = Object.entries(seleccion).map(([clave, cantidad]) => {
      const p = pendientes.find((x) => ('informeRecepcionRenglonId' in x ? x.informeRecepcionRenglonId : x.ordenCompraRenglonId) === clave)!;
      const origen: Origen = 'informeRecepcionRenglonId' in p
        ? { origen: 'RECEPCION', informeRecepcionRenglonId: p.informeRecepcionRenglonId }
        : { origen: 'ORDEN_COMPRA', ordenCompraRenglonId: p.ordenCompraRenglonId };
      return {
        articuloId: p.articuloId, descripcion: p.descripcion, cantidad, precioUnitario: String(Number(p.precioUnitario)),
        bonificacionPct: String(Number(p.bonificacionPct)), alicuotaIva: String(Number(p.alicuotaIva)), centroCostoId: p.centroCostoId,
        soloLectura: ['articuloId'], origen,
        etiqueta: 'irNumero' in p ? `IR ${numeroInterno(p.irNumero)} · OC ${numeroInterno(p.ocNumero)}` : `OC ${numeroInterno(p.ocNumero)}`,
      };
    });
    setRenglones([...renglones.filter((r) => r.descripcion || r.origen), ...nuevos]);
    setSelector(null);
  }

  const cuerpo = () => ({
    terceroId: cab.terceroId, tipo: cab.tipo, letra: esTicket ? null : cab.letra || null, puntoVenta: n(cab.puntoVenta), numero: n(cab.numero),
    fechaEmision: cab.fechaEmision, fechaContable: cab.fechaContable || cab.fechaEmision, fechaVencimiento: cab.fechaVencimiento || null,
    monedaCodigo: cab.monedaCodigo, cotizacion: cab.monedaCodigo === 'USD' && cab.cotizacion ? n(cab.cotizacion) : null,
    totalDeclarado: n(cab.totalDeclarado), percepcionIva: n(cab.percepcionIva), impuestosInternos: n(cab.impuestosInternos),
    noGravado: n(cab.noGravado), exento: n(cab.exento), depositoId: cab.depositoId || null,
    percepcionesIibb: iibb.filter((x) => n(x.importe) > 0).map((x) => ({ jurisdiccion: x.jurisdiccion, importe: n(x.importe) })),
    renglones: renglones.map((r) => ({
      ...((r.origen as Origen | undefined) ?? { origen: 'DIRECTO' }),
      articuloId: r.articuloId || null, descripcion: r.descripcion, cantidad: Number(r.cantidad), precioUnitario: Number(r.precioUnitario),
      bonificacionPct: n(r.bonificacionPct), alicuotaIva: Number(r.alicuotaIva), centroCostoId: r.centroCostoId || null,
      cuentaContableId: r.origen ? null : r.cuentaContableId || null,
      ...(!r.origen && r.cuentaContableId && rubros.some((x) => x.cuentaOrigenId === r.cuentaContableId) ? { bien: bienParaApi(r.bien ?? { descripcion: r.descripcion, vidaUtilMeses: '', valorResidual: '' }) } : {}),
    })),
  });

  const campo = (k: keyof ReturnType<typeof inicial>) => ({ value: cab[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCab({ ...cab, [k]: e.currentTarget.value }) });

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Factura de proveedor</Title>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Select label="Proveedor" withAsterisk searchable data={m.opcionesProveedor} value={cab.terceroId || null}
            onChange={(v) => { setCab({ ...cab, terceroId: v ?? '', letra: '' }); setRenglones([]); }} />
          <Select label="Tipo" data={TIPOS} value={cab.tipo} allowDeselect={false}
            onChange={(v) => { setCab({ ...cab, tipo: v ?? 'FACTURA' }); if (v === 'NOTA_CREDITO' || v === 'NOTA_DEBITO') setRenglones(renglones.filter((r) => !r.origen)); }} />
          {!esTicket && <Select label="Letra" withAsterisk data={letras} value={cab.letra || null} onChange={(v) => setCab({ ...cab, letra: v ?? '' })} />}
          <Group grow gap="xs" align="flex-end">
            <TextInput label="Punto de venta" withAsterisk inputMode="numeric" {...campo('puntoVenta')} />
            <TextInput label="Número" withAsterisk inputMode="numeric" {...campo('numero')} />
          </Group>
          <TextInput label="Fecha de emisión" type="date" {...campo('fechaEmision')} />
          <TextInput label="Fecha contable" type="date" placeholder="Igual a la emisión" {...campo('fechaContable')} />
          <TextInput label="Vencimiento" type="date" description="Vacío: según días de pago del proveedor" {...campo('fechaVencimiento')} />
          <Select label="Depósito" clearable description="Para artículos con stock comprados sin recepción" data={m.depositos} value={cab.depositoId || null} onChange={(v) => setCab({ ...cab, depositoId: v ?? '' })} />
          <Group grow gap="xs" align="flex-end">
            <Select label="Moneda" data={['ARS', 'USD']} value={cab.monedaCodigo} allowDeselect={false} onChange={(v) => setCab({ ...cab, monedaCodigo: v ?? 'ARS' })} />
            {cab.monedaCodigo === 'USD' && <TextInput label="Cotización" placeholder="Del día" inputMode="decimal" {...campo('cotizacion')} />}
          </Group>
        </SimpleGrid>

        <Group gap="xs">
          <Button variant="light" size="xs" disabled={!cab.terceroId || esNotaCD} onClick={() => abrirSelector('RECEPCION').catch((e) => setErrorSelector(e.mensaje))}>Agregar desde recepciones</Button>
          <Button variant="light" size="xs" disabled={!cab.terceroId || esNotaCD} onClick={() => abrirSelector('ORDEN_COMPRA').catch((e) => setErrorSelector(e.mensaje))}>Agregar desde OC</Button>
          <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setRenglones([...renglones, renglonVacio()])}>Renglón directo</Button>
        </Group>
        {errorSelector && <Alert color="red">{errorSelector}</Alert>}
        {renglones.length > 0 && (
          <GrillaRenglones rubros={rubros} renglones={renglones} onChange={setRenglones} discriminaIva={discrimina} articulos={m.articulos} centrosCosto={m.centros}
            cuentas={cuentas} mostrarCuenta moneda={cab.monedaCodigo} permitirAgregar={false} extrasTotales={extras} />
        )}

        <Divider label="Percepciones e impuestos" labelPosition="left" />
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <TextInput label="Percepción IVA" inputMode="decimal" {...campo('percepcionIva')} />
          <TextInput label="Impuestos internos" inputMode="decimal" {...campo('impuestosInternos')} />
          <TextInput label="No gravado" inputMode="decimal" {...campo('noGravado')} />
          <TextInput label="Exento" inputMode="decimal" {...campo('exento')} />
        </SimpleGrid>
        <Stack gap={4}>
          {iibb.map((x, i) => (
            <Group key={i} gap="xs">
              <TextInput size="xs" aria-label="Jurisdicción" placeholder="Jurisdicción (901)" value={x.jurisdiccion} onChange={(e) => setIibb(iibb.map((y, j) => (j === i ? { ...y, jurisdiccion: e.currentTarget.value } : y)))} />
              <TextInput size="xs" aria-label="Importe percepción IIBB" placeholder="Importe" value={x.importe} onChange={(e) => setIibb(iibb.map((y, j) => (j === i ? { ...y, importe: e.currentTarget.value } : y)))} />
              <ActionIcon variant="subtle" color="red" aria-label="Quitar percepción" onClick={() => setIibb(iibb.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
            </Group>
          ))}
          <Button variant="subtle" size="xs" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => setIibb([...iibb, { jurisdiccion: '', importe: '' }])}>Agregar percepción de IIBB</Button>
        </Stack>

        <Divider />
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <NumberInput label="Total del comprobante (como figura en el papel)" withAsterisk decimalSeparator="," thousandSeparator="." w={300}
            value={cab.totalDeclarado === '' ? '' : Number(cab.totalDeclarado)} onChange={(v) => setCab({ ...cab, totalDeclarado: v === '' ? '' : String(v) })} />
          <Stack gap={2} align="flex-end">
            <Text fw={700}>Total calculado: {formatoMoneda(tot.total, cab.monedaCodigo)}</Text>
            {diferencia !== null && (
              <Text size="sm" c={Math.abs(diferencia) > 0.05 ? 'red' : 'green'}>Diferencia con el total calculado: {formatoMoneda(diferencia, cab.monedaCodigo)}</Text>
            )}
          </Stack>
        </Group>
        <GuardarComprobante<{ numeroInterno: number }>
          cuerpo={cuerpo}
          deshabilitado={!cab.terceroId || !renglones.length}
          onExito={(r) => {
            notifications.show({ color: 'green', message: `Comprobante cargado (N° interno ${r.numeroInterno})` });
            setCab({ ...inicial(), terceroId: cab.terceroId, fechaEmision: cab.fechaEmision });
            setRenglones([]);
            setIibb([]);
            void qc.invalidateQueries({ queryKey: ['/compras'] });
            void qc.invalidateQueries({ queryKey: ['/compras/comprobantes'] });
          }}
        />
      </Stack>

      <Modal opened={!!selector} onClose={() => setSelector(null)} title={selector === 'RECEPCION' ? 'Recepciones pendientes de facturar' : 'Órdenes de compra pendientes de facturar'} size="xl">
        <Stack>
          <SelectorPendientes
            titulos={selector === 'RECEPCION' ? ['Recepción', 'Remito', 'OC', 'Descripción', 'Precio'] : ['OC', 'Descripción', 'Precio']}
            seleccion={seleccion}
            onChange={setSeleccion}
            filas={pendientes.map((p) =>
              'informeRecepcionRenglonId' in p
                ? { clave: p.informeRecepcionRenglonId, pendiente: p.pendiente, columnas: [numeroInterno(p.irNumero), p.remitoNumero, numeroInterno(p.ocNumero), p.descripcion, formatoMoneda(p.precioUnitario)] }
                : { clave: p.ordenCompraRenglonId, pendiente: p.pendiente, columnas: [numeroInterno(p.ocNumero), p.descripcion, formatoMoneda(p.precioUnitario)] },
            )}
          />
          <Group justify="flex-end">
            <Button disabled={!Object.keys(seleccion).length} onClick={agregarSeleccion}>Agregar seleccionados</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
