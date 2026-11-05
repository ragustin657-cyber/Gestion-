import { Alert, Button, Checkbox, Group, MultiSelect, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { FormEvent, useState } from 'react';
import { ErrorApi } from '../api/cliente';
import { CampoAbm } from './tipos';

type Valores = Record<string, unknown>;

/** Normaliza los valores antes de enviar: textos vacíos → null, números vacíos → null. */
function preparar(campos: CampoAbm[], valores: Valores): Valores {
  const r: Valores = {};
  for (const c of campos) {
    const v = valores[c.nombre];
    if (c.tipo === 'booleano') r[c.nombre] = !!v;
    else if (c.tipo === 'multiselect' || c.tipo === 'checkboxes') r[c.nombre] = v || [];
    else if (v === '' || v === undefined) r[c.nombre] = null;
    else if (c.tipo === 'numero' || c.numerico) r[c.nombre] = typeof v === 'string' ? Number(v) : v;
    else r[c.nombre] = v;
  }
  return r;
}

export interface PropsFormAbm {
  campos: CampoAbm[];
  valoresIniciales: Valores;
  onEnviar: (valores: Valores) => Promise<unknown>;
  onExito?: (resultado: unknown) => void;
  textoBoton?: string;
}

export function FormAbm({ campos, valoresIniciales, onEnviar, onExito, textoBoton = 'Guardar' }: PropsFormAbm) {
  const [valores, setValores] = useState<Valores>(valoresIniciales);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cambiar = (nombre: string, v: unknown) => {
    setValores((x) => ({ ...x, [nombre]: v }));
    setErrores((e) => ({ ...e, [nombre]: '' }));
  };

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    const locales: Record<string, string> = {};
    for (const c of campos) {
      const v = valores[c.nombre];
      if (c.requerido && (v === '' || v === undefined || v === null)) locales[c.nombre] = 'Campo obligatorio';
      else if (c.validar && v !== '' && v != null) {
        const m = c.validar(v);
        if (m) locales[c.nombre] = m;
      }
    }
    if (Object.keys(locales).length) return setErrores(locales);

    setEnviando(true);
    try {
      const r = await onEnviar(preparar(campos, valores));
      onExito?.(r);
    } catch (err) {
      if (err instanceof ErrorApi) {
        setErrores(err.campos ?? {});
        const conocido = err.campos && campos.some((c) => err.campos![c.nombre]);
        if (!conocido) setError(err.mensaje);
      } else setError('Error inesperado');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {campos.map((c) => {
            const comun = {
              key: c.nombre,
              label: c.etiqueta,
              description: c.ayuda,
              error: errores[c.nombre] || undefined,
              withAsterisk: c.requerido,
              style: c.ancho ? { gridColumn: '1 / -1' } : undefined,
            };
            const v = valores[c.nombre];
            switch (c.tipo) {
              case 'booleano':
                return (
                  <Checkbox {...comun} mt="lg" checked={!!v} onChange={(e) => cambiar(c.nombre, e.currentTarget.checked)} />
                );
              case 'numero':
                return (
                  <NumberInput {...comun} decimalSeparator="," thousandSeparator="." value={v === null || v === undefined ? '' : Number(v)} onChange={(x) => cambiar(c.nombre, x)} />
                );
              case 'select':
                return (
                  <Select {...comun} data={c.opciones ?? []} searchable clearable={!c.requerido} value={v === null || v === undefined || v === '' ? null : String(Number.isNaN(Number(v)) || !c.numerico ? v : Number(v))} onChange={(x) => cambiar(c.nombre, x ?? '')} />
                );
              case 'multiselect':
                return (
                  <MultiSelect {...comun} data={c.opciones ?? []} searchable value={(v as string[]) ?? []} onChange={(x) => cambiar(c.nombre, x)} />
                );
              case 'password':
                return <PasswordInput {...comun} value={(v as string) ?? ''} onChange={(e) => cambiar(c.nombre, e.currentTarget.value)} />;
              case 'checkboxes': {
                const grupos = [...new Set((c.opciones ?? []).map((o) => o.grupo ?? ''))];
                return (
                  <Checkbox.Group {...comun} style={{ gridColumn: '1 / -1' }} value={(v as string[]) || []} onChange={(x) => cambiar(c.nombre, x)}>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs">
                      {grupos.map((g) => (
                        <Stack key={g} gap={4}>
                          {g && <Text size="xs" fw={700} c="dimmed" tt="uppercase">{g}</Text>}
                          {(c.opciones ?? []).filter((o) => (o.grupo ?? '') === g).map((o) => (
                            <Checkbox key={o.value} value={o.value} label={o.label} size="sm" />
                          ))}
                        </Stack>
                      ))}
                    </SimpleGrid>
                  </Checkbox.Group>
                );
              }
              case 'fecha':
                return (
                  <TextInput {...comun} type="date" value={v ? String(v).slice(0, 10) : ''} onChange={(e) => cambiar(c.nombre, e.currentTarget.value)} />
                );
              default:
                return <TextInput {...comun} value={(v as string) ?? ''} onChange={(e) => cambiar(c.nombre, e.currentTarget.value)} />;
            }
          })}
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" loading={enviando}>{textoBoton}</Button>
        </Group>
      </Stack>
    </form>
  );
}
