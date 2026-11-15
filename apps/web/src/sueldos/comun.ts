import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';

export type Clase = 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO';
export interface Categoria { id: string; convenioId: string; nombre: string; orden: number; activa: boolean }
export interface Convenio { id: string; nombre: string; codigo: string; horasMensuales: number; activo: boolean; categorias: Categoria[] }
export interface Empleado {
  id: string; legajo: number; apellido: string; nombre: string; cuil: string; domicilio: string; fechaIngreso: string; fechaEgreso: string | null;
  categoriaId: string; categoria: string; centroCostoId: string | null; afiliadoSindicato: boolean; obraSocial: string; formaPago: 'EFECTIVO' | 'TRANSFERENCIA'; cbu: string | null; activo: boolean;
}
export interface Concepto { id: string; convenioId: string | null; codigo: string; nombre: string; clase: Clase; tipo: string; parametros: Record<string, unknown>; orden: number; soloAfiliados: boolean; activo: boolean }
export interface Novedad { tipo: 'HORAS_EXTRA_50' | 'HORAS_EXTRA_100' | 'AUSENCIA_INJUSTIFICADA' | 'IMPORTE'; conceptoId?: string | null; cantidad?: number | null; importe?: number | null; detalle?: string | null }
export interface RenglonRecibo { codigo: string; nombre: string; clase: Clase; cantidad: string | null; base: string | null; porcentaje: string | null; importe: string; orden: number }
export interface Recibo {
  id: string; empleadoId: string; numero: number | null; legajo: number; apellido: string; nombre: string; cuil: string; categoria: string; basico: string; fechaIngreso: string;
  antiguedadAnios: number; diasTrabajados: number; totalRemunerativo: string; totalNoRemunerativo: string; totalDescuentos: string; neto: string; renglones: RenglonRecibo[]; novedades: Novedad[];
}
export interface LiquidacionLista { id: string; numero: number; tipo: 'MENSUAL' | 'SAC'; anio: number; mes: number; fechaPago: string; estado: 'BORRADOR' | 'CERRADA'; empleados: number; totalNeto: string }
export interface LiquidacionDetalle {
  id: string; numero: number; tipo: 'MENSUAL' | 'SAC'; anio: number; mes: number; fechaPago: string; estado: 'BORRADOR' | 'CERRADA';
  ultimoDepositoFecha: string | null; ultimoDepositoBanco: string | null; ultimoDepositoPeriodo: string | null;
  errores: { empleadoId: string; mensaje: string }[]; aviso?: string; recibos: Recibo[];
  totales: { remunerativo: string; noRemunerativo: string; descuentos: string; neto: string };
}

export const CLASES: Record<Clase, string> = { REMUNERATIVO: 'Remunerativo', NO_REMUNERATIVO: 'No remunerativo', DESCUENTO: 'Descuento' };
export const TIPOS_CONCEPTO: Record<string, string> = {
  BASICO: 'Sueldo básico', ANTIGUEDAD: 'Antigüedad', PORCENTAJE: 'Porcentaje', HORAS_EXTRA: 'Horas extra', AUSENCIA: 'Ausencia', FIJO: 'Importe fijo', DESCUENTO_LEY: 'Descuento de ley',
};
export const periodoLiquidacion = (l: { tipo: string; anio: number; mes: number }) =>
  l.tipo === 'SAC' ? `SAC ${l.mes === 6 ? '1.er' : '2.º'} semestre ${l.anio}` : `${String(l.mes).padStart(2, '0')}/${l.anio}`;
export const formatoCuil = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

export const useConvenios = () => useQuery({ queryKey: ['/sueldos/convenios'], queryFn: () => api<Convenio[]>('/sueldos/convenios') });
export const useEmpleados = () => useQuery({ queryKey: ['/sueldos/empleados'], queryFn: () => api<Empleado[]>('/sueldos/empleados') });
export const useConceptos = () => useQuery({ queryKey: ['/sueldos/conceptos'], queryFn: () => api<Concepto[]>('/sueldos/conceptos') });
