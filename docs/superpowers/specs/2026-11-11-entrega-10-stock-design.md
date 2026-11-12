# Entrega 10 — Stock

## 1. Objetivo y alcance

Una empresa que vende mercadería sabe cuánto tiene en cada depósito y cuánto vale, y la contabilidad registra el costo de lo vendido sin cálculos aparte.

**Criterio de éxito.** Con la demo: compro 100 unidades, las recibo, facturo la compra, vendo 30 y veo stock 70 valuado; el Mayor de Mercaderías coincide con la valuación y el Costo de mercaderías vendidas con lo que salió. La cuenta Mercaderías se reexpresa en el ajuste por inflación (no monetaria).

**Decisiones tomadas con el usuario:**
- **Valuación:** precio promedio ponderado móvil, uno por artículo para toda la empresa.
- **Costo de entrada:** al precio de la OC al recibir, contra "Mercadería recibida a facturar"; la factura del proveedor cancela ese pasivo y la diferencia de precio ajusta el costo.
- **Stock negativo:** configurable por empresa, *Bloquear* (por defecto) o *Permitir con aviso*.
- **Diseño técnico:** kardex (`MovimientoStock`) como fuente de verdad, con saldos por artículo y depósito y valor/costo por artículo mantenidos en la misma transacción. El costo se fija en el orden de registro: una salida toma el promedio vigente y ese costo queda fijo en el movimiento y en su asiento (no se recalcula por fecha).

**Fuera de alcance:** lotes, números de serie, vencimientos, producción, remitos, reservas, listas de precios, costo por depósito, devolución física al proveedor ligada a la NC de compra (se registra como salida manual).

## 2. Datos

**`Articulo`** suma:
- `controlaStock Boolean @default(false)` — los artículos existentes quedan en `false`.
- `stockCantidad Decimal(18,4) @default(0)`, `stockValor Decimal(18,2) @default(0)`, `costoPromedio Decimal(18,6) @default(0)` — los mantiene el sistema; no se editan.
- Validaciones: `Un servicio no controla stock`; no se puede desactivar `controlaStock` si el artículo tiene movimientos: `El artículo tiene movimientos de stock`.

**`SaldoStock { id, empresaId, articuloId, depositoId, cantidad Decimal(18,4) }`**, único por `(empresaId, articuloId, depositoId)`.

**`MovimientoStock { id, empresaId, fecha Date, articuloId, depositoId?, tipo TipoMovimientoStock, cantidad Decimal(18,4), costoUnitario Decimal(18,6), importe Decimal(18,2), origenTipo, origenId, origenRenglonId?, anulaAId?, creadoPor, creadoEn }`**.
- `cantidad` e `importe` con signo (positivo = entrada). `depositoId` es nulo solo en `AJUSTE_COSTO` y `REGULARIZACION` (solo importe).
- `TipoMovimientoStock`: `RECEPCION`, `COMPRA`, `AJUSTE_COSTO`, `VENTA`, `DEVOLUCION_VENTA`, `TRANSFERENCIA`, `INVENTARIO`, `INICIAL`, `SALIDA_MANUAL`, `REGULARIZACION`.
- Una anulación genera el movimiento inverso con el mismo tipo y `anulaAId`.
- Índices por `(empresaId, articuloId, creadoEn)` y `(empresaId, origenTipo, origenId)`.

**Documentos internos:** `DocumentoStock { id, empresaId, numero, tipo (TRANSFERENCIA | INVENTARIO | INICIAL | SALIDA), fecha, depositoId, depositoDestinoId?, cuentaContableId?, conAsiento Boolean, observaciones?, estado (CONFIRMADO | ANULADO), motivoAnulacion?, asientoId?, asientoAnulacionId?, creadoPor, creadoEn, renglones }` y `DocumentoStockRenglon { id, empresaId, documentoId, articuloId, cantidad Decimal(18,4), costoUnitario Decimal(18,6)?, cantidadContada Decimal(18,4)? }`. Numeración `DOC_STOCK` única por empresa.

