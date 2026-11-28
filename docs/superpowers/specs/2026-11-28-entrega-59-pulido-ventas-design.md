# Entrega 59 — Pulido de ventas (diseño corto)

## Intención
Resolver los menores diferidos de las entregas 54 a 58 que ve quien usa el sistema, antes de abrir temas nuevos (como la E49 hizo con impuestos). Aprobado por el usuario con la lista de 18 puntos.

## Enfoques
- **Elegido: una entrega de pulido** con los 18 puntos visibles, agrupados por módulo, cada uno con su prueba.
- Descartado: repartirlos en las próximas entregas (se pierden y mezclan con trabajo nuevo).

## Puntos (comportamiento esperado)
**Remitos y devoluciones (E54)**
1. `GET /api/ventas/remitos/:id` de una entrega devuelve `devoluciones: { id, numeroTexto, fecha, estado, renglones: { remitoRenglonOrigenId, cantidad }[] }[]`; la consulta de remitos muestra *Devoluciones* en la fila (números).
2. `pendientes-acreditar` devuelve una fila por factura que facturó el renglón de origen, con `pendiente` = mín(lo que queda por acreditar de la devolución, lo facturado por esa factura − lo acreditado contra ella por devoluciones de ese origen); filas con pendiente 0 no se devuelven.

**Facturación por lotes (E55)**
3. Precio de lista en USD sin pedido: `sugerido` con la cotización de la fecha de emisión del lote; sin cotización → problema `No hay cotización de USD para la fecha`.
4. Generar con todos los renglones en borradores → 400 `No hay remitos pendientes de facturar: los renglones están en facturas sin autorizar`.

**Rubros y descuentos (E56)**
5. La vista previa del recálculo devuelve `margen`/`origenMargen` solo en listas COSTO (la web ya oculta la columna sin `origenMargen`).
6. Al quitar el artículo de un renglón (texto libre) se borra la bonificación si no es manual.
7. Cambiar el filtro de rubro (o cualquier filtro de `TablaAbm`) vuelve a la página 1.
8. `GET /api/articulos?rubroId=` con un valor que no es UUID → 400 `Rubro inválido`.
9. *Escalas* del rubro solo con `articulo.editar` (sin permiso, sin botón).
10. Artículo con rubro inactivo: aviso `El rubro <nombre> está inactivo: no aporta escalas`.

**COT de ARBA (E57)**
11. En el alta, `provincia: null` (o vacía) con el resto vacío cuenta como "sin destino": se propone el del cliente.
12. Respuesta de ARBA no 2xx o que no es XML → `RECHAZADO` con `ARBA respondió <status>: <primeros 200 caracteres sin etiquetas>` (401/403: `ARBA rechazó el usuario o la clave CIT`).
13. `horaArgentina` con `hourCycle: 'h23'`; patentes: se quitan espacios y guiones antes de validar (`AB 123 CD` → `AB123CD`).
14. La web muestra *Pedir COT* en rojo con el motivo cuando el resultado es RECHAZADO (no el aviso verde).
15. `PUT /api/ventas/cot/config` con `clave: null` borra la clave (`tieneClave: false`); vacío o ausente la conserva. La web tiene *Borrar clave*.

**Exportación (E58)**
16. Con *Exportación*, los renglones agregados desde remitos, pedidos, devoluciones o bienes de uso pasan a exento.
17. Al destildar *Exportación* o cambiar a un cliente local, los renglones con artículo vuelven a la alícuota del artículo (los de texto libre a 21 %) y la moneda a ARS; al elegir un cliente del exterior se propone el primer punto de venta de exportación.
18. PDF de la E: documento del cliente `NIF <nif>` o, si no hay, `CUIT país <cuitPais>`.

## Fuera (a pendientes §3.5)
Concurrencia de escalas, márgenes y notas de crédito por devolución; Id de WSFEX entre emisiones simultáneas; índice de `ComprobanteVentaPermiso`; consultas repetidas del lote; CHECK de un dueño por escala; registrar la acreditación sin comparar; payload de la devolución; recuperación de la E con el CUIT país del momento; PDF del pedido E; timeout del COT.

## Lo que queda al constructor
Nombres de funciones y componentes; dónde se arma el texto de error de ARBA.
