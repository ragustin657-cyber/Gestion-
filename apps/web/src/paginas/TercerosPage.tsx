import { PROVINCIAS } from '../ventas/cot';
import { useVendedores } from '../ventas/ComisionesPages';
import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Paper, SegmentedControl, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CondicionIva, ETIQUETAS_CONDICION_IVA, formatearCuit } from '@gestion/shared';
import { api, ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { FormAbm } from '../abm/FormAbm';
import { estado } from '../abm/Maestro';
import { TablaAbm } from '../abm/TablaAbm';
import { CampoAbm } from '../abm/tipos';

interface Iibb { jurisdiccion: string; alicuotaPercepcion: number | string | null; alicuotaRetencion: number | string; exento: boolean }
interface Tercero {
  id: string; codigo: number; razonSocial: string; cuit: string; condicionIva: CondicionIva;
  esProveedor: boolean; esCliente: boolean; activo: boolean; iibb?: Iibb[]; [k: string]: unknown;
}

const condiciones = Object.values(CondicionIva).map((c) => ({ value: c, label: ETIQUETAS_CONDICION_IVA[c] }));

const CAMPOS_GENERALES: CampoAbm[] = [
  { nombre: 'razonSocial', etiqueta: 'Razón social', tipo: 'texto', requerido: true, ancho: true },
  { nombre: 'nombreFantasia', etiqueta: 'Nombre de fantasía', tipo: 'texto' },
  { nombre: 'tipoDocumento', etiqueta: 'Tipo de documento', tipo: 'select', requerido: true, opciones: [{ value: 'CUIT', label: 'CUIT' }, { value: 'DNI', label: 'DNI' }, { value: 'OTRO', label: 'Otro (consumidor final sin identificar)' }] },
  { nombre: 'cuit', etiqueta: 'CUIT / DNI', tipo: 'texto', requerido: true, ayuda: 'CUIT con dígito verificador, DNI de 7 u 8 dígitos o, en Otro, un texto libre' },
  { nombre: 'condicionIva', etiqueta: 'Condición frente al IVA', tipo: 'select', requerido: true, opciones: condiciones },
  { nombre: 'diasPago', etiqueta: 'Días de pago', tipo: 'numero' },
  { nombre: 'listaPreciosId', etiqueta: 'Lista de precios', tipo: 'select', ayuda: 'Para clientes: sin lista se usa la lista por defecto' },
  { nombre: 'vendedorId', etiqueta: 'Vendedor', tipo: 'select', ayuda: 'Para clientes: se propone en pedidos y facturas' },
  { nombre: 'sinIntereses', etiqueta: 'Sin intereses por mora', tipo: 'booleano', ayuda: 'Para clientes: no se le liquidan intereses' },
  { nombre: 'esProveedor', etiqueta: 'Es proveedor', tipo: 'booleano' },
  { nombre: 'esCliente', etiqueta: 'Es cliente', tipo: 'booleano' },
  { nombre: 'domicilio', etiqueta: 'Domicilio', tipo: 'texto' },
  { nombre: 'localidad', etiqueta: 'Localidad', tipo: 'texto' },
  // E57: domicilio de entrega (destino del COT de ARBA)
  { nombre: 'entregaCalle', etiqueta: 'Entrega: calle', tipo: 'texto' }, { nombre: 'entregaNumero', etiqueta: 'Entrega: número', tipo: 'texto' },
  { nombre: 'entregaCodigoPostal', etiqueta: 'Entrega: código postal', tipo: 'texto' }, { nombre: 'entregaLocalidad', etiqueta: 'Entrega: localidad', tipo: 'texto' },
  { nombre: 'entregaProvincia', etiqueta: 'Entrega: provincia', tipo: 'select', opciones: PROVINCIAS },
  { nombre: 'provincia', etiqueta: 'Provincia', tipo: 'texto' },
  { nombre: 'email', etiqueta: 'Email', tipo: 'texto' },
  { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'texto' },
  { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
];

type RegimenSire = { id: string; descripcion: string };
export const camposImpuestos = (regimenes: { codigo: string; descripcion: string }[], iva: RegimenSire[] = [], suss: RegimenSire[] = [], exterior: RegimenSire[] = []): CampoAbm[] => [
  { nombre: 'regimenGanancias', etiqueta: 'Régimen de Ganancias (RG 830)', tipo: 'select', opciones: regimenes.map((r) => ({ value: r.codigo, label: `${r.codigo} - ${r.descripcion}` })), ayuda: 'Vacío: no se retiene Ganancias' },
  { nombre: 'inscriptoGanancias', etiqueta: 'Inscripto en Ganancias', tipo: 'booleano' },
  { nombre: 'exencionHasta', etiqueta: 'Exención vigente hasta', tipo: 'fecha' },
  { nombre: 'exentoGanancias', etiqueta: 'Exento de retención de Ganancias', tipo: 'booleano' },
  { nombre: 'exentoIva', etiqueta: 'Exento de retención de IVA', tipo: 'booleano' },
  // Retenciones de IVA y SUSS (E35)
  { nombre: 'regimenIvaId', etiqueta: 'Régimen de retención de IVA', tipo: 'select', opciones: iva.map((r) => ({ value: r.id, label: r.descripcion })), ayuda: 'Vacío: no se retiene IVA' },
  { nombre: 'exclusionIvaPorcentaje', etiqueta: 'Exclusión de IVA', tipo: 'select', numerico: true, opciones: [{ value: '50', label: '50 %' }, { value: '100', label: '100 %' }], ayuda: 'Certificado de exclusión publicado por ARCA' },
  { nombre: 'exclusionIvaPublicacion', etiqueta: 'Exclusión: fecha de publicación', tipo: 'fecha' },
  { nombre: 'exclusionIvaHasta', etiqueta: 'Exclusión vigente hasta', tipo: 'fecha' },
  { nombre: 'regimenSussId', etiqueta: 'Régimen de retención de SUSS', tipo: 'select', opciones: suss.map((r) => ({ value: r.id, label: r.descripcion })), ayuda: 'Vacío: no se retiene SUSS' },
  { nombre: 'situacionIibb', etiqueta: 'Situación en Ingresos Brutos', tipo: 'select', opciones: [{ value: 'LOCAL', label: 'Local' }, { value: 'CONVENIO', label: 'Convenio Multilateral' }, { value: 'NO_INSCRIPTO', label: 'No inscripto' }, { value: 'SIMPLIFICADO', label: 'Régimen simplificado' }], ayuda: 'Lo pide la presentación de AGIP' },
  { nombre: 'numeroIibb', etiqueta: 'Número de inscripción en IIBB', tipo: 'texto' },
  // Beneficiario del exterior (E43): retención de Ganancias exterior y F.2003
  { nombre: 'residenteExterior', etiqueta: 'Beneficiario del exterior', tipo: 'booleano' },
  { nombre: 'regimenExteriorId', etiqueta: 'Régimen de Ganancias exterior', tipo: 'select', opciones: exterior.map((r) => ({ value: r.id, label: r.descripcion })), ayuda: 'Vacío: no se retiene' },
  { nombre: 'aplicaCdi', etiqueta: 'Aplica convenio de doble imposición', tipo: 'booleano' },
  { nombre: 'acrecentamiento', etiqueta: 'Acrecentamiento (la empresa asume el impuesto)', tipo: 'booleano' },
  { nombre: 'nif', etiqueta: 'Clave tributaria en su país (NIF)', tipo: 'texto' },
  { nombre: 'paisSire', etiqueta: 'País de residencia (código SIRE)', tipo: 'numero' },
  { nombre: 'domicilioExterior', etiqueta: 'Domicilio en el exterior', tipo: 'texto' },
  { nombre: 'tipoPersona', etiqueta: 'Tipo de persona', tipo: 'select', opciones: [{ value: 'F', label: 'Física' }, { value: 'J', label: 'Jurídica' }] },
  { nombre: 'nacimientoPais', etiqueta: 'País de nacimiento (código SIRE, persona física)', tipo: 'numero' },
  { nombre: 'nacimientoFecha', etiqueta: 'Fecha de nacimiento (persona física)', tipo: 'fecha' },
  // E50: factura de crédito MiPyME
  { nombre: 'fceObligadoManual', etiqueta: 'Obligado a recibir factura de crédito MiPyME (marca manual)', tipo: 'booleano', ayuda: 'Se usa solo si ARCA no responde y no hay una consulta anterior' },
];

/** E50: resultado de la última consulta a ARCA de la obligación de recibir FCE. */
export function textoConsultaFce(t: { fceConsultadoEn?: string | null; fceObligado?: boolean | null; fceMontoMinimo?: string | null }): string | null {
  if (!t.fceConsultadoEn) return null;
  const fecha = t.fceConsultadoEn.slice(0, 10).split('-').reverse().join('/');
  return t.fceObligado
    ? `Según ARCA al ${fecha}: obligado a recibir factura de crédito MiPyME${t.fceMontoMinimo ? ` desde $ ${Number(t.fceMontoMinimo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}`
    : `Según ARCA al ${fecha}: no obligado a recibir factura de crédito MiPyME`;
}

const valores = (t: Tercero | null, campos: CampoAbm[]) =>
  Object.fromEntries(campos.map((c) => [c.nombre, t ? (t[c.nombre] ?? '') : '']));

function EditorIibb({ tercero, alGuardar }: { tercero: Tercero; alGuardar: () => void }) {
  const [filas, setFilas] = useState<Iibb[]>(tercero.iibb ?? []);
  const [error, setError] = useState('');
  const cambiar = (i: number, k: keyof Iibb, v: unknown) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function guardar() {
    setError('');
    try {
      await api(`/terceros/${tercero.id}/iibb`, {
        metodo: 'PUT',
        // E39: la percepción vacía es «sin dato» (no 0 %)
        body: filas.map((f) => ({ ...f, alicuotaPercepcion: f.alicuotaPercepcion === null || f.alicuotaPercepcion === '' ? null : Number(f.alicuotaPercepcion), alicuotaRetencion: Number(f.alicuotaRetencion) })),
      });
      notifications.show({ color: 'green', message: 'Ingresos Brutos actualizado' });
      alGuardar();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">Ingresos Brutos por jurisdicción</Text>
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr><Table.Th>Jurisdicción</Table.Th><Table.Th>% Percepción</Table.Th><Table.Th>% Retención</Table.Th><Table.Th /></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filas.map((f, i) => (
            <Table.Tr key={i}>
              <Table.Td><TextInput size="xs" aria-label="Jurisdicción IIBB" placeholder="901" value={f.jurisdiccion} onChange={(e) => cambiar(i, 'jurisdiccion', e.currentTarget.value)} /></Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="% Percepción" decimalSeparator="," placeholder="Sin dato" value={f.alicuotaPercepcion === null || f.alicuotaPercepcion === '' ? '' : Number(f.alicuotaPercepcion)} onChange={(v) => cambiar(i, 'alicuotaPercepcion', v === '' ? null : v)} /></Table.Td>
              <Table.Td><NumberInput size="xs" aria-label="% Retención" decimalSeparator="," value={Number(f.alicuotaRetencion)} onChange={(v) => cambiar(i, 'alicuotaRetencion', v)} /></Table.Td>
              <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => setFilas(filas.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {error && <Text c="red" size="sm">{error}</Text>}
      <Group justify="space-between">
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setFilas([...filas, { jurisdiccion: '', alicuotaPercepcion: null, alicuotaRetencion: 0, exento: false }])}>
          Agregar jurisdicción
        </Button>
        <Button size="xs" onClick={guardar}>Guardar IIBB</Button>
      </Group>
    </Stack>
  );
}

function FichaTercero({ id, alCerrar }: { id: string | null; alCerrar: () => void }) {
  const qc = useQueryClient();
  const detalle = useQuery({ queryKey: ['/terceros', id], queryFn: () => api<Tercero>(`/terceros/${id}`), enabled: !!id });
  const regimenes = useQuery({ queryKey: ['/pagos/config/regimenes', 'ficha'], queryFn: () => api<{ codigo: string; descripcion: string }[]>('/pagos/config/regimenes').catch(() => []) });
  const regIva = useQuery({ queryKey: ['/pagos/config/regimenes-iva', 'ficha'], queryFn: () => api<RegimenSire[]>('/pagos/config/regimenes-iva').catch(() => []) });
  const regSuss = useQuery({ queryKey: ['/pagos/config/regimenes-suss', 'ficha'], queryFn: () => api<RegimenSire[]>('/pagos/config/regimenes-suss').catch(() => []) });
  const regExterior = useQuery({ queryKey: ['/pagos/config/regimenes-exterior', 'ficha'], queryFn: () => api<RegimenSire[]>('/pagos/config/regimenes-exterior').catch(() => []) });
  const CAMPOS_IMPUESTOS = camposImpuestos(regimenes.data ?? [], regIva.data ?? [], regSuss.data ?? [], regExterior.data ?? []);
  const listas = (useQuery({ queryKey: ['/ventas/listas', 'tercero'], queryFn: () => api<{ id: string; nombre: string }[]>('/ventas/listas').catch(() => []) }).data ?? []).map((l) => ({ value: l.id, label: l.nombre }));
  const vendedores = useVendedores().filter((v) => v.activo || v.id === detalle.data?.vendedorId).map((v) => ({ value: v.id, label: v.nombre }));
  const refrescar = () => qc.invalidateQueries({ queryKey: ['/terceros'] });
  const t = detalle.data ?? null;
  if (id && !t) return null;
  return (
    <Tabs defaultValue="general">
      <Tabs.List mb="md">
        <Tabs.Tab value="general">Datos generales</Tabs.Tab>
        <Tabs.Tab value="impuestos" disabled={!t}>Impuestos</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="general">
        <FormAbm
          campos={CAMPOS_GENERALES.map((c) => (c.nombre === 'listaPreciosId' ? { ...c, opciones: listas } : c.nombre === 'vendedorId' ? { ...c, opciones: vendedores } : c))}
          valoresIniciales={t ? { ...valores(t, CAMPOS_GENERALES), cuit: t.tipoDocumento === 'CUIT' ? formatearCuit(t.cuit) : t.cuit } : { esProveedor: true, activo: true, condicionIva: 'RESPONSABLE_INSCRIPTO', tipoDocumento: 'CUIT', diasPago: 30 }}
          onEnviar={(v) => { const b = { ...v, listaPreciosId: v.listaPreciosId || null, vendedorId: v.vendedorId || null }; return t ? api(`/terceros/${t.id}`, { metodo: 'PATCH', body: b }) : api('/terceros', { metodo: 'POST', body: b }); }}
          onExito={() => {
            notifications.show({ color: 'green', message: 'Guardado correctamente' });
            void refrescar();
            alCerrar();
          }}
        />
      </Tabs.Panel>
      {t && (
        <Tabs.Panel value="impuestos">
          <Stack>
            {textoConsultaFce(t as never) && <Text size="sm" c="dimmed">{textoConsultaFce(t as never)}</Text>}
            <FormAbm
              campos={CAMPOS_IMPUESTOS}
              valoresIniciales={valores(t, CAMPOS_IMPUESTOS)}
              onEnviar={(v) => api(`/terceros/${t.id}`, { metodo: 'PATCH', body: v })}
              onExito={() => {
                notifications.show({ color: 'green', message: 'Datos impositivos guardados' });
                void refrescar();
              }}
            />
            <EditorIibb tercero={t} alGuardar={() => void refrescar()} />
          </Stack>
        </Tabs.Panel>
      )}
    </Tabs>
  );
}

export function TercerosPage() {
  const { puede } = useAuth();
  const [tipo, setTipo] = useState('proveedor');
  const [abierto, setAbierto] = useState<string | 'nuevo' | null>(null);
  const editable = puede('tercero.editar');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Title order={3}>Proveedores y clientes</Title>
        <SegmentedControl value={tipo} onChange={setTipo} data={[{ value: 'proveedor', label: 'Proveedores' }, { value: 'cliente', label: 'Clientes' }, { value: '', label: 'Todos' }]} />
      </Group>
      <TablaAbm<Tercero>
        ruta="/terceros"
        paginado
        filtros={{ tipo: tipo || undefined }}
        onSeleccionar={(t) => setAbierto(t.id)}
        acciones={editable && <Button leftSection={<IconPlus size={16} />} onClick={() => setAbierto('nuevo')}>Nuevo</Button>}
        columnas={[
          { campo: 'codigo', titulo: 'Código' },
          { campo: 'razonSocial', titulo: 'Razón social' },
          { campo: 'cuit', titulo: 'CUIT / DNI', render: (t) => (t.tipoDocumento === 'CUIT' ? formatearCuit(t.cuit) : t.tipoDocumento === 'DNI' ? `DNI ${t.cuit}` : t.cuit) },
          { campo: 'condicionIva', titulo: 'Condición IVA', render: (t) => ETIQUETAS_CONDICION_IVA[t.condicionIva] },
          { campo: 'esProveedor', titulo: 'Tipo', render: (t) => (
            <Group gap={4}>{t.esProveedor && <Badge size="sm" variant="light">Proveedor</Badge>}{t.esCliente && <Badge size="sm" variant="light" color="teal">Cliente</Badge>}</Group>
          ) },
          { campo: 'activo', titulo: 'Estado', render: (t) => estado(t.activo) },
        ]}
      />
      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title={abierto === 'nuevo' ? 'Nuevo proveedor o cliente' : 'Proveedor o cliente'} size="xl">
        {abierto && <FichaTercero id={abierto === 'nuevo' ? null : abierto} alCerrar={() => setAbierto(null)} />}
      </Modal>
    </Paper>
  );
}
