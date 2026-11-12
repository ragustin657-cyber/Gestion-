# Entrega 11 — Ventas completas: listas de precios, pedidos (con presupuesto) y remitos

## 1. Objetivo y alcance

El circuito comercial previo a la factura: cotizar, tomar el pedido, entregar con remito y facturar lo entregado, con precios que salen de listas.

**Criterio de éxito** (demo): cargo un pedido de 30 Lámparas LED al precio de la lista del cliente, lo confirmo, entrego 20 con un remito (el stock baja 20 y se registra su costo), facturo ese remito y el pedido queda con 10 pendientes de entregar; un segundo remito de 10 lo deja Entregado.

**Decisiones tomadas con el usuario:**
- **Presupuesto:** es un estado del pedido (un solo documento, "Pedido de venta").
- **Costo de lo vendido:** se registra al emitir el remito (Costo de mercaderías vendidas / Mercaderías), como hoy lo hace la factura directa. La factura que viene de un remito no mueve stock ni registra costo.
- **Precios:** listas con carga manual, importación y aumento masivo por porcentaje con redondeo; historial de cambios.
- **Diseño técnico:** el mismo patrón de tres vías que compras (OC → recepción → factura): documentos propios con renglones vinculados y cantidades entregadas/facturadas por renglón.

**Fuera de alcance:** listas derivadas y precio desde el costo, comisiones, descuentos por cantidad, bonificación por renglón, reservas de stock, COT de ARBA, remitos de devolución (la devolución sigue siendo la NC con devolución), logística.

## 2. Listas de precios

**Modelos** (de empresa):
- `ListaPrecios { id, nombre (único por empresa), monedaCodigo ('ARS' | 'USD'), activa, porDefecto }` — una sola `porDefecto` por empresa (marcar una desmarca las demás).
- `PrecioLista { id, listaId, articuloId, precio Decimal(18,4) > 0, actualizadoEn }`, único `(listaId, articuloId)`.
- `HistorialPrecio { id, listaId, articuloId, precioAnterior?, precioNuevo?, motivo (MANUAL | AUMENTO | IMPORTACION | BAJA), usuario, fecha }`.
- `Tercero.listaPreciosId?` (clientes).

**Endpoints** (`precios.editar` para escribir; `venta.ver` o `pedido.gestionar` para leer):
- `GET/POST /api/ventas/listas`, `PATCH /api/ventas/listas/:id` (nombre, activa, porDefecto; la moneda no cambia si la lista tiene precios: `La lista tiene precios: no se puede cambiar la moneda`).
- `GET /api/ventas/listas/:id/precios?q=` → `[{ articuloId, codigo, descripcion, precio, actualizadoEn }]`.
- `PUT /api/ventas/listas/:id/precios/:articuloId { precio }`, `DELETE …` (registra BAJA).
- `POST /api/ventas/listas/:id/aumento { porcentaje (−90 a 1000, ≠ 0), articuloIds?, redondeo (0.01 | 1 | 10 | 100) }` → `{ actualizados }`. Nuevo precio = redondeo al múltiplo más cercano (mitad hacia arriba) de `precio × (1 + porcentaje/100)`, mínimo un múltiplo del redondeo. Ejemplos: 2500 +7,3 % redondeo 10 → 2680; 1234,56 +10 % redondeo 1 → 1358; 0,50 −90 % redondeo 1 → 1.
- `POST /api/ventas/listas/:id/importar` (multipart, xlsx o csv): columnas código y precio (encabezado opcional en la primera fila; coma o punto decimal). Todo o nada; errores `Línea N: artículo inexistente` / `Línea N: precio inválido` / `Línea N: artículo repetido`. Respuesta `{ creados, actualizados }`.
- `GET /api/ventas/listas/:id/historial?articuloId=`.
- `GET /api/ventas/precio?terceroId&articuloId&monedaCodigo&cotizacion?` → `{ precio: string | null, lista: { id, nombre } | null }`: lista del cliente, si no la lista por defecto (activas). Si la moneda de la lista difiere: ARS→USD divide por la cotización, USD→ARS multiplica (cotización dada o la del día); resultado redondeado a 2 decimales. Sin lista o sin precio: `precio: null`.

## 3. Pedidos de venta

