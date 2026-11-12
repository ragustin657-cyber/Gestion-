import { Group, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';

export interface Rubro { id: string; nombre: string; vidaUtilMeses: number; cuentaOrigenId?: string; cuentaAmortizacionId?: string; cuentaGastoId?: string; activo?: boolean; cuentaOrigen?: { codigo: string; nombre: string }; cuentaAmortizacion?: { codigo: string; nombre: string }; cuentaGasto?: { codigo: string; nombre: string } }
export interface BienRenglon { descripcion: string; vidaUtilMeses: string; valorResidual: string }
export interface Bien {
  id: string; numero: number; descripcion: string; rubro: string; fechaAlta: string; valorOrigen: string; vidaUtilMeses: number; valorResidual: string;
  origen: 'FACTURA' | 'MANUAL' | 'INICIAL'; estado: 'ACTIVO' | 'BAJA'; fechaBaja: string | null; motivoBaja: string | null; acumulada: string; residual: string;
}
export const ORIGENES: Record<string, string> = { FACTURA: 'Factura', MANUAL: 'Alta manual', INICIAL: 'Carga inicial' };
export const MOTIVOS: Record<string, string> = { DESUSO: 'Desuso', SINIESTRO: 'Siniestro', ROBO: 'Robo', VENTA: 'Venta' };

/** Rubros (vacío si el usuario no puede verlos). */
export function useRubros() {
  const { puede } = useAuth();
  return useQuery({ queryKey: ['/bienes-uso/rubros'], queryFn: () => api<Rubro[]>('/bienes-uso/rubros'), enabled: puede('bienes.ver') || puede('bienes.gestionar') });
}

/** Datos del bien en un renglón de factura cuya cuenta es la de un rubro. */
export function CamposBien({ rubro, valor, onChange }: { rubro: Rubro; valor: BienRenglon; onChange: (v: BienRenglon) => void }) {
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput size="xs" label={`Bien de uso (${rubro.nombre})`} aria-label="Descripción del bien" w={260} value={valor.descripcion} onChange={(e) => onChange({ ...valor, descripcion: e.currentTarget.value })} />
      <TextInput size="xs" label="Vida útil (meses)" w={130} inputMode="numeric" placeholder={String(rubro.vidaUtilMeses)} value={valor.vidaUtilMeses} onChange={(e) => onChange({ ...valor, vidaUtilMeses: e.currentTarget.value })} />
      <TextInput size="xs" label="Valor residual" w={130} inputMode="decimal" placeholder="0" value={valor.valorResidual} onChange={(e) => onChange({ ...valor, valorResidual: e.currentTarget.value.replace(',', '.') })} />
    </Group>
  );
}

/** Cuerpo del bien para la API (vacíos fuera). */
export const bienParaApi = (b: BienRenglon) => ({
  descripcion: b.descripcion, ...(b.vidaUtilMeses ? { vidaUtilMeses: Number(b.vidaUtilMeses) } : {}), ...(b.valorResidual ? { valorResidual: Number(b.valorResidual) } : {}),
});
