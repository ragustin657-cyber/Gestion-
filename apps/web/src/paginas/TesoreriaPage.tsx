import { Paper, Tabs, Title } from '@mantine/core';
import { estado, Maestro } from '../abm/Maestro';
import { MONEDAS, useCuentasImputables, useOpciones } from '../abm/opciones';

interface Banco { id: string; nombre: string; codigoBcra: string | null }
interface CuentaBancaria { id: string; numero: string; cbu: string | null; alias: string | null; monedaCodigo: string; activa: boolean; banco: Banco; bancoId: string; cuentaContableId: string }
interface Chequera { id: string; tipo: string; desde: number | null; hasta: number | null; proximoNumero: number | null; activa: boolean; cuentaBancaria: CuentaBancaria }
interface Caja { id: string; nombre: string; monedaCodigo: string; activa: boolean }

export function TesoreriaPage() {
  const cuentasContables = useCuentasImputables();
  const bancos = useOpciones<Banco>('/tesoreria/bancos', (b) => ({ value: b.id, label: b.nombre }));
  const cuentasBancarias = useOpciones<CuentaBancaria>('/tesoreria/cuentas-bancarias', (c) => ({ value: c.id, label: `${c.banco.nombre} - ${c.numero}` }));
  const permiso = 'tesoreria.maestros.editar' as const;

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Bancos y cajas</Title>
      <Tabs defaultValue="cuentas" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="cuentas">Cuentas bancarias</Tabs.Tab>
          <Tabs.Tab value="chequeras">Chequeras</Tabs.Tab>
          <Tabs.Tab value="cajas">Cajas</Tabs.Tab>
          <Tabs.Tab value="bancos">Bancos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="bancos">
          <Maestro<Banco> sinMarco config={{
            titulo: 'Banco', ruta: '/tesoreria/bancos', permisoEditar: permiso,
            campos: [
              { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
              { nombre: 'codigoBcra', etiqueta: 'Código BCRA', tipo: 'texto' },
            ],
            columnas: [{ campo: 'nombre', titulo: 'Banco' }, { campo: 'codigoBcra', titulo: 'Código BCRA' }],
          }} />
        </Tabs.Panel>
        <Tabs.Panel value="cuentas">
          <Maestro<CuentaBancaria> sinMarco config={{
            titulo: 'Cuenta bancaria', ruta: '/tesoreria/cuentas-bancarias', permisoEditar: permiso,
            valoresNuevos: { monedaCodigo: 'ARS', activa: true },
            campos: [
              { nombre: 'bancoId', etiqueta: 'Banco', tipo: 'select', requerido: true, opciones: bancos },
              { nombre: 'numero', etiqueta: 'Número de cuenta', tipo: 'texto', requerido: true },
              { nombre: 'cbu', etiqueta: 'CBU', tipo: 'texto' },
              { nombre: 'alias', etiqueta: 'Alias', tipo: 'texto' },
              { nombre: 'monedaCodigo', etiqueta: 'Moneda', tipo: 'select', requerido: true, opciones: MONEDAS },
              { nombre: 'cuentaContableId', etiqueta: 'Cuenta contable', tipo: 'select', requerido: true, opciones: cuentasContables },
              { nombre: 'activa', etiqueta: 'Activa', tipo: 'booleano' },
            ],
            columnas: [
              { campo: 'banco', titulo: 'Banco', render: (c) => c.banco.nombre },
              { campo: 'numero', titulo: 'Número' },
              { campo: 'cbu', titulo: 'CBU' },
              { campo: 'monedaCodigo', titulo: 'Moneda' },
              { campo: 'activa', titulo: 'Estado', render: (c) => estado(c.activa) },
            ],
          }} />
        </Tabs.Panel>
        <Tabs.Panel value="chequeras">
          <Maestro<Chequera> sinMarco config={{
            titulo: 'Chequera', ruta: '/tesoreria/chequeras', permisoEditar: permiso,
            valoresNuevos: { tipo: 'ECHEQ' },
            campos: [
              { nombre: 'cuentaBancariaId', etiqueta: 'Cuenta bancaria', tipo: 'select', requerido: true, opciones: cuentasBancarias },
              { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, opciones: [{ value: 'ECHEQ', label: 'E-cheq' }, { value: 'FISICA', label: 'Física' }] },
              { nombre: 'desde', etiqueta: 'Número desde (solo física)', tipo: 'numero' },
              { nombre: 'hasta', etiqueta: 'Número hasta (solo física)', tipo: 'numero' },
            ],
            camposEdicion: [{ nombre: 'activa', etiqueta: 'Activa', tipo: 'booleano' }],
            columnas: [
              { campo: 'cuentaBancaria', titulo: 'Cuenta', render: (c) => `${c.cuentaBancaria.banco.nombre} - ${c.cuentaBancaria.numero}` },
              { campo: 'tipo', titulo: 'Tipo', render: (c) => (c.tipo === 'ECHEQ' ? 'E-cheq' : 'Física') },
              { campo: 'desde', titulo: 'Rango', render: (c) => (c.desde ? `${c.desde} a ${c.hasta}` : '—') },
              { campo: 'proximoNumero', titulo: 'Próximo número', render: (c) => c.proximoNumero ?? '—' },
              { campo: 'activa', titulo: 'Estado', render: (c) => estado(c.activa) },
            ],
          }} />
        </Tabs.Panel>
        <Tabs.Panel value="cajas">
          <Maestro<Caja> sinMarco config={{
            titulo: 'Caja', ruta: '/tesoreria/cajas', permisoEditar: permiso,
            valoresNuevos: { monedaCodigo: 'ARS', activa: true },
            campos: [
              { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
              { nombre: 'monedaCodigo', etiqueta: 'Moneda', tipo: 'select', requerido: true, opciones: MONEDAS },
              { nombre: 'cuentaContableId', etiqueta: 'Cuenta contable', tipo: 'select', requerido: true, opciones: cuentasContables },
              { nombre: 'activa', etiqueta: 'Activa', tipo: 'booleano' },
            ],
            columnas: [
              { campo: 'nombre', titulo: 'Caja' },
              { campo: 'monedaCodigo', titulo: 'Moneda' },
              { campo: 'activa', titulo: 'Estado', render: (c) => estado(c.activa) },
            ],
          }} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
