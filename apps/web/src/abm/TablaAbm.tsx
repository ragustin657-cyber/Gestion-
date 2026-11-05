import { Alert, Center, Group, Loader, Pagination, ScrollArea, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { ColumnaAbm } from './tipos';

const POR_PAGINA = 25;

export interface PropsTablaAbm<T> {
  ruta: string;
  columnas: ColumnaAbm<T>[];
  paginado?: boolean;
  filtros?: Record<string, string | undefined>;
  onSeleccionar?: (fila: T) => void;
  acciones?: ReactNode;
  buscador?: boolean;
}

export function TablaAbm<T extends { id?: string }>({
  ruta, columnas, paginado, filtros, onSeleccionar, acciones, buscador = true,
}: PropsTablaAbm<T>) {
  const [texto, setTexto] = useState('');
  const [q] = useDebouncedValue(texto, 300);
  const [pagina, setPagina] = useState(1);

  const consulta = useQuery({
    queryKey: [ruta, paginado ? { q, pagina, ...filtros } : filtros],
    queryFn: () =>
      api<{ items: T[]; total: number } | T[]>(ruta, {
        query: paginado ? { q, pagina, porPagina: POR_PAGINA, ...filtros } : filtros,
      }),
  });

  const datos = consulta.data;
  let filas: T[] = Array.isArray(datos) ? datos : (datos?.items ?? []);
  const total = Array.isArray(datos) ? datos.length : (datos?.total ?? 0);
  if (!paginado && q) {
    const t = q.toLowerCase();
    filas = filas.filter((f) => columnas.some((c) => String(f[c.campo] ?? '').toLowerCase().includes(t)));
  }

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap">
        {buscador ? (
          <TextInput
            placeholder="Buscar…"
            leftSection={<IconSearch size={16} />}
            value={texto}
            onChange={(e) => {
              setTexto(e.currentTarget.value);
              setPagina(1);
            }}
            w={{ base: '100%', xs: 280 }}
          />
        ) : <span />}
        {acciones}
      </Group>
      {consulta.isError && (
        <Alert color="red">{consulta.error instanceof ErrorApi ? consulta.error.mensaje : 'Error al cargar los datos'}</Alert>
      )}
      {consulta.isLoading ? (
        <Center p="xl"><Loader size="sm" /></Center>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover={!!onSeleccionar} withTableBorder verticalSpacing={6} miw={500}>
            <Table.Thead>
              <Table.Tr>
                {columnas.map((c) => <Table.Th key={c.campo}>{c.titulo}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filas.map((f, i) => (
                <Table.Tr key={f.id ?? i} style={onSeleccionar ? { cursor: 'pointer' } : undefined} onClick={() => onSeleccionar?.(f)}>
                  {columnas.map((c) => (
                    <Table.Td key={c.campo}>{c.render ? c.render(f) : String(f[c.campo] ?? '')}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
              {!filas.length && (
                <Table.Tr>
                  <Table.Td colSpan={columnas.length}><Text c="dimmed" size="sm" ta="center">Sin registros</Text></Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      {paginado && total > POR_PAGINA && (
        <Group justify="flex-end" mt="sm">
          <Pagination total={Math.ceil(total / POR_PAGINA)} value={pagina} onChange={setPagina} size="sm" />
        </Group>
      )}
    </>
  );
}
