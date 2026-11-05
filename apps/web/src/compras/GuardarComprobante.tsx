import { Alert, Button, Group, Stack } from '@mantine/core';
import { useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { Diferencia, DiferenciasModal } from './DiferenciasModal';

/** Botón que envía el comprobante; ante 422 muestra las diferencias y reenvía con aceptoDiferencias. */
export function GuardarComprobante<T>({ cuerpo, onExito, deshabilitado }: {
  cuerpo: () => Record<string, unknown>; onExito: (r: T) => void; deshabilitado?: boolean;
}) {
  const [diferencias, setDiferencias] = useState<Diferencia[] | null>(null);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(aceptoDiferencias: boolean) {
    setError(null);
    setEnviando(true);
    try {
      const r = await api<T>('/compras/comprobantes', { metodo: 'POST', body: { ...cuerpo(), aceptoDiferencias } });
      setDiferencias(null);
      onExito(r);
    } catch (e) {
      const err = e instanceof ErrorApi ? e : new ErrorApi(0, 'Error inesperado');
      if (err.status === 422 && Array.isArray(err.datos?.diferencias)) setDiferencias(err.datos!.diferencias as Diferencia[]);
      else {
        setDiferencias(null);
        setError(err);
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Stack>
      {error && (
        <Alert color="red">
          {error.mensaje}
          {Array.isArray(error.datos?.diferencias) && ' (el control de 3 vías está en modo bloquear)'}
          {error.campos && Object.entries(error.campos).map(([k, v]) => <div key={k}>{k}: {v}</div>)}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button loading={enviando} disabled={deshabilitado} onClick={() => enviar(false)}>Guardar comprobante</Button>
      </Group>
      <DiferenciasModal diferencias={diferencias} enviando={enviando} onVolver={() => setDiferencias(null)} onAceptar={() => enviar(true)} />
    </Stack>
  );
}
