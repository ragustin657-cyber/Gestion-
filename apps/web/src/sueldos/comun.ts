import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';

export type Clase = 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO';
export interface Categoria { id: string; convenioId: string; nombre: string; orden: number; activa: boolean }
export interface Convenio { id: string; nombre: string; codigo: string; horasMensuales: number; activo: boolean; categorias: Categoria[] }
export interface Empleado {
  id: string; legajo: number; apellido: string; nombre: string; cuil: string; domicilio: string; fechaIngreso: string; fechaEgreso: string | null;
  categoriaId: string; categoria: string; centroCostoId: string | null; afiliadoSindicato: boolean; obraSocial: string; formaPago: 'EFECTIVO' | 'TRANSFERENCIA'; cbu: string | null; activo: boolean;
}
export interface Concepto { id: string; convenioId: string | null; codigo: string; nombre: string; clase: Clase; tipo: string; parametros: Record<string, unknown>; orden: number; soloAfiliados: boolean; activo: boolean; destino?: string; cuentaContableId?: string | null }
export interface Novedad { tipo: 'HORAS_EXTRA_50' | 'HORAS_EXTRA_100' | 'AUSENCIA_INJUSTIFICADA' | 'IMPORTE'; conceptoId?: string | null; cantidad?: number | null; importe?: number | null; detalle?: string | null; liquidacionComisionesId?: string | null }
export interface RenglonRecibo { codigo: string; nombre: string; clase: Clase; cantidad: string | null; base: string | null; porcentaje: string | null; importe: string; orden: number }
export interface Recibo {
  id: string; empleadoId: string; numero: number | null; legajo: number; apellido: string; nombre: string; cuil: string; categoria: string; basico: string; fechaIngreso: string;
  antiguedadAnios: number; diasTrabajados: number; totalRemunerativo: string; totalNoRemunerativo: string; totalDescuentos: string; neto: string; renglones: RenglonRecibo[]; novedades: Novedad[]; pagado?: boolean; sinNeto?: boolean;
}
export interface LiquidacionLista { empleado?: { legajo: number; apellido: string; nombre: string } | null; id: string; numero: number; tipo: 'MENSUAL' | 'SAC' | 'FINAL'; anio: number; mes: number; fechaPago: string; estado: 'BORRADOR' | 'CERRADA'; empleados: number; totalNeto: string }
export interface LiquidacionDetalle {
  id: string; numero: number; tipo: 'MENSUAL' | 'SAC' | 'FINAL'; anio: number; mes: number; fechaPago: string; estado: 'BORRADOR' | 'CERRADA'; egreso?: Egreso | null;
  ultimoDepositoFecha: string | null; ultimoDepositoBanco: string | null; ultimoDepositoPeriodo: string | null;
  errores: { empleadoId: string; mensaje: string }[]; aviso?: string; recibos: Recibo[];
  asiento?: { id: string; numero: number } | null; contribuciones?: ResumenContribuciones; pagos?: PagoSueldos[]; pendientePago?: string;
  totales: { remunerativo: string; noRemunerativo: string; descuentos: string; neto: string };
}

export const CLASES: Record<Clase, string> = { REMUNERATIVO: 'Remunerativo', NO_REMUNERATIVO: 'No remunerativo', DESCUENTO: 'Descuento' };
export const TIPOS_CONCEPTO: Record<string, string> = {
  BASICO: 'Sueldo básico', ANTIGUEDAD: 'Antigüedad', PORCENTAJE: 'Porcentaje', HORAS_EXTRA: 'Horas extra', AUSENCIA: 'Ausencia', FIJO: 'Importe fijo', DESCUENTO_LEY: 'Descuento de ley',
};
export const periodoLiquidacion = (l: { tipo: string; anio: number; mes: number; empleado?: { apellido: string; nombre: string } | null }) =>
  l.tipo === 'SAC' ? `SAC ${l.mes === 6 ? '1.er' : '2.º'} semestre ${l.anio}`
    : l.tipo === 'FINAL' ? `Final ${String(l.mes).padStart(2, '0')}/${l.anio}${l.empleado ? ` - ${l.empleado.apellido}, ${l.empleado.nombre}` : ''}`
      : `${String(l.mes).padStart(2, '0')}/${l.anio}`;
export type CausaEgreso = 'RENUNCIA' | 'DESPIDO_SIN_CAUSA' | 'DESPIDO_CON_CAUSA' | 'MUTUO_ACUERDO';
export const CAUSAS_EGRESO: Record<CausaEgreso, string> = { RENUNCIA: 'Renuncia', DESPIDO_SIN_CAUSA: 'Despido sin causa', DESPIDO_CON_CAUSA: 'Despido con causa', MUTUO_ACUERDO: 'Mutuo acuerdo' };
export interface Egreso { causa: CausaEgreso; fechaEgreso: string; preavisoOtorgado: boolean; mejorRemuneracion: string | null; gratificacion: string; empleado: { id: string; legajo: number; apellido: string; nombre: string } | null }
export const formatoCuil = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

export const useConvenios = () => useQuery({ queryKey: ['/sueldos/convenios'], queryFn: () => api<Convenio[]>('/sueldos/convenios') });
export const useEmpleados = () => useQuery({ queryKey: ['/sueldos/empleados'], queryFn: () => api<Empleado[]>('/sueldos/empleados') });
export const useConceptos = () => useQuery({ queryKey: ['/sueldos/conceptos'], queryFn: () => api<Concepto[]>('/sueldos/conceptos') });

export type DestinoContribucion = 'SEGURIDAD_SOCIAL' | 'OBRA_SOCIAL' | 'ART' | 'SEGURO_VIDA';
export const DESTINOS_CONTRIBUCION: Record<DestinoContribucion, string> = { SEGURIDAD_SOCIAL: 'Seguridad social', OBRA_SOCIAL: 'Obra social', ART: 'ART', SEGURO_VIDA: 'Seguro de vida' };
export const DESTINOS_DESCUENTO: Record<string, string> = { SEGURIDAD_SOCIAL: 'Seguridad social', OBRA_SOCIAL: 'Obra social', SINDICAL: 'Sindical', OTRO: 'Otro' };
export interface Contribucion { id: string; codigo: string; nombre: string; destino: DestinoContribucion; alicuota: string; importeFijo: string; aplicaDetraccion: boolean; cuentaContableId: string; desdeAnio: number; desdeMes: number; activa: boolean }
export interface FilaCargas { cuentaContableId: string; codigo: string; nombre: string; devengado: string; pagado: string; pendiente: string; detalle?: Record<'aportesSS' | 'aportesOS' | 'contribucionesSS' | 'contribucionesOS' | 'art' | 'scvo', string> }
export interface PagoSueldos { id: string; numero: number; fecha: string; cuenta: string; importe: string; anulado: boolean; empleados: number }
export interface ResumenContribuciones { porRecibo: Record<string, string>; porDestino: Record<DestinoContribucion, string>; total: string }
export const mesTexto = (anio: number, mes: number) => `${String(mes).padStart(2, '0')}/${anio}`;
export const pct = (s: string) => `${Number(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} %`;
