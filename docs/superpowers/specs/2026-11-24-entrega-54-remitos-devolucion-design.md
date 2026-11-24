# Entrega 54 — Remitos de devolución

## 1. Intención
Hoy la única forma de que un cliente devuelva mercadería es la nota de crédito con «devolución de mercadería», ligada a una factura. No hay un documento que registre que la mercadería **entró** antes de acreditarla, ni forma de devolver lo entregado con un remito todavía sin facturar.

**Éxito:** el usuario registra un **remito de devolución** desde un remito de entrega del cliente; la mercadería vuelve al stock al costo con que salió; si lo entregado no estaba facturado, lo devuelto deja de estar pendiente de facturar; si ya estaba facturado, queda **pendiente de acreditar** y la nota de crédito se hace desde esa devolución sin volver a mover el stock.

**No objetivos:** devoluciones sin remito de origen (lo vendido con factura directa se sigue devolviendo con la nota de crédito con devolución, como hoy); reabrir el pedido; devoluciones a otro depósito; mercadería devuelta como fallada o para reparación.

## 2. Enfoques (elegido por el usuario: el 1)
1. **Elegido: tipo de remito** `ENTREGA` / `DEVOLUCION` sobre el mismo `Remito`, con numeración propia y renglones que apuntan al renglón devuelto. Reusa numeración, PDF, consulta, asiento de costo y anulación.
2. Documento nuevo «Devolución de venta»: duplica esa infraestructura.

## 3. Remito de devolución
- `Remito.tipo` (`ENTREGA` por defecto, `DEVOLUCION`); numeración propia por punto de venta (talonario `REMITO_DEVOLUCION`), letra del número `R` como el remito (el PDF dice «Remito de devolución»).
- Cabecera: cliente, punto de venta, fecha, observaciones. **Depósito:** el del remito de origen *(decisión mía: la mercadería vuelve de donde salió)*; si los renglones vienen de remitos de distintos depósitos: `Los renglones deben ser de remitos del mismo depósito`.
- Renglones: cada uno con `remitoRenglonOrigenId` (renglón de un remito de **entrega confirmado del mismo cliente**) y la cantidad. Artículo y descripción salen del origen.
- **Control:** no se devuelve más de lo entregado en ese renglón menos lo ya devuelto (`No se puede devolver más de lo entregado en el remito <número> (<descripción>): quedan <q>`).
- **Stock:** entrada (`DEVOLUCION_VENTA`) en el depósito, **al costo con que salió ese renglón** (el del movimiento de salida del remito de origen); asiento inverso al de costo de ventas (Mercaderías al debe, Costo de mercaderías vendidas al haber). Los artículos sin stock no mueven.
- **Pendientes del origen** (`RemitoRenglon.cantidadDevuelta`): lo devuelto se suma al renglón de origen. Lo **pendiente de facturar** del remito pasa a ser `cantidad − facturada − devuelta` (mínimo 0). La parte de la devolución que supera lo que faltaba facturar queda **a acreditar** en el renglón de la devolución (`cantidadAAcreditar = máx(0, q − pendiente de facturar del origen antes de devolver)`).
- **Pedido:** no se reabre (sigue entregado) *(decisión mía)*.
- **Anular** el remito de devolución: revierte la entrada de stock y el asiento y resta `cantidadDevuelta`; no se puede si ya tiene notas de crédito (`La devolución ya tiene notas de crédito: anúlelas primero`). Un remito de entrega con devoluciones no se puede anular (`El remito tiene devoluciones: anúlelas primero`).
- Permiso: `pedido.gestionar` (el de los remitos).

## 4. Nota de crédito desde devoluciones
- Los **pendientes de acreditar** de un cliente: renglones de remitos de devolución confirmados con `cantidadAAcreditar − cantidadAcreditada > 0`.
- En el comprobante de venta (nota de crédito) se agregan desde *Agregar desde devoluciones*: el renglón lleva `devolucionRenglonId`, no mueve stock (la mercadería ya entró), y suma a `cantidadAcreditada` al autorizarse (y resta al anular).
- **Factura asociada** *(decisión mía)*: la nota de crédito sigue necesitando su factura asociada; la pantalla propone la factura que facturó el renglón de remito de origen. Todos los renglones de devolución de una nota deben ser de remitos facturados en esa factura (`La devolución no corresponde a la factura asociada`).
- Una nota con renglones desde devoluciones no puede marcar «devolución de mercadería» (`La mercadería ya entró con el remito de devolución`).
- Precio: el de la factura de ese renglón (con su bonificación), propuesto por la pantalla y editable.

## 5. Consultas y pantallas
- *Ventas › Remito de devolución*: cliente, punto de venta, fecha; *Agregar desde remitos* (renglones entregados con lo que queda por devolver); cantidades; confirmar; PDF.
- *Consultas › Remitos*: columna *Tipo* y filtro; en el detalle de un remito de entrega, sus devoluciones.
- *Pendientes de facturar* descuenta lo devuelto; nueva lista *Pendientes de acreditar* en el comprobante de venta.
- PDF: «Remito de devolución» con los remitos de origen.

## 6. Fuera de alcance
- Devoluciones sin remito de origen, a otro depósito, de mercadería fallada; reabrir pedidos; reposición automática.