**Modelo** `PedidoVenta { id, numero, terceroId, fecha, validoHasta?, monedaCodigo, cotizacion, listaPreciosId?, depositoId?, estado, observaciones?, netoGravado, noGravado, exento, iva, total, motivoCierre?, creadoPor, creadoEn, version, renglones }` y `PedidoVentaRenglon { id, pedidoId, orden, articuloId?, descripcion, cantidad, precioUnitario, alicuota, neto, iva, cantidadEntregada (0), cantidadFacturada (0) }`. Numeración `PEDIDO` por empresa. Totales con `calcularVenta` y la letra que correspondería al cliente (para discriminar IVA igual que la factura).

`EstadoPedido`: `PRESUPUESTO`, `CONFIRMADO`, `PARCIALMENTE_ENTREGADO`, `ENTREGADO`, `CERRADO`, `ANULADO`.

**Reglas** (endpoints `/api/ventas/pedidos`, `pedido.gestionar`; lectura `venta.ver`):
- `POST` crea en `PRESUPUESTO` (o `CONFIRMADO` con `confirmar: true`). Cliente activo; al menos un renglón; renglones con cantidad > 0 y precio > 0.
- `PUT /:id { …, version }`: solo en `PRESUPUESTO` (`Solo se modifica un presupuesto`); control de versión (`El pedido fue modificado por otro usuario: actualice la pantalla`).
- `POST /:id/confirmar`: de `PRESUPUESTO` a `CONFIRMADO`. Devuelve `advertencias` de stock (por artículo con stock: `Stock disponible de <código> en <depósito>: <saldo>, el pedido pide <cantidad>`), sin bloquear ni reservar.
- `POST /:id/cerrar { motivo }`: desde `PRESUPUESTO`, `CONFIRMADO` o `PARCIALMENTE_ENTREGADO` → `CERRADO` (lo pendiente ya no se entrega ni factura).
- `POST /:id/anular { motivo }`: solo sin entregas ni facturas (`El pedido tiene entregas o facturas: ciérrelo en vez de anularlo`).
- **Estado de entrega** (recalculado al confirmar/anular remitos): todo entregado → `ENTREGADO`; algo → `PARCIALMENTE_ENTREGADO`; nada → `CONFIRMADO`. `CERRADO` y `ANULADO` no se recalculan.
- `GET /:id/pdf`: título "Presupuesto" (estado PRESUPUESTO) o "Pedido de venta", con validez, renglones con precios y totales.
- `GET /` con filtros `terceroId`, `estado`, `pendientes=entregar|facturar`.

## 4. Remitos

**Modelo** `Remito { id, numero, puntoVenta, terceroId, fecha, depositoId, estado (CONFIRMADO | ANULADO), motivoAnulacion?, asientoId?, asientoAnulacionId?, observaciones?, creadoPor, creadoEn, renglones }` y `RemitoRenglon { id, remitoId, orden, pedidoRenglonId?, articuloId?, descripcion, cantidad, cantidadFacturada (0) }`. Numeración `REMITO` por punto de venta (cualquier punto de venta de la empresa). Número impreso `R 0001-00000012`.

**Reglas** (`/api/ventas/remitos`, `pedido.gestionar`; lectura `venta.ver`):
- Depósito obligatorio (el enviado o el del punto de venta): `Indique el depósito`.
- Renglones de pedido: pedido del mismo cliente (`Todos los renglones deben ser del cliente indicado`), en `CONFIRMADO` o `PARCIALMENTE_ENTREGADO` (`El pedido no está confirmado`); cantidad ≤ pendiente de entregar sumando renglones repetidos (`La cantidad a entregar (X) supera lo pendiente del pedido (Y)`). Bloqueo de los renglones de pedido (`FOR UPDATE`) en orden.
- **Stock:** por renglón con artículo que controla stock, salida `VENTA` con `origenTipo 'REMITO'` (regla de stock negativo como cualquier salida). Asiento `origenTipo 'COSTO_REMITO'`: Costo de mercaderías vendidas D / Mercaderías H (más regularizaciones). Los artículos sin control de stock no mueven nada. Mismo orden de bloqueo que Entrega 10 (artículos antes que el asiento).
- **Anular** `POST /:id/anular { motivo }`: sin renglones facturados (`El remito tiene renglones facturados`); movimientos inversos, contraasiento, regularización si corresponde, y descuenta lo entregado del pedido.
- `GET /:id/pdf`: "Remito" sin precios, dos copias (Original / Duplicado).
- `GET /pendientes-facturar?terceroId` → renglones de remitos confirmados con `cantidad − cantidadFacturada > 0`.

