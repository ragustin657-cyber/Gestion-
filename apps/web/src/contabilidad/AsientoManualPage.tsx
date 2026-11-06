import { Paper, Stack, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { useCuentasImputables } from '../abm/opciones';
import { hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { importe } from './asiento';
import { useCentrosCosto } from './comun';
import { AsientoVista } from './DetalleAsiento';
import { GrillaAsiento, RenglonEditable, renglonVacio } from './GrillaAsiento';

export function AsientoManualPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const navegar = useNavigate();
  const cuentas = useCuentasImputables();
  const centros = useCentrosCosto();
  const op = useOperacion();
  const [fecha, setFecha] = useState(hoy());
  const [descripcion, setDescripcion] = useState('');
  const [renglones, setRenglones] = useState<RenglonEditable[]>([renglonVacio(), renglonVacio()]);
  const existente = useQuery({ queryKey: ['/contabilidad/asientos', id], queryFn: () => api<AsientoVista>(`/contabilidad/asientos/${id}`), enabled: !!id });
  useEffect(() => {
    const a = existente.data;
    if (!a) return;
    setFecha(a.fecha.slice(0, 10));
    setDescripcion(a.descripcion);
    setRenglones(a.renglones.map((r) => ({ cuentaContableId: r.cuenta.id, centroCostoId: null, debe: r.debe === '0' ? '' : r.debe, haber: r.haber === '0' ? '' : r.haber, detalle: r.detalle ?? '' })));
  }, [existente.data]);

  async function registrar() {
    const body = {
      fecha, descripcion,
      renglones: renglones.map((r) => ({ cuentaContableId: r.cuentaContableId, centroCostoId: r.centroCostoId, debe: importe(r.debe), haber: importe(r.haber), detalle: r.detalle || null })),
    };
    const r = await op.ejecutar(
      () => (id ? api<AsientoVista>(`/contabilidad/asientos/${id}`, { metodo: 'PUT', body: { ...body, version: existente.data!.version } }) : api<AsientoVista>('/contabilidad/asientos', { metodo: 'POST', body })),
      (a) => `Asiento ${a.numero} ${id ? 'modificado' : 'registrado'}`,
    );
    if (r) {
      if (id) navegar('/contabilidad/diario');
      else {
        setDescripcion('');
        setRenglones([renglonVacio(), renglonVacio()]);
      }
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">{id ? 'Modificar asiento manual' : 'Asiento manual'}</Title>
      <Stack>
        <TextInput label="Fecha" type="date" w={200} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
        <TextInput label="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.currentTarget.value)} />
        <GrillaAsiento renglones={renglones} onChange={setRenglones} cuentas={cuentas} centros={centros} onRegistrar={() => void registrar()} enviando={op.enviando}
          textoBoton={id ? 'Guardar cambios' : 'Registrar asiento'} />
        {op.alerta}
      </Stack>
    </Paper>
  );
}
