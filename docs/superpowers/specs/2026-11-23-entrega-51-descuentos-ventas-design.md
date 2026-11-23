# Entrega 51 — Descuentos y bonificaciones en las ventas

## 1. Intención
Hoy el renglón de venta es cantidad × precio unitario. Para hacer un descuento el vendedor baja el precio a mano (se pierde el precio de lista) y no hay forma de hacer un descuento general sobre la factura. En compras ya existe el % de bonificación por renglón.

**Éxito:**
- En el pedido y en el comprobante de venta (factura, nota de débito, nota de crédito) cada renglón tiene un **% de bonificación**, y el precio unitario sigue siendo el de lista.
- El comprobante de venta tiene un **% de descuento general** que se reparte en los renglones.
- El IVA, el total, lo que va a ARCA, el libro IVA, las percepciones, las comisiones y el stock salen del neto bonificado, sin otro cambio.
- El PDF muestra precio, % de bonificación e importe por renglón y el descuento general en el pie.

**No objetivos:** descuentos por cantidad automáticos (escalas por artículo o lista); tope de descuento por usuario o permiso; descuento general como importe fijo; descuentos en recibos (pronto pago).

## 2. Enfoques (elegido por el usuario: el 1)
1. **Elegido: el descuento general se reparte en los renglones.** Neto del renglón = cantidad × precio × (1 − bonificación/100) × (1 − descuento general/100), redondeado a 2 decimales; el IVA de cada alícuota sale de esos netos. ARCA recibe lo mismo que hoy (no tiene campo de descuento).
2. Renglones negativos por alícuota: el sistema no admite renglones negativos (stock, comisiones, topes de NC) y se pierde a qué artículo corresponde el descuento.

## 3. Cálculo (`calcularVenta`, compartido API/web)
- Renglón: `bonificacionPct` (0 a 100, hasta 2 decimales; por defecto 0). Comprobante: `descuentoPct` (0 a menos de 100, hasta 2 decimales; por defecto 0).
- `neto = redondeo2(cantidad × precio × (1 − b/100) × (1 − d/100))`. Un renglón con neto 0 (bonificación 100 %) se permite *(decisión mía: bonificación total de una muestra o un regalo)*; el comprobante no puede quedar con total 0 (`El total del comprobante debe ser mayor a cero`).
- Para mostrar: `subtotal antes del descuento general = Σ redondeo2(cantidad × precio × (1 − b/100))`; `descuento general = subtotal − Σ netos` (en neto, sin IVA). Con letra B, los importes con IVA se calculan igual que hoy a partir de esos netos.
- Sin bonificación ni descuento, el resultado es idéntico al de hoy (mismo redondeo).

## 4. Dónde se carga
- **Pedido de venta:** `% bonif.` por renglón. *(Decisión mía: el pedido no tiene descuento general; al facturar renglones de varios pedidos no habría un descuento único.)*
- **Comprobante de venta:** `% bonif.` por renglón y `Descuento general (%)` en el pie.
- **Facturar desde pedidos o remitos:** el renglón trae la bonificación del renglón del pedido (el remito no tiene precios; si el remito sale de un pedido, la del pedido).
- **Notas de crédito y débito:** se cargan como cualquier comprobante; la nota de crédito de anulación de una FCE (entrega 50) copia la bonificación y el descuento general de la factura.
- **Precio sugerido de la lista:** sigue cargando el precio unitario; la bonificación no cambia.
- La liquidación de intereses y otros comprobantes que arma el sistema van sin bonificación ni descuento.

## 5. PDF y consultas
- PDF: columnas *Precio*, *Bonif. %* (solo si algún renglón tiene bonificación) e *Importe*; en el pie, antes de los totales, `Subtotal` y `Descuento general X %` (solo si hay descuento general). Letra B: precios e importes con IVA, como hoy.
- El detalle del comprobante (pantalla y API) devuelve `bonificacionPct` por renglón y `descuentoPct`.

## 6. Datos
- `ComprobanteVentaRenglon.bonificacionPct Decimal(5,2) @default(0)`, `ComprobanteVenta.descuentoPct Decimal(5,2) @default(0)`, `PedidoVentaRenglon.bonificacionPct Decimal(5,2) @default(0)`. Los comprobantes existentes quedan en 0.

## 7. Fuera de alcance
- Escalas por cantidad, tope por usuario, descuento en importe fijo, bonificaciones en listas de precios, descuento por pronto pago.
