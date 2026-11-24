# Entrega 53 — Reservas de stock

## 1. Intención
Hoy el pedido confirmado no reserva nada: avisa si el stock del depósito no alcanza, pero otro vendedor puede remitir o facturar esa misma mercadería a otro cliente sin enterarse. Se quiere ver cuánto está comprometido en pedidos y cuánto queda disponible, y que el sistema **avise** (decisión del usuario: avisar, no impedir) cuando una operación usa mercadería reservada por otros pedidos.

**Éxito:** en Existencias se ven las columnas *Reservado* y *Disponible*; una consulta muestra qué pedidos reservan cada artículo; al confirmar un pedido, remitir o facturar, si lo pedido supera lo disponible (stock − reservado por otros pedidos) aparece el aviso.

**No objetivos:** impedir la operación (ni siquiera con el modo de stock BLOQUEAR, que sigue controlando solo el stock); reservas manuales, parciales o con vencimiento; reservas de presupuestos.

## 2. Enfoques (elegido por el usuario: el 1)
1. **Elegido: reservado calculado en el momento** desde los pedidos pendientes, sin tabla nueva: se libera solo al remitir, facturar, anular o cerrar.
2. Reservas guardadas: permitirían reservas manuales o con vencimiento, pero hay que mantenerlas en cada operación.
3. Reserva manual por renglón: más trabajo y fácil de olvidar.

## 3. Regla
- Reservan los pedidos `CONFIRMADO` y `PARCIALMENTE_ENTREGADO`.
- Cantidad reservada de un renglón = `cantidad − máx(cantidadEntregada, cantidadFacturada)` *(decisión mía: un renglón facturado sin remito ya movió el stock con la factura)*, si es mayor que cero, de artículos que controlan stock.
- Depósito de la reserva: el del pedido; sin depósito, el del primer punto de venta que tenga uno (la misma regla que usa hoy la confirmación).
- **Disponible** = stock del depósito − reservado en ese depósito.

## 4. Avisos (no bloquean)
- **Confirmar un pedido:** por artículo, si lo que pide el pedido supera `stock − reservado por los otros pedidos`: `Disponible de <código> en <depósito>: stock <s>, reservado por otros pedidos <r>, disponible <d>; el pedido pide <q>`. Reemplaza al aviso de hoy (que comparaba solo con el stock).
- **Remito y comprobante de venta (factura y nota de débito):** si lo que se entrega de un artículo supera `stock − reservado por otros pedidos` (los pedidos de los renglones que se están entregando o facturando no cuentan como "otros"), el mismo texto con `se entregan <q>`. Se suma a los avisos de stock de hoy; si ya hay aviso de stock insuficiente, no se repite.
- Las notas de crédito y los movimientos de stock que no son ventas no avisan.

## 5. Consultas
- **Existencias:** columnas *Reservado* y *Disponible* (total y por depósito, con el filtro de depósito); también en el Excel y el PDF.
- **Reservas** (`GET /api/stock/reservas?articuloId=&depositoId=`): pedido, fecha, cliente, depósito, artículo y cantidad reservada; botón desde la fila de Existencias. Permiso `stock.ver`.

## 6. Además
- `docs/pendientes.md`: marcar como hechos los ítems 1, 2, 3, 5 y 6 de Impuestos (entregas 37 a 41) y el ítem 20 (esta entrega).

## 7. Fuera de alcance
- Impedir por reservas; reservas manuales, parciales o con vencimiento; reservar en presupuestos; prioridad entre pedidos.
