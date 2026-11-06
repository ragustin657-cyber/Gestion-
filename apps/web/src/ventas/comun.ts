import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CondicionIva } from '@gestion/shared';
import { api, ErrorApi } from '../api/cliente';

export type TipoVenta = 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO';
export const TIPOS_VENTA: { value: TipoVenta; label: string }[] = [
  { value: 'FACTURA', label: 'Factura' }, { value: 'NOTA_DEBITO', label: 'Nota de débito' }, { value: 'NOTA_CREDITO', label: 'Nota de crédito' },
];
export const NOMBRE_TIPO: Record<TipoVenta, string> = { FACTURA: 'Factura', NOTA_DEBITO: 'Nota de débito', NOTA_CREDITO: 'Nota de crédito' };
export const ESTADOS_VENTA: Record<string, { etiqueta: string; color: string }> = {
  PENDIENTE_CAE: { etiqueta: 'Pendiente de CAE', color: 'yellow' },
  AUTORIZADO: { etiqueta: 'Autorizado', color: 'green' },
  RECHAZADO: { etiqueta: 'Rechazado', color: 'red' },
};

export interface Cliente { id: string; razonSocial: string; condicionIva: CondicionIva; tipoDocumento: string; cuit: string; diasPago: number }
export interface PuntoVenta { id: string; numero: number; descripcion: string | null; electronico: boolean }
export interface ComprobanteVenta {
  id: string; tipo: TipoVenta; letra: string; puntoVenta: number; numero: number | null; terceroId: string; fecha: string; fechaVencimiento: string;
  concepto: string; monedaCodigo: string; cotizacion: string; netoGravado: string; noGravado: string; exento: string; iva: string; total: string;
  estado: string; cae: string | null; caeVencimiento: string | null; ultimoError: string | null; version: number; saldo?: string | null;
  tercero?: { razonSocial: string }; renglones?: { id: string; descripcion: string; cantidad: string; precioUnitario: string; alicuota: string; neto: string; iva: string }[];
  ivas?: { alicuota: string; base: string; importe: string }[];
}
export interface MovPendiente { id: string; origenTipo: string; origenId: string; descripcion: string; fecha: string; fechaVencimiento: string; monedaCodigo: string; importe: string; saldo: string; saldoPesos: string }

/** "0001-00000012" */
export const numeroVenta = (pv: number, n: number | null) => `${String(pv).padStart(4, '0')}-${String(n ?? 0).padStart(8, '0')}`;

export const useClientes = () =>
  useQuery({ queryKey: ['/terceros', 'clientes'], queryFn: () => api<{ items: Cliente[] }>('/terceros', { query: { tipo: 'cliente', porPagina: 200 } }) }).data?.items ?? [];
export const usePuntosVenta = () => useQuery({ queryKey: ['/empresas/actual/puntos-venta'], queryFn: () => api<PuntoVenta[]>('/empresas/actual/puntos-venta') }).data ?? [];
export const useEmpresa = () => useQuery({ queryKey: ['/empresas/actual'], queryFn: () => api<{ condicionIva: CondicionIva; razonSocial: string }>('/empresas/actual') }).data;

/** Envía una operación, muestra el resultado e invalida las consultas. */
export function useOperacionVentas() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function ejecutar<T>(fn: () => Promise<T>, mensaje: (r: T) => string): Promise<T | null> {
    setError('');
    setEnviando(true);
    try {
      const r = await fn();
      notifications.show({ color: 'green', message: mensaje(r) });
      void qc.invalidateQueries();
      return r;
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
      void qc.invalidateQueries();
      return null;
    } finally {
      setEnviando(false);
    }
  }
  return { ejecutar, enviando, error, setError };
}

export const numero = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/\./g, (m, i, t: string) => (t.includes(',') ? '' : m)).replace(',', '.')));
