# Entrega 15 — Finanzas: flujo de fondos proyectado y antigüedad a una fecha

## 1. Objetivo y alcance

La dirección sabe si le alcanza la plata en las próximas semanas, contando lo que tiene en bancos y cajas, los valores en cartera, lo que le van a pagar los clientes y lo que debe pagar a los proveedores; y la antigüedad de saldos a una fecha pasada muestra lo que realmente se debía ese día.

**Criterio de éxito.** Con la demo: abro *Tesorería → Flujo de fondos*, agrupo por semana y veo saldo inicial, ingresos y egresos por concepto (cheques, transferencias, cobranzas, cheques propios, OP, proveedores), los vencidos aparte, el saldo de cada semana y una alerta si alguna queda en negativo; toco una semana y veo qué la compone. La antigüedad de saldos al último día del mes pasado muestra como pendientes las facturas cobradas después de esa fecha, y coincide con la antigüedad de deuda de Compras.

**Decisiones tomadas con el usuario:**
- **Alcance:** flujo de fondos completo y antigüedad a una fecha; el presupuesto contra real queda para otra entrega.
- **Vencidos:** se proyectan al primer período en líneas propias ("Vencido a cobrar", "Vencido a pagar"); la casilla "Incluir vencidos" (marcada por defecto) decide si suman al saldo.
- **Antigüedad:** una sola función de saldo a una fecha que usan el informe de gestión, el tablero, la antigüedad de deuda de Compras y el flujo.
- **Diseño técnico:** saldo reconstruido en vivo desde movimientos de cuenta corriente y aplicaciones; sin tablas nuevas.

**Fuera de alcance:** presupuesto contra real, demora habitual por cliente, escenarios, impuestos y sueldos proyectados, fecha de anulación de comprobantes (un comprobante anulado no aparece en ninguna fecha, como hoy).

## 2. Saldo pendiente a una fecha

`saldosAFecha(tx, tipo: 'clientes' | 'proveedores', corte: Date)` en `apps/api/src/finanzas/saldos.ts` → por movimiento de cuenta corriente: `{ movimientoId, terceroId, origenTipo, origenId, fecha, fechaVencimiento, monedaCodigo, importePesos, saldoPesos }`, solo con `saldoPesos ≠ 0`.

- Movimientos no anulados con `fecha ≤ corte`; clientes = `origenTipo` en `ORIGENES_CLIENTE`, proveedores = el resto.
- `saldoPesos(corte) = importePesos`
  `− Σ AplicacionCuentaCorriente.importePesosHistorico` (movimientoId = el movimiento, no anulada, `fecha ≤ corte`)
  `− Σ AplicacionCobro.importePesosDebito` (debitoMovId = el movimiento, no anulada, `fecha ≤ corte`)
  `+ Σ AplicacionCobro.importePesosCredito` (creditoMovId = el movimiento, no anulada, `fecha ≤ corte`).
- **Control:** con `corte` = hoy (o posterior a la última aplicación), `saldoPesos(corte)` es igual a `MovimientoCuentaCorriente.saldoPesos` de cada movimiento no anulado. Si una prueba encuentra un circuito que cambia saldos sin dejar aplicación, se corrige ese circuito o se documenta como regla.
- Consultas agregadas (un `groupBy` por tabla de aplicaciones), sin cargar aplicaciones una por una.

## 3. Antigüedad a una fecha

- **Informe de gestión** (`GET /api/informes/antiguedad?tipo&fecha`, Entrega 13): usa `saldosAFecha`; misma forma de respuesta y tramos (`aVencer`, `d1_30`, `d31_60`, `d61_90`, `mas90`, `aFavor`).
- **Tablero** (`cobranzasVencidas`, `deudaVencida`): suma de tramos vencidos de `saldosAFecha` al corte del tablero (que sigue siendo `min(hasta, hoy)`).
- **Compras → Antigüedad de deuda** (`GET /api/compras/consultas/antiguedad-deuda?fecha`): usa `saldosAFecha('proveedores', corte)`; misma forma de respuesta (`porVencer`, `d0a30`, …, `total`), ahora además excluye movimientos con fecha posterior al corte.
- **Ejemplo:** factura de cliente de 1.210,00 del 01/09/2026 que vence el 01/10, cobrada con recibo aplicado el 03/11 → antigüedad al 31/10: tramo `d1_30` 1.210,00; al 05/11: no aparece; al 06/11 todos los saldos coinciden con los actuales.

## 4. Flujo de fondos proyectado

`GET /api/tesoreria/flujo?hasta=AAAA-MM-DD&agrupar=dia|semana|mes&incluirVencidos=true|false&formato=xlsx|pdf` (permiso `tesoreria.ver`), reemplaza la respuesta actual. Desde = hoy (zona Argentina). Límites (400): `hasta ≥ hoy`; por día hasta 90 días (`El flujo diario admite hasta 90 días`), por semana hasta 52 semanas, por mes hasta 24 meses. Por defecto: `agrupar=semana`, `hasta` = hoy + 8 semanas, `incluirVencidos=true`.

