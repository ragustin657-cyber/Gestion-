import { BarChart, CompositeChart } from '@mantine/charts';
import { Alert, Checkbox, Group, Paper, SimpleGrid, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { mesActual, mesCorto, pctTexto, rangoMes, seriesVentas, Tablero } from './comun';

const num = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indicador con su variación contra el período anterior (verde si sube, rojo si baja). */
export function TarjetaIndicador({ titulo, valor, anterior, formato, destino }: { titulo: string; valor: string | null; anterior?: string | null; formato: 'moneda' | 'pct'; destino: string }) {
  const navegar = useNavigate();
  let variacion: { texto: string; sube: boolean } | null = null;
  if (valor !== null && anterior !== undefined && anterior !== null) {
    const v = Number(valor), a = Number(anterior);
    if (formato === 'pct') variacion = { texto: `${v - a >= 0 ? '+' : ''}${num(v - a)} pp`, sube: v >= a };
    else if (a !== 0) { const p = ((v - a) / Math.abs(a)) * 100; variacion = { texto: `${p >= 0 ? '+' : ''}${num(p)} %`, sube: p >= 0 }; }
  }
  return (
    <UnstyledButton onClick={() => navegar(destino)}>
      <Paper withBorder p="md" radius="md" h="100%">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{titulo}</Text>
        <Text size="xl" fw={700} mt={4}>{formato === 'pct' ? pctTexto(valor) : formatoMoneda(valor)}</Text>
        {variacion && <Text size="sm" c={variacion.sube ? 'teal' : 'red'} data-variacion={variacion.sube ? 'sube' : 'baja'}>{variacion.texto}</Text>}
      </Paper>
    </UnstyledButton>
  );
}

export function TableroPage() {
  const [mes, setMes] = useState(mesActual());
  const [rango, setRango] = useState(rangoMes(mesActual()));
  const [reexpresar, setReexpresar] = useState(false);
  const q = useQuery({
    queryKey: ['/informes/tablero', rango, reexpresar],
    queryFn: () => api<Tablero>('/informes/tablero', { query: { ...rango, reexpresar: String(reexpresar) } }),
    enabled: !!rango.desde && !!rango.hasta,
  });
  const p = `desde=${rango.desde}&hasta=${rango.hasta}`;
  const elegirMes = (m: string) => { setMes(m); if (m) setRango(rangoMes(m)); };
  const t = q.data;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md" align="flex-end">
        <Title order={3}>Tablero de dirección</Title>
        <Group gap="sm" align="flex-end">
          <TextInput label="Mes" type="month" w={160} value={mes} onChange={(e) => elegirMes(e.currentTarget.value)} />
          <TextInput label="Desde" type="date" w={160} value={rango.desde} onChange={(e) => { const v = e.currentTarget.value; setMes(''); setRango((r) => ({ ...r, desde: v })); }} />
          <TextInput label="Hasta" type="date" w={160} value={rango.hasta} onChange={(e) => { const v = e.currentTarget.value; setMes(''); setRango((r) => ({ ...r, hasta: v })); }} />
          <Checkbox label="En moneda de hoy" checked={reexpresar} onChange={(e) => setReexpresar(e.currentTarget.checked)} mb={8} />
        </Group>
      </Group>
      {errorConsulta(q.error)}
      {t?.aviso && <Alert color="orange" mb="md">{t.aviso}</Alert>}
      {t && <>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} mb="lg">
          <TarjetaIndicador titulo="Ventas" valor={t.indicadores.ventas.valor} anterior={t.indicadores.ventas.anterior} formato="moneda" destino={`/informes/ventas?${p}&agrupar=mes`} />
          <TarjetaIndicador titulo="Margen bruto" valor={t.indicadores.margenPct.valor} anterior={t.indicadores.margenPct.anterior} formato="pct" destino={`/informes/margenes?${p}`} />
          <TarjetaIndicador titulo="Cobranzas vencidas" valor={t.indicadores.cobranzasVencidas.valor} formato="moneda" destino={`/informes/antiguedad?tipo=clientes&fecha=${rango.hasta}`} />
          <TarjetaIndicador titulo="Deuda vencida" valor={t.indicadores.deudaVencida.valor} formato="moneda" destino={`/informes/antiguedad?tipo=proveedores&fecha=${rango.hasta}`} />
          <TarjetaIndicador titulo="Stock valorizado" valor={t.indicadores.stock.valor} formato="moneda" destino={`/informes/rotacion?${p}`} />
        </SimpleGrid>
        <Text size="sm" c="dimmed" mb="xs">Año anterior: ventas {formatoMoneda(t.indicadores.ventas.anioAnterior)} · margen {pctTexto(t.indicadores.margenPct.anioAnterior)}</Text>
        <Title order={5} mb="xs">Ventas por mes</Title>
        <CompositeChart h={260} mb="lg" dataKey="mes" data={seriesVentas(t.ventasPorMes)} valueFormatter={(v) => formatoMoneda(v)}
          series={[{ name: 'ventas', label: 'Ventas', color: 'indigo.5', type: 'bar' }, { name: 'margen', label: 'Margen', color: 'teal.6', type: 'line' }]} withLegend />
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <div>
            <Title order={5} mb="xs">Principales clientes</Title>
            <BarChart h={Math.max(120, t.topClientes.length * 32)} orientation="vertical" dataKey="nombre" yAxisProps={{ width: 140 }} valueFormatter={(v) => formatoMoneda(v)}
              data={t.topClientes.map((c) => ({ nombre: c.nombre, ventas: Number(c.ventas) }))} series={[{ name: 'ventas', label: 'Ventas', color: 'indigo.5' }]} />
          </div>
          <div>
            <Title order={5} mb="xs">Principales artículos</Title>
            <BarChart h={Math.max(120, t.topArticulos.length * 32)} orientation="vertical" dataKey="nombre" yAxisProps={{ width: 140 }} valueFormatter={(v) => formatoMoneda(v)}
              data={t.topArticulos.map((a) => ({ nombre: `${a.codigo} ${a.descripcion}`, ventas: Number(a.ventas), margen: Number(a.margen) }))}
              series={[{ name: 'ventas', label: 'Ventas', color: 'indigo.5' }, { name: 'margen', label: 'Margen', color: 'teal.6' }]} />
          </div>
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">Serie: {t.ventasPorMes.length ? `${mesCorto(t.ventasPorMes[0].mes)} a ${mesCorto(t.ventasPorMes[t.ventasPorMes.length - 1].mes)}` : ''}</Text>
      </>}
    </Paper>
  );
}