**`ConfigStock { empresaId @unique, stockNegativo (BLOQUEAR | AVISAR) @default(BLOQUEAR) }`**; `GET/PUT /api/stock/config` (`stock.operar` para escribir).

**Otros campos:** `PuntoVenta.depositoId?`; `ComprobanteVenta.depositoId?` y `ComprobanteVenta.devuelveMercaderia Boolean @default(false)`; `ComprobanteCompra.depositoId?`.

**Cuentas** (plan modelo y migración, donde exista la madre y no el código) y **conceptos**:
| Código | Cuenta | Tipo | Monetaria | Concepto |
|---|---|---|---|---|
| 1.1.05 | Bienes de cambio | A (rubro) | no | — |
| 1.1.05.001 | Mercaderías | A | no | `MERCADERIAS` |
| 2.1.01.003 | Mercadería recibida a facturar | P | sí | `MERCADERIA_A_FACTURAR` |
| 4.2.04 | Sobrantes de inventario | RP | no | `SOBRANTES_INVENTARIO` |
| 5.2.06 | Faltantes de inventario | RN | no | `FALTANTES_INVENTARIO` |
| 5.1.01 (existe) | Costo de mercaderías vendidas | RN | no | `COSTO_MERCADERIAS_VENDIDAS` |

`monetariaPorDefecto` suma `1.1.05` y descendientes como no monetarias.

**Permisos nuevos:** `stock.ver` (consultas) y `stock.operar` (documentos y configuración). El rol demo Contador recibe los dos; Comprador y Facturación, `stock.ver`.

## 3. Motor de stock

`apps/api/src/stock/motor.ts`, función única para mover stock dentro de una transacción:

`moverStock(tx, mov: { fecha, articuloId, depositoId, cantidad, costoUnitario?, tipo, origenTipo, origenId, origenRenglonId? }) → { importe, costoUnitario, advertencia? }`

1. Bloquea con `FOR UPDATE` el `Articulo` y el `SaldoStock` (creándolo si falta), en orden de id cuando hay varios (el llamador mueve los renglones ordenados por `articuloId`).
2. **Salida** (`cantidad < 0`):
   - Si `saldo.cantidad + cantidad < 0`: con `BLOQUEAR` → 400 `Stock insuficiente de <código> en <depósito>: hay <saldo>, se piden <cantidad>`; con `AVISAR` → sigue y devuelve esa misma frase como advertencia.
   - Costo: si `costoUnitario` viene dado (devolución, anulación) se usa; si no, el promedio. El importe es `−(stockValor × |cantidad| / stockCantidad)` redondeado a 2 decimales cuando `stockCantidad > 0` y la salida no lo agota; si la salida deja `stockCantidad = 0` el importe es `−stockValor` (el valor queda exacto en 0). Con `stockCantidad ≤ 0` (stock negativo permitido) el importe es `cantidad × costoPromedio`.
3. **Entrada** (`cantidad > 0`): importe = `cantidad × costoUnitario` redondeado. Si la cantidad total previa era negativa, después de sumar el valor queda forzado a `nuevaCantidad × costoUnitario` (si `nuevaCantidad ≥ 0`) y la diferencia se registra como movimiento `REGULARIZACION` (solo importe), que el llamador lleva al costo de lo vendido.
4. **Solo importe** (`AJUSTE_COSTO`, `cantidad = 0`): suma el importe al valor.
5. Actualiza `SaldoStock.cantidad`, `Articulo.stockCantidad`, `stockValor` y `costoPromedio = stockValor / stockCantidad` (si `stockCantidad > 0`; si no, conserva el último).
6. Si el artículo no controla stock: 400 `El artículo <código> no controla stock` (los llamadores filtran antes).

El motor no genera asientos: cada llamador arma el suyo con los importes devueltos.

