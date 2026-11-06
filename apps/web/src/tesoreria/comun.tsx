import { Alert, Badge } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import type { ChequeFila } from './SelectorCheques';

export interface Caja { id: string; nombre: string; monedaCodigo: string; activa: boolean; sucursalId: string; sucursal: { nombre: string } }
export interface CajaDestino { id: string; nombre: string; monedaCodigo: string; sucursal: string }
export interface CuentaBancaria { id: string; numero: string; monedaCodigo: string; activa: boolean; banco: { nombre: string } }
export interface Cheque extends ChequeFila {
  estado: string;
  cajaId: string | null;
  cuentaBancaria: { numero: string; banco: string } | null;
  terceroOrigen: { razonSocial: string } | null;
  terceroDestino: { razonSocial: string } | null;
}

export const ESTADOS_CHEQUE: Record<string, { etiqueta: string; color: string }> = {
  EN_CARTERA: { etiqueta: 'En cartera', color: 'blue' },
  EN_TRANSITO: { etiqueta: 'En tránsito', color: 'yellow' },
  DEPOSITADO: { etiqueta: 'Depositado', color: 'cyan' },
  ACREDITADO: { etiqueta: 'Acreditado', color: 'green' },
  ENDOSADO: { etiqueta: 'Endosado', color: 'grape' },
  RECHAZADO: { etiqueta: 'Rechazado', color: 'red' },
  DEVUELTO: { etiqueta: 'Devuelto', color: 'gray' },
  ANULADO: { etiqueta: 'Anulado', color: 'gray' },
};
export const estadoCheque = (e: string) => <Badge size="sm" variant="light" color={ESTADOS_CHEQUE[e]?.color ?? 'gray'}>{ESTADOS_CHEQUE[e]?.etiqueta ?? e}</Badge>;

export const useCajas = () => useQuery({ queryKey: ['/tesoreria/cajas'], queryFn: () => api<Caja[]>('/tesoreria/cajas') }).data?.filter((c) => c.activa) ?? [];
export const useCajasDestino = () => useQuery({ queryKey: ['/tesoreria/cajas/destinos'], queryFn: () => api<CajaDestino[]>('/tesoreria/cajas/destinos') }).data ?? [];
export const useCuentasBancarias = () =>
  useQuery({ queryKey: ['/tesoreria/cuentas-bancarias'], queryFn: () => api<CuentaBancaria[]>('/tesoreria/cuentas-bancarias') }).data?.filter((c) => c.activa) ?? [];

export const opcionesCajas = (cajas: Caja[]) => cajas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.sucursal?.nombre ?? ''}) · ${c.monedaCodigo}` }));
export const opcionesCuentas = (cuentas: CuentaBancaria[]) => cuentas.map((c) => ({ value: c.id, label: `${c.banco.nombre} - ${c.numero} · ${c.monedaCodigo}` }));

/** Cheques de terceros filtrados (máximo 200). */
export function useCheques(filtros: Record<string, string | undefined>, habilitado = true) {
  return useQuery({
    queryKey: ['/tesoreria/cheques', filtros],
    queryFn: () => api<{ items: Cheque[]; total: number; totales: { monedaCodigo: string; importe: string }[]; porSemana: { semana: string; monedaCodigo: string; importe: string }[] }>(
      '/tesoreria/cheques', { query: { porPagina: 200, ...filtros } }),
    enabled: habilitado,
  });
}

/** Envía una operación, muestra el resultado e invalida las consultas de tesorería. */
export function useOperacion() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function ejecutar<T>(fn: () => Promise<T>, mensaje: (r: T) => string): Promise<T | null> {
    setError('');
    setEnviando(true);
    try {
      const r = await fn();
      notifications.show({ color: 'green', message: mensaje(r) });
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/tesoreria') || String(q.queryKey[0]).startsWith('/pagos') });
      return r;
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      return null;
    } finally {
      setEnviando(false);
    }
  }
  const alerta = error ? <Alert color="red" mt="sm">{error}</Alert> : null;
  return { ejecutar, enviando, alerta, setError };
}

export const numero = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
export const errorConsulta = (e: unknown) => (e ? <Alert color="red" mt="sm">{e instanceof ErrorApi ? e.mensaje : 'Error al cargar los datos'}</Alert> : null);