**Saldo inicial (hoy):** saldo de las cuentas bancarias activas (ARS y USD; USD × cotización del día) + saldo de las cajas activas (ARS; USD × cotización). Sin cotización del día para USD: la última anterior; si no hay ninguna, 400 `Falta la cotización del dólar`.

**Ingresos, por fecha:**
- `cheques`: cheques de terceros en cartera o en tránsito, por fecha de pago (USD × cotización del día).
- `transferencias`: transferencias recibidas pendientes de acreditar, hoy.
- `cobranzas`: `saldosAFecha('clientes', hoy)` con saldo positivo, por `fechaVencimiento` (los negativos —anticipos, NC sin aplicar— no generan ingreso).

**Egresos, por fecha:**
- `chequesPropios`: cheques propios emitidos no debitados con fecha de pago posterior a la de emisión, por fecha de pago.
- `ordenesPago`: OP aprobadas (neto a pagar), hoy.
- `proveedores`: `saldosAFecha('proveedores', hoy)` con saldo positivo, por `fechaVencimiento`, menos lo imputado a ese movimiento en OP en estado borrador, pendiente de aprobación o aprobada (no se cuenta dos veces); los negativos no generan egreso.

**Vencidos:** cobranzas y pagos a proveedores con `fechaVencimiento < hoy` no entran en sus conceptos sino en `vencidoACobrar` y `vencidoAPagar` del primer período; suman al saldo solo con `incluirVencidos=true`. Los cheques con fecha pasada se proyectan a hoy dentro de su concepto (como hoy).

**Períodos:** por día; por semana de lunes a domingo (el primero desde hoy hasta el domingo); por mes calendario (el primero desde hoy). El último período termina en `hasta`.

**Respuesta:** `{ desde, hasta, agrupar, incluirVencidos, saldoInicial, filas: [{ desde, hasta, etiqueta, ingresos: { cheques, transferencias, cobranzas, vencidoACobrar }, egresos: { chequesPropios, ordenesPago, proveedores, vencidoAPagar }, totalIngresos, totalEgresos, saldo }], primerNegativo: etiqueta | null }`. Importes en texto con 2 decimales; `totalIngresos`/`totalEgresos` incluyen los vencidos solo si se incluyen.

**Detalle:** `GET /api/tesoreria/flujo/detalle?desde&hasta&incluirVencidos` → `[{ concepto, fecha, descripcion, tercero, importe }]` del rango (comprobante con número, cheque con banco y número, OP con número).

**Usuarios de sucursal** (alcance de sucursal): ven solo sus cheques en cartera y en tránsito y sus cajas; sin bancos, transferencias, OP, cobranzas ni proveedores (como el flujo actual).

**Ejemplo** (hoy 06/11/2026, por semana, incluir vencidos): banco 100.000,00 y caja 5.000,00 → saldo inicial 105.000,00. Cheque de terceros 30.000,00 al 16/11; factura de cliente 60.500,00 que vence el 20/11; factura de cliente 12.100,00 vencida el 15/10; factura de proveedor 24.200,00 que vence el 25/11; OP aprobada de 48.400,00 por otra factura de proveedor (esa factura no se cuenta); cheque propio diferido de 12.000,00 al 11/11. Semanas: 06–08/11 vencido a cobrar 12.100,00, OP 48.400,00 → 68.700,00; 09–15/11 cheque propio 12.000,00 → 56.700,00; 16–22/11 cheques 30.000,00 y cobranzas 60.500,00 → 147.200,00; 23–29/11 proveedores 24.200,00 → 123.000,00. Sin vencidos, cada saldo es 12.100,00 menor.

## 5. Web

- **Tesorería → Flujo de fondos** (se rehace): hasta, agrupar (Día / Semana / Mes), "Incluir vencidos"; alerta "El saldo queda negativo en <etiqueta>" si corresponde; gráfico de barras de ingresos y egresos con línea de saldo (`@mantine/charts`); tabla con saldo inicial, una fila por período y columnas por concepto, totales y saldo (en rojo si es negativo); clic en un período → detalle en un modal; Excel y PDF.
- Las pantallas de antigüedad (informe de gestión y Compras) no cambian de forma.

## 6. Pruebas

- **Saldo a una fecha:** el ejemplo de §3; control a hoy en un escenario con factura cobrada parcialmente, NC aplicada, recibo anulado (su aplicación no cuenta), OP pagada en dos partes y OP anulada; proveedor en USD.
- **Antigüedad:** informe de gestión, tablero y Compras dan lo mismo a la misma fecha; Compras excluye movimientos posteriores al corte.
- **Flujo:** el ejemplo de §4 por semana, con y sin vencidos; por día (90 días máximo) y por mes; factura de proveedor en una OP aprobada no se cuenta dos veces; cuenta bancaria en USD a la cotización del día; usuario de sucursal; detalle de un período; exportaciones; validaciones.
- **Web:** tabla del flujo con saldo negativo en rojo y alerta; serie del gráfico.
- **E2E:** el tesorero abre el flujo por semana, ve la alerta o los saldos y abre el detalle de un período.