**Ejemplo que fija el cálculo** (artículo A-001, depósito Central; se usa como prueba):
| Paso | Movimiento | Cantidad | Importe | Stock | Valor | Promedio |
|---|---|---|---|---|---|---|
| 1 | Recepción de OC 100 u a $10 | +100 | 1000,00 | 100 | 1000,00 | 10 |
| 2 | Factura del proveedor a $11 (diferencia) | 0 | 100,00 | 100 | 1100,00 | 11 |
| 3 | Factura directa 50 u a $13 | +50 | 650,00 | 150 | 1750,00 | 11,666667 |
| 4 | Venta 120 u | −120 | −1400,00 | 30 | 350,00 | 11,666667 |
| 5 | NC con devolución 10 u (de la factura del paso 4) | +10 | 116,67 | 40 | 466,67 | 11,666750 |

Mayor de Mercaderías = 466,67 = valuación; Costo de mercaderías vendidas = 1400,00 − 116,67 = 1283,33.

## 4. Compras

**Informe de recepción.**
- Si algún renglón es de un artículo que controla stock y el informe no tiene depósito: 400 `Indique el depósito: hay artículos que controlan stock`.
- Por cada uno: entrada `RECEPCION` con costo = precio de la OC × (1 − bonificación) × cotización de la OC.
- Asiento `origenTipo 'RECEPCION'`: Mercaderías D / Mercadería recibida a facturar H por la suma (sin asiento si no hay artículos con stock). `InformeRecepcion` suma `asientoId?` y `asientoAnulacionId?`.
- **Anulación:** salida al mismo costo unitario con que entró (`costoUnitario` dado) y contraasiento. Aplica la regla de stock negativo. No se anula si algún renglón ya fue facturado (regla existente).

**Factura de compra.** Para cada renglón con artículo que controla stock:
- **Con informe de recepción:** la cuenta del renglón es `MERCADERIA_A_FACTURAR` por el valor recibido de esa cantidad (`cantidad × costo de la recepción`). La diferencia `d = neto en pesos del renglón − valor recibido` se reparte: la parte `d × min(stock, cantidad) / cantidad` va a Mercaderías con un movimiento `AJUSTE_COSTO`; el resto, a Costo de mercaderías vendidas.
- **Sin informe:** exige depósito en la factura (`Indique el depósito: hay artículos que controlan stock`); entrada `COMPRA` al neto en pesos del renglón / cantidad, contra Mercaderías.
- **Nota de crédito:** ajuste de costo por el neto en pesos (negativo), con el mismo reparto que la diferencia de precio; no mueve cantidades. **Nota de débito:** igual, positiva.
- **Anulación** de la factura: movimientos inversos (`anulaAId`) y el contraasiento existente.
- Los renglones vuelven al asiento de la factura con esas cuentas; el resto del asiento no cambia.

## 5. Ventas

- **Depósito:** `ComprobanteVenta.depositoId` = el enviado o el del punto de venta. Si hay artículos con stock y no hay depósito: 400 `Indique el depósito: hay artículos que controlan stock`.
- **Control al crear** (factura, ticket): con `BLOQUEAR` y stock insuficiente → 400 con el mensaje del motor; con `AVISAR`, la respuesta lleva `advertencias`.
- **Al emitir** (cuando se genera el asiento de venta, con o sin CAE): salida `VENTA` por renglón al costo del momento (el motor vuelve a controlar, bajo bloqueo). Asiento aparte `origenTipo 'COSTO_VENTA'`, `origenId` = comprobante: Costo de mercaderías vendidas D / Mercaderías H. Si un comprobante se rechaza o no se emite, no hay movimiento.
- **Nota de crédito con `devuelveMercaderia`:** entrada `DEVOLUCION_VENTA` al costo unitario con que salió ese artículo en el comprobante asociado (importe de sus movimientos `VENTA` / cantidad); sin comprobante asociado o sin ese artículo en él, al promedio vigente. Asiento `COSTO_VENTA` inverso. La cantidad devuelta por artículo no puede superar la vendida en el asociado: `No se puede devolver más de lo vendido de <código>`. Sin `devuelveMercaderia`, la NC no mueve stock.
- **Nota de débito:** no mueve stock.

## 6. Documentos internos

Endpoints `POST /api/stock/documentos` (por tipo), `GET /api/stock/documentos`, `GET /api/stock/documentos/:id`, `POST /api/stock/documentos/:id/anular { motivo }` (`stock.operar`).