## 5. Facturación

`ComprobanteVentaRenglon` suma `remitoRenglonId?` y `pedidoRenglonId?`; el renglón del DTO suma `origen: 'DIRECTO' | 'REMITO' | 'PEDIDO'` (por defecto `DIRECTO`) y el id correspondiente.

- **REMITO:** remito confirmado del mismo cliente; cantidad ≤ pendiente de facturar del renglón del remito (`La cantidad a facturar (X) supera lo pendiente del remito (Y)`); artículo y descripción del remito (precio y alícuota los pone la factura). No mueve stock ni registra costo.
- **PEDIDO:** pedido del cliente en estado confirmado o entregado; solo artículos sin control de stock o renglones sin artículo (`Los artículos que controlan stock se facturan desde un remito o como venta directa`); cantidad ≤ `cantidad − cantidadFacturada`.
- **DIRECTO:** como hoy (con salida de stock si corresponde).
- Solo FACTURA admite orígenes REMITO/PEDIDO (`Las notas de crédito y débito solo admiten renglones directos`).
- **Cantidades facturadas:** se controlan al crear/modificar y en la reserva previa al CAE (`prevalidar`); se incrementan al autorizar (dentro de `autorizar`, con bloqueo de los renglones). Para un renglón de remito vinculado a un pedido, también suma la facturada del renglón del pedido.
- **NC con devolución** de una factura con renglones de remito: el límite de lo devuelto y el costo unitario salen de los movimientos `VENTA` de los remitos vinculados a la factura (además de los propios de la factura).
- `GET /api/ventas/pendientes-facturar?terceroId` → remitos y pedidos con pendiente, para el selector.

## 6. Permisos, pantallas y demo

- **Permisos:** `precios.editar` ("Editar listas de precios"), `pedido.gestionar` ("Gestionar pedidos y remitos de venta"). Demo: Facturación recibe ambos; Administrador todos.
- **Web:**
  - Maestros › Listas de precios: listas, grilla de precios editable con búsqueda, aumento masivo (porcentaje, alcance, redondeo, con vista previa de 5 ejemplos), importar, historial por artículo.
  - Registraciones › Ventas: Pedido de venta (alta/edición de presupuesto, confirmar con avisos, cerrar, anular, PDF; precio sugerido al elegir artículo) y Remito (desde pedidos pendientes del cliente o directo; PDF).
  - Consultas › Ventas: Pedidos (estado, pendiente de entregar y de facturar) y Remitos (con pendiente de facturar).
  - Comprobante de venta: botón "Agregar desde remitos y pedidos" (selector de pendientes del cliente); precio sugerido en renglones directos.
  - Clientes: campo "Lista de precios".
- **Demo:** lista "Minorista" (ARS, por defecto) con precios de los artículos de la demo (LAM-LED $ 2.500); lista "Mayorista" (ARS) un 15 % menor.

## 7. Pruebas

- **Listas:** alta, única por defecto, precio y baja con historial; aumento con los tres ejemplos de §2; importación (encabezado, coma decimal, errores con línea, todo o nada); precio sugerido con lista del cliente, por defecto, conversión ARS↔USD (USD 2 a cotización 1000 → 2000,00; ARS 2500 a cotización 1250 → 2,00) y sin precio.
- **Pedidos:** estados y transiciones, edición solo en presupuesto, versión, avisos de stock al confirmar, cierre y anulación.
- **Remitos:** el circuito del criterio de éxito con importes (stock 100 @ 1500 → remito 20: costo 30.000,00; stock 80); tope de entrega; renglones de otro cliente; remito directo; anulación (stock y pedido vuelven); remito facturado no se anula; concurrencia: dos remitos simultáneos por lo pendiente del mismo pedido → uno solo pasa.
- **Facturación:** factura del remito (no mueve stock, sin asiento de costo), tope de facturación, facturar desde pedido un servicio, rechazo de artículo con stock desde pedido, cantidades facturadas solo al autorizar (borrador eliminado no consume), NC con devolución sobre factura de remitos (costo 1500).
- **Web:** una prueba por pantalla nueva (aumento con vista previa, pedido con precio sugerido, selector de pendientes).
- **E2E:** pedido → confirmar → remito parcial → facturar remito → consulta de pedidos con pendiente.
