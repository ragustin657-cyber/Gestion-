import { estado, Maestro } from '../abm/Maestro';
import { useCuentasImputables, useOpciones } from '../abm/opciones';

interface Regla { id: string; prioridad: number; texto: string; sentido: string; cuentaBancariaId: string | null; cuentaContableId: string; cuenta: string; concepto: string | null; activa: boolean }
const SENTIDOS = [{ value: 'DEBITO', label: 'Débitos' }, { value: 'CREDITO', label: 'Créditos' }, { value: 'AMBOS', label: 'Ambos' }];

export function ReglasPage() {
  const cuentas = useCuentasImputables();
  const bancarias = useOpciones<{ id: string; numero: string; banco: { nombre: string } }>('/tesoreria/cuentas-bancarias', (c) => ({ value: c.id, label: `${c.banco.nombre} - ${c.numero}` }));
  return (
    <Maestro<Regla>
      config={{
        titulo: 'Reglas de conciliación',
        ruta: '/conciliacion/reglas',
        permisoEditar: 'conciliacion.operar',
        valoresNuevos: { sentido: 'DEBITO', activa: true, prioridad: 200 },
        campos: [
          { nombre: 'prioridad', etiqueta: 'Prioridad (menor = primero)', tipo: 'numero', requerido: true },
          { nombre: 'texto', etiqueta: 'El concepto del banco contiene', tipo: 'texto', requerido: true },
          { nombre: 'sentido', etiqueta: 'Aplica a', tipo: 'select', requerido: true, opciones: SENTIDOS },
          { nombre: 'cuentaBancariaId', etiqueta: 'Solo para la cuenta bancaria', tipo: 'select', opciones: bancarias, ayuda: 'Vacío: todas las cuentas.' },
          { nombre: 'cuentaContableId', etiqueta: 'Cuenta contable', tipo: 'select', requerido: true, opciones: cuentas },
          { nombre: 'concepto', etiqueta: 'Concepto del registro', tipo: 'texto', ayuda: 'Vacío: el texto del banco.' },
          { nombre: 'activa', etiqueta: 'Activa', tipo: 'booleano' },
        ],
        columnas: [
          { campo: 'prioridad', titulo: 'Prioridad' },
          { campo: 'texto', titulo: 'Texto' },
          { campo: 'sentido', titulo: 'Aplica a', render: (r) => SENTIDOS.find((s) => s.value === r.sentido)?.label ?? r.sentido },
          { campo: 'cuenta', titulo: 'Cuenta contable' },
          { campo: 'activa', titulo: 'Estado', render: (r) => estado(r.activa) },
        ],
      }}
    />
  );
}