- **Transferencia** (origen, destino, renglones `{ articuloId, cantidad }`): salida del origen al promedio y entrada al destino al mismo costo unitario; no cambia el valor ni genera asiento. `El depósito de destino debe ser distinto del de origen`.
- **Inventario físico** (depósito, renglones `{ articuloId, cantidadContada }`): por renglón `diferencia = contada − saldo` al momento de confirmar; sobrante → entrada al promedio (si el promedio es 0: `El artículo <código> no tiene costo: cárguelo con inventario inicial`); faltante → salida. Asiento: Mercaderías / Sobrantes de inventario y Faltantes de inventario / Mercaderías. Renglones sin diferencia no generan movimiento.
- **Inventario inicial** (depósito, renglones `{ articuloId, cantidad, costoUnitario }`, `conAsiento`, `cuentaContableId` requerida si `conAsiento`): entradas `INICIAL`; con asiento: Mercaderías D / cuenta elegida H. Sin asiento, cuando la apertura ya incluye las mercaderías.
- **Salida manual** (depósito, renglones `{ articuloId, cantidad }`, `cuentaContableId`): salidas `SALIDA_MANUAL` al promedio; asiento cuenta elegida D / Mercaderías H.
- **Anulación:** movimientos inversos con el costo unitario original y contraasiento (aplica la regla de stock negativo).

## 7. Consultas

`stock.ver`. Pantalla, Excel y PDF (helpers `tablaXlsx` / `tablaPdf`).
- `GET /api/stock/existencias?depositoId&articuloId&soloConStock` → por artículo y depósito: cantidad; por artículo: cantidad total, costo promedio y valor.
- `GET /api/stock/kardex?articuloId&depositoId&desde&hasta` → movimientos en orden de registro con fecha, tipo, documento, entrada, salida, saldo de cantidad, costo unitario, importe y saldo de valor (el saldo de valor solo sin filtro de depósito). Saldo inicial antes de `desde`.
- `GET /api/stock/valuacion?fecha` → por artículo: cantidad y valor sumando los movimientos con fecha ≤ `fecha`; total, saldo de Mercaderías en el Mayor a esa fecha y diferencia (`control`).

## 8. Web

- **Artículos:** casilla `Controla stock`; columnas de stock y costo promedio (solo lectura).
- **Puntos de venta:** `Depósito por defecto`.
- **Factura de compra:** selector `Depósito` (visible si hay artículos con stock sin recepción).
- **Comprobante de venta:** selector `Depósito`; avisos de stock; casilla `Con devolución de mercadería` en notas de crédito.
- **Registraciones › Stock:** Transferencia, Inventario físico (muestra el saldo del sistema y la diferencia a medida que se carga), Inventario inicial, Salida manual, y la lista de documentos con anulación.
- **Consultas › Stock:** Existencias, Kardex, Valuación (con el control contra el Mayor).
- **Administración:** Configuración de stock (stock negativo).

## 9. Pruebas

- **Motor (Jest e2e sobre la base):** el ejemplo de §3 paso a paso; salida que agota el stock deja valor 0; stock negativo con AVISAR y la regularización al entrar; bloqueo con BLOQUEAR; concurrencia: dos ventas simultáneas sobre el último stock → una sola sale (BLOQUEAR).
- **Compras:** recepción con y sin depósito; asiento de recepción; factura con diferencia de precio con stock completo y con parte vendida (reparto); factura directa; NC de compra; anulaciones.
- **Ventas:** depósito por defecto; control al crear; salida y asiento de costo al emitir; NC con devolución (costo de salida) y límite de lo vendido; NC sin devolución.
- **Documentos:** transferencia, inventario físico con sobrante y faltante, inicial con y sin asiento, salida manual, anulaciones.
- **Consultas:** kardex con saldos, valuación con control = 0 tras el ejemplo, existencias.
- **Plan de cuentas y migración:** cuentas, conceptos y clasificación.
- **Web (Vitest):** una prueba por pantalla nueva y por cambio de formulario.
- **E2E:** OC → recepción → factura de compra → factura de venta → existencias y valuación.
